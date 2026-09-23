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
      res.end(`<html><head><title>Acme</title></head><body><nav><a href="/careers">Careers</a></nav><p>Acme.</p></body></html>`);
    } else if (req.url === "/careers") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><head><title>Careers</title></head><body><p>Hiring engineers.</p></body></html>`);
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

describe("runBatchEvaluation", () => {
  it("produces the Appendix-B wrapper, continues after a failing case, and honors per-case days", async () => {
    const { runBatchEvaluation } = await import("../src/batch/evaluate");
    const llm = new FakeLLMProvider();

    const cases = [
      { id: "case-01", jd: "Senior React engineer, must mentor juniors.", company_url: baseUrl, days: 5 },
      { id: "case-02", jd: "", company_url: baseUrl, days: 3 }, // invalid JD -> should fail, not crash the batch
      { id: "case-03", jd: "Backend engineer with Node.js experience.", company_url: baseUrl, days: 1 },
    ];

    const output = await runBatchEvaluation(llm, cases, 2);

    expect(output.version).toBe("1.0");
    expect(typeof output.generated_at).toBe("string");
    expect(output.kits).toHaveLength(3);

    const byId = Object.fromEntries(output.kits.map((k) => [k.id, k]));

    expect(byId["case-01"].status).toBe("ok");
    expect(byId["case-01"].error).toBeNull();
    expect((byId["case-01"].kit as any).schedule.days_available).toBe(5);

    expect(byId["case-02"].status).toBe("failed");
    expect(byId["case-02"].kit).toBeNull();
    expect(byId["case-02"].error?.code).toBeTruthy();

    expect(byId["case-03"].status).toBe("ok");
    expect((byId["case-03"].kit as any).schedule.days_available).toBe(1);
  });

  it("supports localhost company URLs when ALLOW_PRIVATE_FETCHES is enabled", async () => {
    const { runBatchEvaluation } = await import("../src/batch/evaluate");
    const llm = new FakeLLMProvider();
    const output = await runBatchEvaluation(
      llm,
      [{ id: "local-case", jd: "React engineer with mentoring duties.", company_url: baseUrl, days: 2 }],
      1
    );
    expect(output.kits[0].status).toBe("ok");
    expect((output.kits[0].kit as any).source.pages_used.length).toBeGreaterThan(0);
  });
});
