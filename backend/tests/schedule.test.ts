import { describe, it, expect } from "vitest";
import { allocateSchedule } from "../src/scheduling/schedule";
import { Requirement, Question } from "../src/validation/kitSchema";

const req = (id: string, priority: "must" | "nice" = "must"): Requirement => ({
  id,
  text: `requirement ${id}`,
  kind: "technical",
  priority,
});

const q = (
  id: string,
  requirement_ids: string[],
  difficulty: 1 | 2 | 3 = 1,
  category: Question["category"] = "technical"
): Question => ({
  id,
  requirement_ids,
  category,
  prompt: "prompt",
  answer_outline: "outline",
  difficulty,
});

function allQuestionIds(days: ReturnType<typeof allocateSchedule>["days"]) {
  return days.flatMap((d) => d.question_ids);
}

describe("allocateSchedule", () => {
  const requirements = [req("r1"), req("r2", "nice"), req("r3")];
  const questions = [
    q("q1", ["r1"], 3, "technical"),
    q("q2", ["r2"], 1, "company-fit"),
    q("q3", ["r3"], 2, "system-design"),
    q("q4", ["r1"], 2, "behavioural"),
    q("q5", ["r3"], 1, "technical"),
  ];

  it("produces exactly the requested number of days for 1 day", () => {
    const result = allocateSchedule(requirements, questions, 1);
    expect(result.days_available).toBe(1);
    expect(result.days).toHaveLength(1);
    expect(result.days[0].day).toBe(1);
  });

  it("produces exactly the requested number of days for 5 days", () => {
    const result = allocateSchedule(requirements, questions, 5);
    expect(result.days).toHaveLength(5);
    expect(result.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it("produces exactly the requested number of days for 60 days (more days than questions)", () => {
    const result = allocateSchedule(requirements, questions, 60);
    expect(result.days).toHaveLength(60);
    // every day object still exists even if some have no questions
    expect(result.days[59].day).toBe(60);
    const totalScheduled = allQuestionIds(result.days).length;
    expect(totalScheduled).toBe(questions.length);
  });

  it("only uses integer minute totals", () => {
    const result = allocateSchedule(requirements, questions, 3);
    for (const day of result.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
    }
  });

  it("never references a question ID that was not provided", () => {
    const result = allocateSchedule(requirements, questions, 3);
    const validIds = new Set(questions.map((qq) => qq.id));
    for (const qid of allQuestionIds(result.days)) {
      expect(validIds.has(qid)).toBe(true);
    }
  });

  it("schedules every question exactly once across all days", () => {
    const result = allocateSchedule(requirements, questions, 4);
    const scheduled = allQuestionIds(result.days);
    expect(new Set(scheduled).size).toBe(questions.length);
    expect(scheduled).toHaveLength(questions.length);
  });

  it("places every must-requirement's question earlier than or on par with nice-to-have questions", () => {
    // q1 (must r1, difficulty 3) should be scheduled before q2 (nice r2, difficulty 1)
    const result = allocateSchedule(requirements, questions, 5);
    const dayOf = (qid: string) =>
      result.days.find((d) => d.question_ids.includes(qid))!.day;
    expect(dayOf("q1")).toBeLessThanOrEqual(dayOf("q2"));
  });

  it("throws on non-integer or non-positive day counts", () => {
    expect(() => allocateSchedule(requirements, questions, 0)).toThrow();
    expect(() => allocateSchedule(requirements, questions, -1)).toThrow();
    expect(() => allocateSchedule(requirements, questions, 2.5)).toThrow();
  });

  it("handles zero questions gracefully", () => {
    const result = allocateSchedule(requirements, [], 3);
    expect(result.days).toHaveLength(3);
    for (const day of result.days) {
      expect(day.question_ids).toEqual([]);
      expect(day.minutes).toBe(0);
    }
  });
});
