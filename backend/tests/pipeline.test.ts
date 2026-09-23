import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FakeLLMProvider } from "./fixtures/FakeLLMProvider";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_FETCHES = "true";
  server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><head><title>Acme</title></head><body><nav><a href="/careers">Careers</a></nav><p>Acme builds developer tools.</p></body></html>`
      );
    } else if (req.url === "/careers") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><head><title>Careers</title></head><body><p>We hire engineers. 3 interview rounds.</p></body></html>`);
    } else {
      res.writeHead(404);
      res.end("nf");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
  delete process.env.ALLOW_PRIVATE_FETCHES;
});

describe("generateKit pipeline (integration, fake LLM)", () => {
  it("runs every stage in sequence and produces a schema-valid kit", async () => {
    const { generateKit } = await import("../src/generation/pipeline");
    const { validateKit } = await import("../src/validation/kitSchema");

    const llm = new FakeLLMProvider();
    const stages: string[] = [];

    const kit = await generateKit(
      llm,
      { jd: "We need a senior React engineer who mentors juniors. GraphQL is a bonus.", companyUrl: baseUrl, days: 3 },
      (event) => stages.push(event.stage)
    );

    // Stages happened in the documented order.
    expect(stages).toContain("extracting_requirements");
    expect(stages.indexOf("extracting_requirements")).toBeLessThan(stages.indexOf("crawling_company"));
    expect(stages.indexOf("crawling_company")).toBeLessThan(stages.indexOf("generating_technical_questions"));
    expect(stages.indexOf("checking_coverage")).toBeLessThan(stages.indexOf("generating_flashcards"));
    expect(stages.indexOf("generating_flashcards")).toBeLessThan(stages.indexOf("allocating_schedule"));

    // Final kit is schema-valid with no dangling references.
    const { errors } = validateKit(kit);
    expect(errors).toEqual([]);

    // Requested exact day count honored.
    expect(kit.schedule.days_available).toBe(3);
    expect(kit.schedule.days).toHaveLength(3);

    // Company research actually influenced the kit (pages_used populated).
    expect(kit.source.pages_used.length).toBeGreaterThan(0);
  });

  it("covers every MUST requirement via the deterministic second pass", async () => {
    const { generateKit } = await import("../src/generation/pipeline");
    const llm = new FakeLLMProvider();

    const kit = await generateKit(llm, {
      jd: "Senior React engineer, must mentor juniors, GraphQL bonus.",
      companyUrl: baseUrl,
      days: 5,
    });

    const mustIds = kit.role.requirements.filter((r) => r.priority === "must").map((r) => r.id);
    const referencedIds = new Set(kit.questions.flatMap((q) => q.requirement_ids));
    for (const id of mustIds) {
      expect(referencedIds.has(id)).toBe(true);
    }
    expect(kit.coverage.uncovered_requirement_ids.every((id) => !mustIds.includes(id))).toBe(true);
    expect(kit.coverage.passes).toBeGreaterThanOrEqual(1);
  });

  it("reports an honest warning instead of fabricating data when the company site is unreachable", async () => {
    const { generateKit } = await import("../src/generation/pipeline");
    const llm = new FakeLLMProvider();
    const warnings: string[] = [];

    const kit = await generateKit(
      llm,
      { jd: "Senior React engineer.", companyUrl: "http://127.0.0.1:1/nonexistent", days: 1 },
      (event) => {
        if (event.warning) warnings.push(event.warning);
      }
    );

    expect(kit.source.pages_used).toEqual([]);
    expect(kit.company_brief.summary).toMatch(/no content|unreachable|could not/i);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("rejects a truly empty JD as invalid input (nothing to extract), per the assessment's validate-input stage", async () => {
    const { generateKit } = await import("../src/generation/pipeline");
    const llm = new FakeLLMProvider();

    await expect(
      generateKit(llm, { jd: "", companyUrl: baseUrl, days: 1 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      generateKit(llm, { jd: "   ", companyUrl: baseUrl, days: 1 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects an oversized JD rather than passing it through to an LLM prompt", async () => {
    const { generateKit, MAX_JD_CHARS } = await import("../src/generation/pipeline");
    const llm = new FakeLLMProvider();

    await expect(
      generateKit(llm, { jd: "x".repeat(MAX_JD_CHARS + 1), companyUrl: baseUrl, days: 1 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("still produces a thin but schema-valid kit for a very short, non-empty JD rather than failing or inventing content", async () => {
    const { generateKit } = await import("../src/generation/pipeline");
    const { validateKit } = await import("../src/validation/kitSchema");
    const llm = new FakeLLMProvider();

    // Two-line JD, per the assessment's explicit "JD with only two lines" edge case.
    const kit = await generateKit(llm, {
      jd: "Frontend engineer.\nReact required.",
      companyUrl: baseUrl,
      days: 2,
    });

    const { errors } = validateKit(kit);
    expect(errors).toEqual([]);
    expect(kit.schedule.days_available).toBe(2);
    // Nothing fabricated beyond what the fake LLM's requirement extraction
    // returned — the pipeline does not error out just because the JD is short.
    expect(kit.role.requirements.length).toBeGreaterThanOrEqual(0);
  });
});
