import { env } from "../config/env";

const PRIVATE_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Checks an IPv6 address (without brackets) for loopback, link-local, and
 * unique-local ranges, and unwraps IPv4-mapped IPv6 addresses
 * (::ffff:a.b.c.d) to re-check the embedded IPv4 address — otherwise an
 * IPv4-mapped form could bypass the IPv4 private-range check entirely.
 */
function isPrivateIPv6(hostname: string): boolean {
  const addr = hostname.toLowerCase();

  if (addr === "::1" || addr === "::") return true; // loopback / unspecified

  // fe80::/10 link-local
  if (addr.startsWith("fe8") || addr.startsWith("fe9") || addr.startsWith("fea") || addr.startsWith("feb")) {
    return true;
  }

  // fc00::/7 unique-local (fc.. or fd..)
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true;

  // IPv4-mapped IPv6, dotted-quad form: ::ffff:127.0.0.1
  const mappedDotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);

  // IPv4-mapped IPv6, hex-group form: Node normalizes the dotted-quad form
  // above into this form, e.g. ::ffff:7f00:1 (== ::ffff:127.0.0.1).
  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
  }

  return false;
}

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
  url?: URL;
}

/**
 * Validates that a URL is safe to fetch. In production this rejects
 * loopback/private-network destinations (IPv4 and IPv6) to prevent SSRF.
 * In batch/local evaluation mode (ALLOW_PRIVATE_FETCHES=true) these are
 * permitted, since the evaluation harness may serve fixture company
 * sites on localhost.
 */
export function checkUrlSafety(rawUrl: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: `unsupported protocol ${url.protocol}` };
  }

  // url.hostname keeps surrounding brackets for IPv6 literals (e.g. "[::1]");
  // strip them so both the exact-match and range checks below operate on
  // the bare address.
  const rawHostname = url.hostname.toLowerCase();
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  const isIPv6Literal = hostname.includes(":");

  const isPrivate =
    PRIVATE_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    (isIPv6Literal ? isPrivateIPv6(hostname) : isPrivateIPv4(hostname));

  if (isPrivate && !env.ALLOW_PRIVATE_FETCHES) {
    return { safe: false, reason: "private/loopback address not allowed in this environment" };
  }

  return { safe: true, url };
}
