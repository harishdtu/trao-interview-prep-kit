import { Question, Requirement, ScheduleDay } from "../validation/kitSchema";

const CATEGORY_WEIGHT: Record<string, number> = {
  technical: 3,
  "system-design": 3,
  behavioural: 2,
  "company-fit": 1,
};

const MINUTES_PER_QUESTION_BY_DIFFICULTY: Record<number, number> = {
  1: 10,
  2: 15,
  3: 25,
};

interface ScoredQuestion {
  question: Question;
  score: number;
}

function priorityScore(requirements: Map<string, Requirement>, q: Question): number {
  // A question can reference multiple requirements; take the max urgency
  // across them so a question covering any "must" requirement is treated
  // as must-priority.
  let best = 0;
  for (const rid of q.requirement_ids) {
    const req = requirements.get(rid);
    if (!req) continue;
    const p = req.priority === "must" ? 10 : 3;
    if (p > best) best = p;
  }
  return best;
}

function scoreQuestions(requirements: Requirement[], questions: Question[]): ScoredQuestion[] {
  const reqMap = new Map(requirements.map((r) => [r.id, r]));
  return questions
    .map((question) => {
      const score =
        priorityScore(reqMap, question) +
        question.difficulty * 2 +
        (CATEGORY_WEIGHT[question.category] ?? 1);
      return { question, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // stable, deterministic tiebreak by id
      return a.question.id.localeCompare(b.question.id);
    });
}

/**
 * Deterministically allocate all questions across exactly `days` days.
 * Higher-priority / harder / more heavily-weighted-category questions are
 * placed earlier. Every "must" requirement is guaranteed to appear in at
 * least one scheduled question (as long as at least one question covers
 * it — coverage-gap filling happens upstream in the generation pipeline).
 */
export function allocateSchedule(
  requirements: Requirement[],
  questions: Question[],
  days: number
): { days_available: number; days: ScheduleDay[] } {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("days must be a positive integer");
  }

  const scored = scoreQuestions(requirements, questions);

  const dayBuckets: ScheduleDay[] = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    focus: "",
    question_ids: [],
    minutes: 0,
  }));

  // Round-robin the sorted (highest-priority-first) list across days so
  // must/hard material lands on earlier days first, then continues
  // cycling — this keeps distribution sensible even when there are far
  // more questions than days.
  scored.forEach(({ question }, idx) => {
    const bucket = dayBuckets[idx % days];
    bucket.question_ids.push(question.id);
    bucket.minutes += MINUTES_PER_QUESTION_BY_DIFFICULTY[question.difficulty] ?? 15;
  });

  // Derive a human-readable focus per day from the categories present.
  const questionById = new Map(questions.map((q) => [q.id, q]));
  for (const bucket of dayBuckets) {
    const categories = new Set(
      bucket.question_ids.map((qid) => questionById.get(qid)?.category).filter(Boolean)
    );
    bucket.focus =
      categories.size > 0
        ? Array.from(categories).join(" + ")
        : "Review";
  }

  return { days_available: days, days: dayBuckets };
}
