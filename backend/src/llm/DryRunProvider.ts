import { ZodSchema } from "zod";
import { LLMProvider } from "./LLMProvider";

/**
 * A scripted, content-aware provider used ONLY when EVALUATE_DRY_RUN=true
 * and no GEMINI_API_KEY is set. This lets the batch evaluator CLI's
 * process wiring (argv parsing, sequential pipeline stages, file I/O,
 * output-contract shape) be smoke-tested end-to-end without a live
 * Gemini key or network access to generativelanguage.googleapis.com.
 * It is NOT a substitute for real evaluation and produces generic,
 * non-insightful content — real grading requires GEMINI_API_KEY.
 */
export class DryRunProvider implements LLMProvider {
  async generateText(): Promise<string> {
    return "dry-run text response";
  }

  async generateStructured<T>(prompt: string, schema: ZodSchema<T>): Promise<T> {
    if (prompt.includes("Extract the role title")) {
      const jdMatch = prompt.split("JOB DESCRIPTION:\n")[1] ?? "";
      const sentences = jdMatch
        .split(/[.\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8)
        .slice(0, 4);

      const requirements = sentences.map((text) => ({
        text,
        kind: /mentor|collaborat|communicat|lead/i.test(text) ? "behavioural" : "technical",
        priority: /must|required|need to have|\d\+\s*years/i.test(text) ? "must" : "nice",
      }));

      return schema.parse({
        title: "Software Engineer",
        seniority: "unspecified",
        responsibilities: sentences.slice(0, 2).length ? sentences.slice(0, 2) : ["Contribute to the team's goals."],
        requirements: requirements.length > 0 ? requirements : [{ text: "General role requirements", kind: "technical", priority: "nice" }],
      }) as T;
    }

    if (prompt.includes("a short summary")) {
      return schema.parse({
        summary: "Dry-run summary: limited company research is available in this smoke-test mode.",
        what_they_do: "Unknown in dry-run mode.",
      }) as T;
    }

    if (prompt.includes("Generate up to")) {
      const idSection = prompt.split("AVAILABLE REQUIREMENT IDS")[1] ?? "";
      const ids = Array.from(new Set(Array.from(idSection.matchAll(/r\d+/g)).map((m) => m[0]))).slice(0, 2);
      return schema.parse({
        questions: ids.map((id) => ({
          requirement_ids: [id],
          prompt: `(dry-run) Discuss your experience relevant to requirement ${id}.`,
          answer_outline: "Discuss relevant experience and give a concrete example.",
          difficulty: 2,
        })),
      }) as T;
    }

    if (prompt.includes("UNCOVERED REQUIREMENTS")) {
      const section = prompt.split("UNCOVERED REQUIREMENTS:")[1] ?? "";
      const ids = Array.from(new Set(Array.from(section.matchAll(/r\d+/g)).map((m) => m[0])));
      return schema.parse({
        questions: ids.map((id) => ({
          requirement_ids: [id],
          prompt: `(dry-run) Gap-fill question for requirement ${id}.`,
          answer_outline: "Outline.",
          difficulty: 1,
        })),
      }) as T;
    }

    if (prompt.includes("Generate one flashcard")) {
      const section = prompt.split("REQUIREMENTS:")[1] ?? "";
      const ids = Array.from(new Set(Array.from(section.matchAll(/r\d+/g)).map((m) => m[0])));
      return schema.parse({
        flashcards: ids.map((id) => ({
          front: `(dry-run) Key point for ${id}?`,
          back: `(dry-run) Answer for ${id}.`,
          requirement_ids: [id],
        })),
      }) as T;
    }

    // Fallback: best-effort empty-ish structure; callers filter empty results gracefully.
    return schema.parse({}) as T;
  }
}
