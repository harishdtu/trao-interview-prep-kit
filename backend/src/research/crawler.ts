import * as cheerio from "cheerio";
import { checkUrlSafety } from "../retrieval/urlSafety";
import { rankLinks } from "./linkRanker";
import { env } from "../config/env";

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
}

export interface FailedFetch {
  url: string;
  reason: string;
}

export interface CrawlResult {
  pages: FetchedPage[];
  failures: FailedFetch[];
}

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB
const FETCH_TIMEOUT_MS = 8000;
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

async function fetchWithLimits(url: string): Promise<{ html: string } | { error: string }> {
  const safety = checkUrlSafety(url);
  if (!safety.safe) return { error: safety.reason ?? "unsafe URL" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "TraoInterviewPrepBot/1.0 (+research)" },
    });

    if (!res.ok) return { error: `HTTP ${res.status}` };

    // Re-validate the final URL after redirects (protects against a
    // redirect chain landing on a private/loopback address).
    const finalSafety = checkUrlSafety(res.url || url);
    if (!finalSafety.safe) return { error: `redirected to unsafe URL: ${finalSafety.reason}` };

    const contentType = res.headers.get("content-type") ?? "";
    if (!ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
      return { error: `unsupported content-type: ${contentType || "unknown"}` };
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return { error: "response too large" };
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) return { error: "response too large" };
      return { html: text };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_RESPONSE_BYTES) {
          controller.abort();
          return { error: "response too large" };
        }
        chunks.push(value);
      }
    }
    const html = Buffer.concat(chunks).toString("utf-8");
    return { html };
  } catch (err: any) {
    if (err?.name === "AbortError") return { error: "request timed out" };
    return { error: err?.message ?? "fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function extractReadableText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, svg, nav, footer").remove();
  const text = $("body").text();
  return text.replace(/\s+/g, " ").trim().slice(0, 20000);
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): { url: string; text: string }[] {
  const base = new URL(baseUrl);
  const links: { url: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) return; // stay on-site
      resolved.hash = "";
      links.push({ url: resolved.toString(), text: $(el).text().trim().slice(0, 100) });
    } catch {
      // ignore unparsable hrefs (mailto:, javascript:, etc.)
    }
  });
  return links;
}

/**
 * Crawl a company site starting from `startUrl`: fetch the homepage,
 * discover + rank on-site links dynamically (no hardcoded /careers
 * assumption), then fetch the top-ranked pages up to `maxPages`. One
 * failed page never aborts the whole crawl — it's recorded and the
 * crawl continues.
 */
export async function crawlSite(
  startUrl: string,
  maxPages: number = env.MAX_PAGES
): Promise<CrawlResult> {
  const pages: FetchedPage[] = [];
  const failures: FailedFetch[] = [];
  const visited = new Set<string>();

  const homeResult = await fetchWithLimits(startUrl);
  if ("error" in homeResult) {
    failures.push({ url: startUrl, reason: homeResult.error });
    return { pages, failures };
  }

  visited.add(startUrl);
  const $home = cheerio.load(homeResult.html);
  const discoveredLinks = extractLinks($home, startUrl);
  pages.push({
    url: startUrl,
    title: $home("title").first().text().trim(),
    text: extractReadableText($home),
  });

  const ranked = rankLinks(discoveredLinks, Math.max(0, maxPages - 1));

  for (const { url } of ranked) {
    if (visited.has(url) || pages.length >= maxPages) continue;
    visited.add(url);

    const result = await fetchWithLimits(url);
    if ("error" in result) {
      failures.push({ url, reason: result.error });
      continue;
    }
    const $page = cheerio.load(result.html);
    pages.push({
      url,
      title: $page("title").first().text().trim(),
      text: extractReadableText($page),
    });
  }

  return { pages, failures };
}
