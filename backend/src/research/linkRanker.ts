const SIGNAL_TERMS = [
  "careers",
  "career",
  "jobs",
  "hiring",
  "interview",
  "engineering",
  "culture",
  "handbook",
  "company",
  "about",
  "team",
];

export interface RankedLink {
  url: string;
  score: number;
}

/**
 * Scores a discovered link by how likely it is to contain hiring,
 * interview-process, or company-background information — based on
 * signal terms found in the URL path and link text. Never assumes a
 * fixed path; every candidate link found on the page is scored.
 */
export function scoreLink(url: string, linkText: string): number {
  const haystack = `${url} ${linkText}`.toLowerCase();
  let score = 0;
  for (const term of SIGNAL_TERMS) {
    if (haystack.includes(term)) score += 1;
  }
  // Slightly prefer shorter/shallower paths (more likely to be a section
  // landing page than a deeply nested article).
  const pathDepth = (url.match(/\//g) ?? []).length;
  score -= Math.max(0, pathDepth - 4) * 0.1;
  return score;
}

export function rankLinks(
  links: { url: string; text: string }[],
  maxLinks: number
): RankedLink[] {
  const scored = links
    .map(({ url, text }) => ({ url, score: scoreLink(url, text) }))
    .filter((l) => l.score > 0);

  // De-duplicate by URL, keeping the highest score seen.
  const bestByUrl = new Map<string, number>();
  for (const { url, score } of scored) {
    const existing = bestByUrl.get(url);
    if (existing === undefined || score > existing) bestByUrl.set(url, score);
  }

  return Array.from(bestByUrl.entries())
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, maxLinks);
}
