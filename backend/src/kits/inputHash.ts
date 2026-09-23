import { createHash } from "crypto";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeInputHash(jd: string, companyUrl: string, days: number): string {
  const normalized = `${normalize(jd)}|${normalize(companyUrl)}|${days}`;
  return createHash("sha256").update(normalized).digest("hex");
}
