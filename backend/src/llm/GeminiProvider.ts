import { GoogleGenerativeAI } from "@google/generative-ai";
import { ZodSchema } from "zod";
import { LLMProvider } from "./LLMProvider";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonBlock(raw: string): string {
  // Gemini sometimes wraps JSON in ```json fences or adds preamble text.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  const starts = [firstBrace, firstBracket].filter((i) => i >= 0);
  if (starts.length === 0) return raw.trim();
  const start = Math.min(...starts);
  const lastBrace = raw.lastIndexOf("}");
  const lastBracket = raw.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end > start) return raw.slice(start, end + 1).trim();
  return raw.trim();
}

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required to construct GeminiProvider");
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  private async callOnce(prompt: string, systemInstruction?: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      ...(systemInstruction ? { systemInstruction } : {}),
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  private async callWithBackoff(
    prompt: string,
    systemInstruction: string | undefined,
    maxRetries: number
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.callOnce(prompt, systemInstruction);
      } catch (err: any) {
        lastError = err;
        const status = err?.status ?? err?.response?.status;
        const isRetryable =
          status === 429 || status === 503 || status === undefined || status >= 500;
        if (!isRetryable || attempt === maxRetries) break;
        const backoffMs = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 250;
        await sleep(backoffMs);
      }
    }
    throw lastError;
  }

  async generateText(
    prompt: string,
    opts?: { systemInstruction?: string }
  ): Promise<string> {
    return this.callWithBackoff(prompt, opts?.systemInstruction, 3);
  }

  async generateStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
    opts?: { systemInstruction?: string; maxRetries?: number }
  ): Promise<T> {
    const maxRetries = opts?.maxRetries ?? 2;
    const baseInstruction =
      (opts?.systemInstruction ? opts.systemInstruction + "\n\n" : "") +
      "Respond with ONLY valid JSON matching the requested shape. " +
      "No markdown fences, no commentary, no preamble, no trailing text.";

    let lastError: unknown;
    let correctivePrompt = prompt;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let raw: string;
      try {
        raw = await this.callWithBackoff(correctivePrompt, baseInstruction, 2);
      } catch (err) {
        lastError = err;
        continue;
      }

      try {
        const jsonText = extractJsonBlock(raw);
        const parsedJson = JSON.parse(jsonText);
        return schema.parse(parsedJson);
      } catch (err) {
        lastError = err;
        correctivePrompt =
          prompt +
          "\n\nYour previous response could not be parsed as valid JSON matching " +
          "the required schema. Return ONLY corrected valid JSON, nothing else. " +
          `Previous response was:\n${raw?.slice(0, 500) ?? ""}`;
      }
    }

    throw new Error(
      `GeminiProvider.generateStructured failed after ${maxRetries + 1} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}
