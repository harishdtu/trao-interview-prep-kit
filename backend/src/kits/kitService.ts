import { LLMProvider } from "../llm/LLMProvider";
import { KitRepository, KitRecord } from "../db/repository";
import { generateKit, GenerateKitInput, ProgressStage } from "../generation/pipeline";
import { generateQuestionsForCategory, generateCoverageGapQuestions, IdCounter } from "../generation/questions";
import { generateCompanyBrief } from "../generation/companyBrief";
import { generateFlashcards } from "../generation/flashcards";
import { researchCompany, ResearchResult } from "../research/researchPipeline";
import { checkCoverage } from "../coverage/coverage";
import { allocateSchedule } from "../scheduling/schedule";
import { mergeGenerated, asGenerated, Editable } from "./editableEntity";
import { Kit, Question, Flashcard, validateKit } from "../validation/kitSchema";
import { computeInputHash } from "./inputHash";
import { recordProgress, clearProgress } from "./progressTracker";
import { env } from "../config/env";

export class KitServiceError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

function withMeta<T extends { id: string }>(
  items: T[],
  meta: Record<string, { origin: "generated" | "user"; edited: boolean; pinned: boolean }>
): (T & Editable)[] {
  return items.map((item) => ({
    ...item,
    origin: meta[item.id]?.origin ?? "generated",
    edited: meta[item.id]?.edited ?? false,
    pinned: meta[item.id]?.pinned ?? false,
  }));
}

function stripMeta<T extends Editable>(items: T[]): { items: Omit<T, keyof Editable>[]; meta: Record<string, { origin: "generated" | "user"; edited: boolean; pinned: boolean }> } {
  const meta: Record<string, { origin: "generated" | "user"; edited: boolean; pinned: boolean }> = {};
  const stripped = items.map((item) => {
    const { origin, edited, pinned, ...rest } = item as any;
    meta[(rest as any).id] = { origin, edited, pinned };
    return rest;
  });
  return { items: stripped, meta };
}

export async function createKit(
  kits: KitRepository,
  ownerId: string,
  input: { jd: string; companyUrl: string; days: number }
): Promise<KitRecord> {
  if (!input.jd?.trim()) throw new KitServiceError("Job description is required.", "INVALID_INPUT");
  if (!input.companyUrl?.trim()) throw new KitServiceError("Company URL is required.", "INVALID_INPUT");
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new KitServiceError("days must be a positive integer.", "INVALID_INPUT");
  }

  const inputHash = computeInputHash(input.jd, input.companyUrl, input.days);
  const existing = await kits.findByOwnerAndInputHash(ownerId, inputHash);
  if (existing) return existing; // avoid unnecessary repeated expensive work

  return kits.create({
    ownerId,
    status: "draft",
    input: { jd: input.jd, company_url: input.companyUrl, days: input.days },
    inputHash,
    kit: null,
    questionMeta: {},
    flashcardMeta: {},
    companyBriefMeta: { origin: "generated", edited: false },
    generationError: null,
  });
}

export async function runGeneration(
  kits: KitRepository,
  llm: LLMProvider,
  kitId: string
): Promise<void> {
  const record = await kits.findById(kitId);
  if (!record) throw new KitServiceError("Kit not found.", "NOT_FOUND", 404);

  await kits.update(kitId, { status: "generating", generationError: null });
  clearProgress(kitId);

  const input: GenerateKitInput = {
    jd: record.input.jd,
    companyUrl: record.input.company_url,
    days: record.input.days,
  };

  try {
    const kit = await generateKit(llm, input, (event) => recordProgress(kitId, event));

    const { items: questionItems, meta: questionMeta } = stripMeta(
      kit.questions.map((q) => asGenerated(q))
    );
    const { items: flashcardItems, meta: flashcardMeta } = stripMeta(
      kit.flashcards.map((f) => asGenerated(f))
    );

    await kits.update(kitId, {
      status: "ready",
      kit: { ...kit, questions: questionItems as Question[], flashcards: flashcardItems as Flashcard[] },
      questionMeta,
      flashcardMeta,
      companyBriefMeta: { origin: "generated", edited: false },
    });
  } catch (err: any) {
    await kits.update(kitId, {
      status: "failed",
      generationError: { code: err?.code ?? "GENERATION_FAILED", message: err?.message ?? String(err) },
    });
    throw err;
  }
}

