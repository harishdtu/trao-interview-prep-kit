import type { Requirement, Question } from "../validation/kitSchema";

/**
 * Deterministic coverage check. For every requirement, determine whether
 * at least one question references its ID. This is plain code — no LLM
 * call is ever used to decide coverage.
 */
export function checkCoverage(
  requirements: Requirement[],
  questions: Question[]
) {
  const referenced = new Set<string>();

  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      referenced.add(rid);
    }
  }

  const uncovered = requirements
    .filter((r) => !referenced.has(r.id))
    .map((r) => r.id);

  const uncoveredMust = requirements
    .filter((r) => r.priority === "must" && !referenced.has(r.id))
    .map((r) => r.id);

  return {
    uncovered_requirement_ids: uncovered,
    uncovered_must_requirement_ids: uncoveredMust,
  };
}
