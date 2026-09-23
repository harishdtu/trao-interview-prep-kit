import { LLMProvider } from "../llm/LLMProvider";
import { env } from "../config/env";
import { Kit, Requirement, Question, validateKit } from "../validation/kitSchema";
import { extractRequirements, assignRequirementIds } from "./requirementExtraction";
import { generateCompanyBrief } from "./companyBrief";
import { generateQuestionsForCategory, generateCoverageGapQuestions, IdCounter } from "./questions";
import { generateFlashcards } from "./flashcards";
import { researchCompany, ResearchResult } from "../research/researchPipeline";
import { checkCoverage } from "../coverage/coverage";
import { allocateSchedule } from "../scheduling/schedule";

export type ProgressStage =
  | "validating"
  | "extracting_requirements"
  | "crawling_company"
  | "finding_hiring_info"
  | "researching_interview_process"
  | "generating_technical_questions"
  | "generating_behavioural_questions"
  | "generating_system_design_questions"
  | "generating_company_fit_questions"
  | "checking_coverage"
  | "filling_coverage_gaps"
  | "generating_flashcards"
  | "allocating_schedule"
  | "validating_kit"
  | "saving_kit"
  | "done";

export interface ProgressEvent {
  stage: ProgressStage;
  message: string;
  warning?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

// Guards against cost/DoS abuse via an oversized JD driving an oversized
// LLM prompt. Enforced here (the single pipeline entry point used by both
// the HTTP API and the batch evaluator) as well as at the HTTP layer for
// an early, clean 400 response.
export const MAX_JD_CHARS = 20000;

export interface GenerateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

function extractCompanyNameHint(companyUrl: string): string {
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./, "");
    return host.split(".")[0];
  } catch {
    return companyUrl;
  }
}

// Category → progress-stage mapping used while generating questions.
type Category = "technical" | "behavioural" | "system-design" | "company-fit";
const CATEGORY_STAGE: Record<Category, ProgressStage> = {
  technical: "generating_technical_questions",
  behavioural: "generating_behavioural_questions",
  "system-design": "generating_system_design_questions",
  "company-fit": "generating_company_fit_questions",
};

