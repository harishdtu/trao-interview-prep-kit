import { ZodSchema } from "zod";
import { LLMProvider } from "../src/llm/LLMProvider";

/**
 * A scriptable fake LLMProvider for tests. Each call to generateStructured
 * consumes the next queued response for that "kind" (matched by a simple
 * heuristic on the prompt text), or falls back to a default generator.
 */
export class FakeLLMProvider implements LLMProvider {
  public calls: string[] = [];

  async generateText(prompt: string): Promise<string> {
    this.calls.push(prompt);
    return "fake text response";
  }

  async generateStructured<T>(prompt: string, schema: ZodSchema<T>): Promise<T> {
    this.calls.push(prompt);

    if (prompt.includes("Extract the role title")) {
      return schema.parse({
        title: "Senior Frontend Engineer",
        seniority: "senior",
        responsibilities: ["Build UI features", "Mentor junior engineers"],
        requirements: [
          { text: "5+ years of React experience", kind: "technical", priority: "must" },
          { text: "Experience mentoring junior engineers", kind: "behavioural", priority: "must" },
          { text: "Familiarity with GraphQL is a bonus", kind: "technical", priority: "nice" },
        ],
      }) as T;
    }

    if (prompt.includes("write a short summary") || prompt.includes("a short summary")) {
      return schema.parse({
        summary: "Acme is a mid-size software company building developer tools.",
        what_they_do: "Acme builds developer productivity tools.",
      }) as T;
    }

    if (prompt.includes("Generate up to")) {
      // Deliberately only cover the FIRST requirement mentioned, to
      // exercise the deterministic coverage-gap second pass in tests.
      const match = prompt.match(/^(r\d+)/m);
      const firstReqId = prompt.match(/r\d+/)?.[0] ?? "r1";
      return schema.parse({
        questions: [
          {
            requirement_ids: [firstReqId],
            prompt: `Tell me about your experience related to ${firstReqId}.`,
            answer_outline: "Discuss relevant experience.",
            difficulty: 2,
          },
        ],
      }) as T;
    }

    if (prompt.includes("uncovered")) {
      const ids = Array.from(prompt.matchAll(/r\d+/g)).map((m) => m[0]);
      const uniqueIds = Array.from(new Set(ids));
      return schema.parse({
        questions: uniqueIds.map((id) => ({
          requirement_ids: [id],
          prompt: `Gap-fill question for ${id}`,
          answer_outline: "Outline.",
          difficulty: 1,
        })),
      }) as T;
    }

    if (prompt.includes("Generate one flashcard")) {
      const ids = Array.from(prompt.matchAll(/r\d+/g)).map((m) => m[0]);
      const uniqueIds = Array.from(new Set(ids));
      return schema.parse({
        flashcards: uniqueIds.map((id) => ({
          front: `What about ${id}?`,
          back: `Answer for ${id}.`,
          requirement_ids: [id],
        })),
      }) as T;
    }

    throw new Error(`FakeLLMProvider: no scripted response for prompt: ${prompt.slice(0, 80)}`);
  }
}
