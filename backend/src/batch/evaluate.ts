import { readFileSync, writeFileSync } from "fs";
import { z } from "zod";
import { generateKit, MAX_JD_CHARS } from "../generation/pipeline";
import { validateKit } from "../validation/kitSchema";
import { LLMProvider } from "../llm/LLMProvider";
import { GeminiProvider } from "../llm/GeminiProvider";
import { env } from "../config/env";
const CaseSchema = z.object({
  id: z.string(),
  jd: z.string().max(MAX_JD_CHARS),
  company_url: z.string(),
  days: z.number().int().positive().max(365),
});
const CasesArraySchema = z.array(CaseSchema);

interface KitResultEntry {
  id: string;
  status: "ok" | "failed";
  kit: unknown | null;
  error: { code: string; message: string } | null;
}

function parseArgs(argv: string[]): { input: string; output: string; concurrency: number } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = argv[++i];
    else if (argv[i] === "--output") args.output = argv[++i];
    else if (argv[i] === "--concurrency") args.concurrency = argv[++i];
  }
  if (!args.input || !args.output) {
    throw new Error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
  }
  return {
    input: args.input,
    output: args.output,
    concurrency: args.concurrency ? parseInt(args.concurrency, 10) : 2,
  };
}

async function runWithBoundedConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}

export async function evaluateCase(
  llm: LLMProvider,
  testCase: z.infer<typeof CaseSchema>
): Promise<KitResultEntry> {
  try {
    const kit = await generateKit(llm, {
      jd: testCase.jd,
      companyUrl: testCase.company_url,
      days: testCase.days,
    });

    const { errors } = validateKit(kit);
    if (errors.length > 0) {
      return {
        id: testCase.id,
        status: "failed",
        kit: null,
        error: { code: "KIT_VALIDATION_FAILED", message: errors.join("; ") },
      };
    }

    return { id: testCase.id, status: "ok", kit, error: null };
  } catch (err: any) {
    return {
      id: testCase.id,
      status: "failed",
      kit: null,
      error: { code: err?.code ?? "GENERATION_FAILED", message: err?.message ?? String(err) },
    };
  }
}

export async function runBatchEvaluation(
  llm: LLMProvider,
  cases: z.infer<typeof CasesArraySchema>,
  concurrency = 2
): Promise<{ version: string; generated_at: string; kits: KitResultEntry[] }> {
  const results = await runWithBoundedConcurrency(cases, concurrency, (c) => evaluateCase(llm, c));
  return {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits: results,
  };
}

async function resolveLLMProvider(): Promise<LLMProvider> {
  if (env.GEMINI_API_KEY) {
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  }
  if (process.env.EVALUATE_DRY_RUN === "true") {
    // Dry-run mode for local smoke-testing the CLI's argv/file-I/O wiring
    // without a real Gemini key. NEVER used unless explicitly opted into
    // via EVALUATE_DRY_RUN=true; real evaluation always requires
    // GEMINI_API_KEY and calls the genuine Gemini API.
    const { DryRunProvider } = await import("../llm/DryRunProvider.js");
    // eslint-disable-next-line no-console
    console.warn("[evaluate] EVALUATE_DRY_RUN=true — using a scripted dry-run provider, NOT real Gemini.");
    return new DryRunProvider();
  }
  throw new Error("GEMINI_API_KEY must be set to run the batch evaluator.");
}

async function main() {
  const { input, output, concurrency } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(input, "utf-8"));
  const parsedCases = CasesArraySchema.safeParse(raw);
  if (!parsedCases.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid input file:", parsedCases.error.message);
    process.exit(1);
  }

  const llm: LLMProvider = await resolveLLMProvider();

  const output_ = await runBatchEvaluation(llm, parsedCases.data, concurrency);
  writeFileSync(output, JSON.stringify(output_, null, 2), "utf-8");

  const okCount = output_.kits.filter((k) => k.status === "ok").length;
  // eslint-disable-next-line no-console
  console.log(`Wrote ${output_.kits.length} results to ${output} (${okCount} ok, ${output_.kits.length - okCount} failed)`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Batch evaluation failed:", err);
    process.exit(1);
  });
}
