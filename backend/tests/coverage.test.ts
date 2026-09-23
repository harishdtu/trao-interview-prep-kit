import { describe, it, expect } from "vitest";
import { checkCoverage } from "../src/coverage/coverage";
import { Requirement, Question } from "../src/validation/kitSchema";

const req = (id: string, priority: "must" | "nice" = "must"): Requirement => ({
  id,
  text: `requirement ${id}`,
  kind: "technical",
  priority,
});

const q = (id: string, requirement_ids: string[]): Question => ({
  id,
  requirement_ids,
  category: "technical",
  prompt: "prompt",
  answer_outline: "outline",
  difficulty: 1,
});

describe("checkCoverage", () => {
  it("returns no uncovered requirements when every requirement is referenced", () => {
    const requirements = [req("r1"), req("r2")];
    const questions = [q("q1", ["r1"]), q("q2", ["r2"])];
    const result = checkCoverage(requirements, questions);
    expect(result.uncovered_requirement_ids).toEqual([]);
    expect(result.uncovered_must_requirement_ids).toEqual([]);
  });

  it("flags requirements with zero referencing questions", () => {
    const requirements = [req("r1"), req("r2"), req("r3")];
    const questions = [q("q1", ["r1"]), q("q2", ["r3"])];
    const result = checkCoverage(requirements, questions);
    expect(result.uncovered_requirement_ids).toEqual(["r2"]);
  });

  it("separately tracks uncovered MUST requirements vs nice-to-have", () => {
    const requirements = [req("r1", "must"), req("r2", "nice")];
    const questions: Question[] = [];
    const result = checkCoverage(requirements, questions);
    expect(result.uncovered_requirement_ids).toEqual(["r1", "r2"]);
    expect(result.uncovered_must_requirement_ids).toEqual(["r1"]);
  });

  it("counts a question that references multiple requirements toward all of them", () => {
    const requirements = [req("r1"), req("r2")];
    const questions = [q("q1", ["r1", "r2"])];
    const result = checkCoverage(requirements, questions);
    expect(result.uncovered_requirement_ids).toEqual([]);
  });

  it("handles zero requirements and zero questions", () => {
    const result = checkCoverage([], []);
    expect(result.uncovered_requirement_ids).toEqual([]);
    expect(result.uncovered_must_requirement_ids).toEqual([]);
  });
});
