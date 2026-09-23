import { z } from "zod";

/**
 * Canonical kit schema. Field names and shapes here MUST match the
 * assessment's Appendix A exactly. Do not rename fields.
 */

export const RequirementKind = z.enum(["technical", "behavioural", "domain"]);
export const RequirementPriority = z.enum(["must", "nice"]);
export const QuestionCategory = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);

export const RequirementSchema = z.object({
  id: z.string().regex(/^r\d+$/),
  text: z.string().min(1),
  kind: RequirementKind,
  priority: RequirementPriority,
});

export const QuestionSchema = z.object({
  id: z.string().regex(/^q\d+$/),
  requirement_ids: z.array(z.string().regex(/^r\d+$/)).min(1),
  category: QuestionCategory,
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const FlashcardSchema = z.object({
  id: z.string().regex(/^f\d+$/),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string().regex(/^r\d+$/)),
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string().regex(/^q\d+$/)),
  minutes: z.number().int().nonnegative(),
});

export const KitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().nonnegative(),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  }),
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: z.object({
    days_available: z.number().int().positive(),
    days: z.array(ScheduleDaySchema),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string().regex(/^r\d+$/)),
    passes: z.number().int().nonnegative(),
  }),
});

export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Kit = z.infer<typeof KitSchema>;

/**
 * Extra structural invariants that zod's shape checks alone don't cover:
 * every requirement_id referenced by a question/flashcard/schedule item
 * must exist in role.requirements, and every question_id referenced by
 * the schedule must exist in questions. Called after KitSchema.parse().
 */
export function validateKitReferentialIntegrity(kit: Kit): string[] {
  const errors: string[] = [];
  const reqIds = new Set(kit.role.requirements.map((r) => r.id));
  const qIds = new Set(kit.questions.map((q) => q.id));

  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) {
      if (!reqIds.has(rid)) {
        errors.push(`question ${q.id} references unknown requirement ${rid}`);
      }
    }
  }
  for (const f of kit.flashcards) {
    for (const rid of f.requirement_ids) {
      if (!reqIds.has(rid)) {
        errors.push(`flashcard ${f.id} references unknown requirement ${rid}`);
      }
    }
  }
  for (const day of kit.schedule.days) {
    for (const qid of day.question_ids) {
      if (!qIds.has(qid)) {
        errors.push(`schedule day ${day.day} references unknown question ${qid}`);
      }
    }
  }
  if (kit.schedule.days.length !== kit.schedule.days_available) {
    errors.push(
      `schedule.days length (${kit.schedule.days.length}) does not match days_available (${kit.schedule.days_available})`
    );
  }
  const expectedDayNumbers = new Set(
    Array.from({ length: kit.schedule.days_available }, (_, i) => i + 1)
  );
  const actualDayNumbers = new Set(kit.schedule.days.map((d) => d.day));
  for (const n of expectedDayNumbers) {
    if (!actualDayNumbers.has(n)) errors.push(`schedule is missing day ${n}`);
  }

  return errors;
}

export function validateKit(kit: unknown): { kit: Kit; errors: string[] } {
  const parsed = KitSchema.parse(kit); // throws ZodError on structural mismatch
  const errors = validateKitReferentialIntegrity(parsed);
  return { kit: parsed, errors };
}
