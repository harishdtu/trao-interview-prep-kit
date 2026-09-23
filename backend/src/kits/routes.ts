import { Router } from "express";
import { z } from "zod";
import { Repositories } from "../db/repository";
import { LLMProvider } from "../llm/LLMProvider";
import { requireAuth } from "../middleware/requireAuth";
import {
  createKit,
  runGeneration,
  regenerateQuestionCategory,
  regenerateCompanyBrief,
  regenerateSchedule,
  KitServiceError,
} from "./kitService";
import { getProgress } from "./progressTracker";
import { QuestionCategory, validateKit, Kit } from "../validation/kitSchema";
import { mergeGenerated } from "./editableEntity";
import { MAX_JD_CHARS } from "../generation/pipeline";

const CreateKitSchema = z.object({
  jd: z.string().min(1).max(MAX_JD_CHARS, `Job description must be ${MAX_JD_CHARS} characters or fewer.`),
  company_url: z.string().url(),
  days: z.number().int().positive().max(365, "days must be 365 or fewer."),
});

function toPublicKitRecord(record: any) {
  // Merge question/flashcard editable-state metadata into the response
  // so the frontend can render pinned/edited indicators.
  const kit = record.kit
    ? {
        ...record.kit,
        questions: record.kit.questions.map((q: any) => ({
          ...q,
          ...(record.questionMeta[q.id] ?? { origin: "generated", edited: false, pinned: false }),
        })),
        flashcards: record.kit.flashcards.map((f: any) => ({
          ...f,
          ...(record.flashcardMeta[f.id] ?? { origin: "generated", edited: false, pinned: false }),
        })),
        company_brief: { ...record.kit.company_brief, ...record.companyBriefMeta },
      }
    : null;

  return {
    id: record.id,
    status: record.status,
    input: record.input,
    kit,
    generationError: record.generationError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function assertOwnedKit(repos: Repositories, userId: string, kitId: string) {
  const record = await repos.kits.findById(kitId);
  if (!record) throw new KitServiceError("Kit not found.", "NOT_FOUND", 404);
  if (record.ownerId !== userId) throw new KitServiceError("Kit not found.", "NOT_FOUND", 404); // never leak existence
  return record;
}

export function buildKitsRouter(repos: Repositories, llm: LLMProvider): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/", async (req, res, next) => {
    try {
      const parsed = CreateKitSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } });
      }
      const record = await createKit(repos.kits, req.session.userId!, {
        jd: parsed.data.jd,
        companyUrl: parsed.data.company_url,
        days: parsed.data.days,
      });
      res.status(201).json({ kit: toPublicKitRecord(record) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const records = await repos.kits.findByOwner(req.session.userId!);
      res.json({ kits: records.map(toPublicKitRecord) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      res.json({ kit: toPublicKitRecord(record) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      await assertOwnedKit(repos, req.session.userId!, req.params.id);
      await repos.kits.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/generate", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (record.status === "generating") {
        return res.status(409).json({ error: { code: "ALREADY_GENERATING", message: "Generation already in progress." } });
      }
      // Respond immediately; generation runs in the background and the
      // client polls GET /:id/progress and GET /:id for completion.
      res.status(202).json({ status: "generating" });
      runGeneration(repos.kits, llm, record.id).catch(() => {
        /* error already persisted onto the kit record by runGeneration */
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/progress", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      res.json({ status: record.status, events: getProgress(record.id), error: record.generationError });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/regenerate/company-brief", async (req, res, next) => {
    try {
      await assertOwnedKit(repos, req.session.userId!, req.params.id);
      const updated = await regenerateCompanyBrief(repos.kits, llm, req.params.id);
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/regenerate/questions/:category", async (req, res, next) => {
    try {
      await assertOwnedKit(repos, req.session.userId!, req.params.id);
      const category = QuestionCategory.safeParse(req.params.category);
      if (!category.success) {
        return res.status(400).json({ error: { code: "INVALID_CATEGORY", message: "Unknown question category." } });
      }
      const updated = await regenerateQuestionCategory(repos.kits, llm, req.params.id, category.data);
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/regenerate/schedule", async (req, res, next) => {
    try {
      await assertOwnedKit(repos, req.session.userId!, req.params.id);
      const updated = await regenerateSchedule(repos.kits, req.params.id);
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Question editing ----

  const QuestionInputSchema = z.object({
    requirement_ids: z.array(z.string()),
    category: QuestionCategory,
    prompt: z.string(),
    answer_outline: z.string(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  });

  router.post("/:id/questions", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const parsed = QuestionInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } });
      }
      const nextIdNum = Math.max(0, ...record.kit.questions.map((q) => parseInt(q.id.replace(/^q/, ""), 10) || 0));
      const id = `q${nextIdNum + 1}`;
      const question = { id, ...parsed.data };
      const updatedKit: Kit = { ...record.kit, questions: [...record.kit.questions, question] };
      const { errors } = validateKit(updatedKit);
      if (errors.length > 0) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: errors.join("; ") } });
      }
      const updated = await repos.kits.update(record.id, {
        kit: updatedKit,
        questionMeta: { ...record.questionMeta, [id]: { origin: "user", edited: false, pinned: false } },
      });
      res.status(201).json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/questions/:questionId", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const idx = record.kit.questions.findIndex((q) => q.id === req.params.questionId);
      if (idx === -1) throw new KitServiceError("Question not found.", "NOT_FOUND", 404);

      const patch = req.body ?? {};
      const nextQuestions = [...record.kit.questions];
      nextQuestions[idx] = { ...nextQuestions[idx], ...patch, id: nextQuestions[idx].id };

      const updatedKit: Kit = { ...record.kit, questions: nextQuestions };
      const { errors } = validateKit(updatedKit);
      if (errors.length > 0) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: errors.join("; ") } });
      }

      const existingMeta = record.questionMeta[req.params.questionId] ?? { origin: "generated", edited: false, pinned: false };
      const pinnedPatch = typeof patch.pinned === "boolean" ? patch.pinned : existingMeta.pinned;
      const nextMeta = {
        ...existingMeta,
        pinned: pinnedPatch,
        edited: existingMeta.origin === "user" ? existingMeta.edited : true,
      };

      const updated = await repos.kits.update(record.id, {
        kit: updatedKit,
        questionMeta: { ...record.questionMeta, [req.params.questionId]: nextMeta },
      });
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id/questions/:questionId", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const nextQuestions = record.kit.questions.filter((q) => q.id !== req.params.questionId);
      const schedule = { ...record.kit.schedule, days: record.kit.schedule.days.map((d) => ({ ...d, question_ids: d.question_ids.filter((qid) => qid !== req.params.questionId) })) };
      const updatedKit: Kit = { ...record.kit, questions: nextQuestions, schedule };
      const { questionMeta } = record;
      delete questionMeta[req.params.questionId];
      const updated = await repos.kits.update(record.id, { kit: updatedKit, questionMeta });
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Flashcard editing ----

  const FlashcardInputSchema = z.object({
    front: z.string(),
    back: z.string(),
    requirement_ids: z.array(z.string()),
  });

  router.post("/:id/flashcards", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const parsed = FlashcardInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } });
      }
      const nextIdNum = Math.max(0, ...record.kit.flashcards.map((f) => parseInt(f.id.replace(/^f/, ""), 10) || 0));
      const id = `f${nextIdNum + 1}`;
      const flashcard = { id, ...parsed.data };
      const updatedKit: Kit = { ...record.kit, flashcards: [...record.kit.flashcards, flashcard] };
      const updated = await repos.kits.update(record.id, {
        kit: updatedKit,
        flashcardMeta: { ...record.flashcardMeta, [id]: { origin: "user", edited: false, pinned: false } },
      });
      res.status(201).json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/flashcards/:flashcardId", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const idx = record.kit.flashcards.findIndex((f) => f.id === req.params.flashcardId);
      if (idx === -1) throw new KitServiceError("Flashcard not found.", "NOT_FOUND", 404);
      const nextFlashcards = [...record.kit.flashcards];
      nextFlashcards[idx] = { ...nextFlashcards[idx], ...req.body, id: nextFlashcards[idx].id };
      const updatedKit: Kit = { ...record.kit, flashcards: nextFlashcards };
      const existingMeta = record.flashcardMeta[req.params.flashcardId] ?? { origin: "generated", edited: false, pinned: false };
      const updated = await repos.kits.update(record.id, {
        kit: updatedKit,
        flashcardMeta: { ...record.flashcardMeta, [req.params.flashcardId]: { ...existingMeta, edited: true } },
      });
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id/flashcards/:flashcardId", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const nextFlashcards = record.kit.flashcards.filter((f) => f.id !== req.params.flashcardId);
      const updatedKit: Kit = { ...record.kit, flashcards: nextFlashcards };
      const { flashcardMeta } = record;
      delete flashcardMeta[req.params.flashcardId];
      const updated = await repos.kits.update(record.id, { kit: updatedKit, flashcardMeta });
      res.json({ kit: toPublicKitRecord(updated) });
    } catch (err) {
      next(err);
    }
  });

  // ---- Practice mode ----

  const PracticeReviewSchema = z.object({
    flashcardId: z.string(),
    confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  });

  router.get("/:id/practice", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const state = await repos.practice.getOrCreate(req.session.userId!, record.id);

      const ordered = [...record.kit.flashcards].sort((a, b) => {
        const ca = state.cards[a.id]?.confidence ?? 0;
        const cb = state.cards[b.id]?.confidence ?? 0;
        return ca - cb; // lowest confidence (incl. never-practiced = 0) first
      });

      res.json({
        flashcards: ordered,
        progress: state.cards,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/practice", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const parsed = PracticeReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "flashcardId and confidence (1-3) are required." } });
      }
      const state = await repos.practice.getOrCreate(req.session.userId!, record.id);
      const prior = state.cards[parsed.data.flashcardId];
      const nextCards = {
        ...state.cards,
        [parsed.data.flashcardId]: {
          flashcardId: parsed.data.flashcardId,
          confidence: parsed.data.confidence,
          timesReviewed: (prior?.timesReviewed ?? 0) + 1,
          lastReviewedAt: new Date().toISOString(),
        },
      };
      const updated = await repos.practice.update(state.id, { cards: nextCards });
      res.json({ progress: updated!.cards });
    } catch (err) {
      next(err);
    }
  });

  // ---- Weak Spots Report (creative feature) ----

  router.get("/:id/weak-spots", async (req, res, next) => {
    try {
      const record = await assertOwnedKit(repos, req.session.userId!, req.params.id);
      if (!record.kit) throw new KitServiceError("Kit not yet generated.", "NOT_READY");
      const state = await repos.practice.getOrCreate(req.session.userId!, record.id);

      const lowConfidenceCards = record.kit.flashcards
        .filter((f) => (state.cards[f.id]?.confidence ?? 0) <= 1)
        .map((f) => ({ id: f.id, front: f.front, confidence: state.cards[f.id]?.confidence ?? null }));

      const neverPracticed = record.kit.flashcards
        .filter((f) => !state.cards[f.id])
        .map((f) => ({ id: f.id, front: f.front }));

      const weakRequirementIds = new Set<string>();
      for (const card of record.kit.flashcards) {
        const conf = state.cards[card.id]?.confidence;
        if (conf === 1 || conf === undefined) {
          for (const rid of card.requirement_ids) weakRequirementIds.add(rid);
        }
      }
      const weakRequirements = record.kit.role.requirements.filter((r) => weakRequirementIds.has(r.id));

      res.json({
        uncovered_requirement_ids: record.kit.coverage.uncovered_requirement_ids,
        low_confidence_flashcards: lowConfidenceCards,
        never_practiced_flashcards: neverPracticed,
        weak_requirements: weakRequirements,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