export async function generateKit(
  llm: LLMProvider,
  input: GenerateKitInput,
  onProgress: ProgressCallback = () => {}
): Promise<Kit> {
  onProgress({ stage: "validating", message: "Validating input" });
  if (!input.jd || input.jd.trim().length === 0) {
    throw Object.assign(new Error("Job description is required."), { code: "INVALID_INPUT" });
  }
  if (input.jd.length > MAX_JD_CHARS) {
    throw Object.assign(
      new Error(`Job description must be ${MAX_JD_CHARS} characters or fewer.`),
      { code: "INVALID_INPUT" }
    );
  }
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw Object.assign(new Error("days must be a positive integer."), { code: "INVALID_INPUT" });
  }

  onProgress({ stage: "extracting_requirements", message: "Extracting requirements from JD" });
  const extracted = await extractRequirements(llm, input.jd);
  const requirements: Requirement[] = assignRequirementIds(extracted.requirements);

  onProgress({ stage: "crawling_company", message: "Crawling company website" });
  const companyNameHint = extractCompanyNameHint(input.companyUrl);
  let research: ResearchResult;
  try {
    research = await researchCompany(input.companyUrl, companyNameHint, env.MAX_PAGES);
  } catch (err) {
    research = {
      company_pages: [],
      hiring_pages: [],
      interview_discussion: [],
      interview_discussion_unavailable_reason: "crawl failed unexpectedly",
      unavailable_sources: [{ url: input.companyUrl, reason: err instanceof Error ? err.message : String(err) }],
    };
  }
  if (research.company_pages.length === 0) {
    onProgress({
      stage: "crawling_company",
      message: "Crawling company website",
      warning: `Could not retrieve any pages from ${input.companyUrl}.`,
    });
  }

  onProgress({ stage: "finding_hiring_info", message: "Identifying hiring/interview pages" });
  if (research.hiring_pages.length === 0) {
    onProgress({
      stage: "finding_hiring_info",
      message: "Identifying hiring/interview pages",
      warning: "No dedicated hiring/careers page was found on the company site.",
    });
  }

  onProgress({ stage: "researching_interview_process", message: "Researching public interview discussion" });
  if (research.interview_discussion.length === 0) {
    onProgress({
      stage: "researching_interview_process",
      message: "Researching public interview discussion",
      warning: research.interview_discussion_unavailable_reason ?? "No public interview discussion found.",
    });
  }

  const companyBrief = await generateCompanyBrief(llm, input.companyUrl, research);

  const questionIds = new IdCounter("q");
  const allQuestions: Question[] = [];

  const categories: Category[] = ["technical", "behavioural", "system-design", "company-fit"];
  for (const category of categories) {
    onProgress({ stage: CATEGORY_STAGE[category], message: `Generating ${category} questions` });
    const categoryRequirements =
      category === "company-fit"
        ? requirements
        : requirements.filter((r) => matchesCategory(r.kind, category));
    const generated = await generateQuestionsForCategory(
      llm,
      category,
      categoryRequirements.length > 0 ? categoryRequirements : requirements,
      research,
      questionIds
    );
    allQuestions.push(...generated);
  }

  onProgress({ stage: "checking_coverage", message: "Checking requirement coverage" });
  let coverage = checkCoverage(requirements, allQuestions);
  let passes = 1;

  const maxPasses = env.MAX_COVERAGE_PASSES;
  while (coverage.uncovered_must_requirement_ids.length > 0 && passes < maxPasses) {
    onProgress({ stage: "filling_coverage_gaps", message: `Generating questions for ${coverage.uncovered_must_requirement_ids.length} uncovered requirement(s)` });
    const uncoveredReqs = requirements.filter((r) =>
      coverage.uncovered_must_requirement_ids.includes(r.id)
    );
    const gapQuestions = await generateCoverageGapQuestions(llm, uncoveredReqs, research, questionIds);
    allQuestions.push(...gapQuestions);
    passes += 1;
    coverage = checkCoverage(requirements, allQuestions);
  }

  if (coverage.uncovered_must_requirement_ids.length > 0) {
    onProgress({
      stage: "checking_coverage",
      message: "Checking requirement coverage",
      warning: `${coverage.uncovered_must_requirement_ids.length} must-have requirement(s) could not be covered after ${passes} pass(es).`,
    });
  }

  onProgress({ stage: "generating_flashcards", message: "Generating flashcards" });
  const flashcardIds = new IdCounter("f");
  const flashcards = await generateFlashcards(llm, requirements, allQuestions, flashcardIds);

  onProgress({ stage: "allocating_schedule", message: "Allocating study schedule" });
  const schedule = allocateSchedule(requirements, allQuestions, input.days);

  const kit: Kit = {
    source: {
      company: companyNameHint,
      company_url: input.companyUrl,
      role: extracted.title,
      location: "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: research.company_pages.map((p) => p.url),
    },
    company_brief: companyBrief,
    role: {
      title: extracted.title,
      seniority: extracted.seniority,
      responsibilities: extracted.responsibilities,
      requirements,
    },
    questions: allQuestions,
    flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      passes,
    },
  };

  onProgress({ stage: "validating_kit", message: "Validating final kit" });
  const { errors } = validateKit(kit);
  if (errors.length > 0) {
    throw Object.assign(
      new Error(`Kit failed referential-integrity validation: ${errors.join("; ")}`),
      { code: "KIT_VALIDATION_FAILED" }
    );
  }

  onProgress({ stage: "saving_kit", message: "Saving kit" });
  return kit;
}

function matchesCategory(kind: Requirement["kind"], category: Category): boolean {
  if (category === "technical") return kind === "technical";
  if (category === "behavioural") return kind === "behavioural";
  if (category === "system-design") return kind === "technical" || kind === "domain";
  return true;
}
