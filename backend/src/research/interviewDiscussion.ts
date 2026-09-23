import { env } from "../config/env";
import { checkUrlSafety } from "../retrieval/urlSafety";

export interface InterviewDiscussionResult {
  found: boolean;
  sources: { url: string; snippet: string }[];
  unavailable_reason: string | null;
}

/**
 * Looks for public discussion of a company's interview process.
 *
 * Genuine web-wide search (Glassdoor/Blind/Reddit threads, etc.) requires
 * a configured search API key (SEARCH_API_KEY + SEARCH_API_URL point at a
 * provider such as SerpAPI/Bing/Brave Search). No such credential is
 * assumed by this assessment's environment variable list, so rather than
 * fabricate an "interview discussion" or silently skip the requirement,
 * this stage:
 *
 *  - uses a configured search backend if SEARCH_API_URL/SEARCH_API_KEY are
 *    present (pluggable — swap in any provider that returns
 *    {url, snippet}[] for a query)
 *  - otherwise explicitly returns found=false with a stated reason, which
 *    the kit surfaces to the user rather than inventing content
 */
export async function researchPublicInterviewDiscussion(
  companyName: string
): Promise<InterviewDiscussionResult> {
  const apiUrl = process.env.SEARCH_API_URL;
  const apiKey = process.env.SEARCH_API_KEY;

  if (!apiUrl || !apiKey) {
    return {
      found: false,
      sources: [],
      unavailable_reason:
        "No search API configured (SEARCH_API_URL/SEARCH_API_KEY unset); public interview-discussion search was skipped rather than fabricated.",
    };
  }

  try {
    const query = `${companyName} interview process experience`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${apiUrl}?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return {
        found: false,
        sources: [],
        unavailable_reason: `search backend returned HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as { results?: { url: string; snippet: string }[] };
    const results = (data.results ?? []).filter((r) => checkUrlSafety(r.url).safe).slice(0, 5);

    return {
      found: results.length > 0,
      sources: results,
      unavailable_reason: results.length > 0 ? null : "search returned no usable results",
    };
  } catch (err) {
    return {
      found: false,
      sources: [],
      unavailable_reason: `search request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
