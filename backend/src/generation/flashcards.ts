import { z } from "zod";
import { LLMProvider } from "../llm/LLMProvider";
import { Requirement, Question, Flashcard } from "../validation/kitSchema";
import { IdCounter } from "./questions";

const GeneratedFlashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
});
const GeneratedFlashcardsSchema = z.object({ flashcards: z.array(GeneratedFlashcardSchema) });

const SYSTEM_INSTRUCTION = [
  "You write concise flashcards (front = prompt/question, back = concise",
  "answer) for interview preparation. Every flashcard MUST reference one",
  "or more of the exact requirement IDs provided — never invent new IDs.",
].join(" ");

export async function generateFlashcards(
  llm: LLMProvider,
  requirements: Requirement[],
  questions: Question[],
  ids: IdCounter
): Promise<Flashcard[]> {
  if (requirements.length === 0) return [];

  const requirementList = requirements.map((r) => `${r.id}: ${r.text}`).join("\n");
  const questionList = questions
    .slice(0, 20)
    .map((q) => `${q.id} (${q.requirement_ids.join(",")}): ${q.prompt}`)
    .join("\n");

  const prompt = [
    "Generate one flashcard per requirement below (front = a short question,",
    "back = a concise model answer). Use the related interview questions",
    "as context where relevant.",
    "",
    "REQUIREMENTS:",
    requirementList,
    "",
    "RELATED QUESTIONS (for context only):",
    questionList || "(none)",
    "",
    'Respond as JSON: {"flashcards": [{"front": string, "back": string,',
    ' "requirement_ids": string[]}]}',
  ].join("\n");

  const result = await llm.generateStructured(prompt, GeneratedFlashcardsSchema, {
    systemInstruction: SYSTEM_INSTRUCTION,
    maxRetries: 2,
  });

  const validIds = new Set(requirements.map((r) => r.id));

  return result.flashcards
    .map((f) => ({ ...f, requirement_ids: f.requirement_ids.filter((id) => validIds.has(id)) }))
    .filter((f) => f.requirement_ids.length > 0)
    .map((f) => ({
      id: ids.next(),
      front: f.front,
      back: f.back,
      requirement_ids: f.requirement_ids,
    }));
}
