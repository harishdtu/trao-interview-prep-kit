import { crawlSite, FetchedPage, FailedFetch } from "./crawler";
import { researchPublicInterviewDiscussion } from "./interviewDiscussion";
import { UNTRUSTED_CONTENT_PREFIX } from "../llm/LLMProvider";

export interface ResearchResult {
  company_pages: FetchedPage[];
  hiring_pages: FetchedPage[];
  interview_discussion: { url: string; snippet: string }[];
  interview_discussion_unavailable_reason: string | null;
  unavailable_sources: FailedFetch[];
}

const HIRING_SIGNAL_TERMS = ["career", "job", "hiring", "interview", "handbook"];

function isHiringPage(page: FetchedPage): boolean {
  const haystack = `${page.url} ${page.title}`.toLowerCase();
  return HIRING_SIGNAL_TERMS.some((t) => haystack.includes(t));
}

export async function researchCompany(
  companyUrl: string,
  companyNameHint: string,
  maxPages?: number
): Promise<ResearchResult> {
  const crawl = await crawlSite(companyUrl, maxPages);
  const hiringPages = crawl.pages.filter(isHiringPage);
  const discussion = await researchPublicInterviewDiscussion(companyNameHint || companyUrl);

  return {
    company_pages: crawl.pages,
    hiring_pages: hiringPages,
    interview_discussion: discussion.sources,
    interview_discussion_unavailable_reason: discussion.unavailable_reason,
    unavailable_sources: crawl.failures,
  };
}

/**
 * Builds an untrusted-content-wrapped digest of research findings for use
 * in downstream LLM prompts. Explicitly labels crawled text as untrusted
 * evidence, per the assessment's prompt-injection defense requirement.
 */
export function summarizeResearchForPrompt(research: ResearchResult): string {
  const pageSummaries = research.company_pages
    .slice(0, 6)
    .map((p) => `SOURCE: ${p.url}\nTITLE: ${p.title}\nEXCERPT: ${p.text.slice(0, 1200)}`)
    .join("\n\n---\n\n");

  const discussionSummary =
    research.interview_discussion.length > 0
      ? research.interview_discussion
          .map((d) => `SOURCE: ${d.url}\nSNIPPET: ${d.snippet}`)
          .join("\n\n")
      : `No public interview discussion was found (${research.interview_discussion_unavailable_reason ?? "none available"}).`;

  return [
    UNTRUSTED_CONTENT_PREFIX,
    "",
    "=== COMPANY WEBSITE CONTENT ===",
    pageSummaries || "No company pages were successfully retrieved.",
    "",
    "=== PUBLIC INTERVIEW DISCUSSION ===",
    discussionSummary,
  ].join("\n");
}
