import { z } from "zod";
import { LLMProvider } from "../llm/LLMProvider";
import { RequirementKind, RequirementPriority } from "../validation/kitSchema";

const ExtractedRoleSchema = z.object({
  title: z.string(),
  seniority: z.string().nullable(),
  responsibilities: z.array(z.string()),
  requirements: z.array(
    z.object({
      text: z.string(),
      kind: RequirementKind,
      priority: RequirementPriority,
    })
  ),
});

export type ExtractedRole = z.infer<typeof ExtractedRoleSchema>;

const SYSTEM_INSTRUCTION = [
  "You extract structured role and requirement data from a job description.",
  "Only include requirements that are actually supported by the text.",
  "Do not invent requirements. If the JD is very short, return fewer requirements",
  "rather than padding the list.",
  "Classify priority as 'must' when language like \"required\", \"must have\",",
  "or years-of-experience minimums are used; classify as 'nice' when language",
  "like \"bonus\", \"nice to have\", or \"preferred\" is used.",
  "Classify kind as 'technical' for tools/languages/frameworks/architecture,",
  "'behavioural' for soft skills/collaboration/leadership, and 'domain' for",
  "industry or product-domain knowledge.",
].join(" ");
export async function extractRequirements(
  llm: LLMProvider,
  jd: string
): Promise<Omit<ExtractedRole, "seniority"> & { seniority: string }> {
  const prompt = [
    "Extract the role title, seniority, responsibilities, and requirements",
    "from the following job description. Respond as JSON with shape:",
    '{"title": string, "seniority": string, "responsibilities": string[],',
    ' "requirements": [{"text": string, "kind": "technical"|"behavioural"|"domain",',
    '  "priority": "must"|"nice"}]}',
    "",
    "JOB DESCRIPTION:",
    jd,
  ].join("\n");

  const result = await llm.generateStructured(prompt, ExtractedRoleSchema, {
    systemInstruction: SYSTEM_INSTRUCTION,
    maxRetries: 2,
  });

  return {
  ...result,
  seniority: result.seniority ?? "Not specified",
};
}

/** Assigns stable r1, r2, r3... IDs to extracted requirements. */
export function assignRequirementIds(
  extracted: ExtractedRole["requirements"]
): { id: string; text: string; kind: ExtractedRole["requirements"][number]["kind"]; priority: ExtractedRole["requirements"][number]["priority"] }[] {
  return extracted.map((req, idx) => ({ id: `r${idx + 1}`, ...req }));
}