/**
 * Regenerates just one question category, preserving pinned/edited/user
 * questions in every other category AND within this category.
 */
export async function regenerateQuestionCategory(
  kits: KitRepository,
  llm: LLMProvider,
  kitId: string,
  category: Question["category"]
): Promise<KitRecord> {
  const record = await kits.findById(kitId);
  if (!record || !record.kit) throw new KitServiceError("Kit not found or not yet generated.", "NOT_FOUND", 404);

  const kit = record.kit;
  const existingWithMeta = withMeta(kit.questions, record.questionMeta);
  const existingInCategory = existingWithMeta.filter((q) => q.category === category);
  const existingOtherCategories = existingWithMeta.filter((q) => q.category !== category);

  const nextIdNum = Math.max(0, ...kit.questions.map((q) => parseInt(q.id.replace("q", ""), 10) || 0));
  const ids = new IdCounter("q", nextIdNum);

  const relevantRequirements = kit.role.requirements;
  let research: ResearchResult;
  try {
    research = await researchCompany(record.input.company_url, kit.source.company, env.MAX_PAGES);
  } catch {
    research = { company_pages: [], hiring_pages: [], interview_discussion: [], interview_discussion_unavailable_reason: "re-crawl failed", unavailable_sources: [] };
  }

  const freshlyGenerated = await generateQuestionsForCategory(
    llm,
    category,
    relevantRequirements,
    research,
    ids
  );
  const freshWithMeta = freshlyGenerated.map((q) => asGenerated(q));

  const mergedCategory = mergeGenerated(existingInCategory, freshWithMeta, (q) => q.id);
  const mergedAll = [...existingOtherCategories, ...mergedCategory];

  const coverage = checkCoverage(kit.role.requirements, mergedAll);
  const schedule = allocateSchedule(kit.role.requirements, mergedAll, kit.schedule.days_available);

  const { items: questionItems, meta: questionMeta } = stripMeta(mergedAll);
  const updatedKit: Kit = {
    ...kit,
    questions: questionItems as Question[],
    schedule,
    coverage: { uncovered_requirement_ids: coverage.uncovered_requirement_ids, passes: kit.coverage.passes },
  };

  const { errors } = validateKit(updatedKit);
  if (errors.length > 0) {
    throw new KitServiceError(`Regenerated kit failed validation: ${errors.join("; ")}`, "KIT_VALIDATION_FAILED", 500);
  }

  const updated = await kits.update(kitId, { kit: updatedKit, questionMeta });
  return updated!;
}

export async function regenerateCompanyBrief(
  kits: KitRepository,
  llm: LLMProvider,
  kitId: string
): Promise<KitRecord> {
  const record = await kits.findById(kitId);
  if (!record || !record.kit) throw new KitServiceError("Kit not found or not yet generated.", "NOT_FOUND", 404);

  if (record.companyBriefMeta.edited) {
    // A user-edited brief is never silently overwritten.
    return record;
  }

  const research = await researchCompany(record.input.company_url, record.kit.source.company, env.MAX_PAGES);
  const brief = await generateCompanyBrief(llm, record.input.company_url, research);

  const updatedKit: Kit = { ...record.kit, company_brief: brief };
  const updated = await kits.update(kitId, { kit: updatedKit });
  return updated!;
}

export async function regenerateSchedule(kits: KitRepository, kitId: string): Promise<KitRecord> {
  const record = await kits.findById(kitId);
  if (!record || !record.kit) throw new KitServiceError("Kit not found or not yet generated.", "NOT_FOUND", 404);

  const schedule = allocateSchedule(record.kit.role.requirements, record.kit.questions, record.kit.schedule.days_available);
  const updatedKit: Kit = { ...record.kit, schedule };
  const updated = await kits.update(kitId, { kit: updatedKit });
  return updated!;
}
