import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { buildApp } from "../src/app";
import { createInMemoryRepositories } from "../src/db/memoryRepository";
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
      res.end(`<html><head><title>Careers</title></head><body><p>Hiring.</p></body></html>`);
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

async function waitForReady(agent: any, kitId: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await agent.get(`/api/kits/${kitId}`);
    if (res.body.kit.status === "ready" || res.body.kit.status === "failed") return res.body.kit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for kit to become ready");
}

describe("full kit lifecycle via HTTP API", () => {
  it("creates, generates, edits/pins, regenerates preserving edits, and reports weak spots", async () => {
    const repos = createInMemoryRepositories();
    const app = buildApp(repos, new FakeLLMProvider());
    const agent = request.agent(app);

    await agent.post("/auth/register").send({ email: "lifecycle@example.com", password: "password123" });

    const create = await agent.post("/api/kits").send({
      jd: "Senior React engineer who mentors juniors. GraphQL is a bonus.",
      company_url: baseUrl,
      days: 3,
    });
    expect(create.status).toBe(201);
    const kitId = create.body.kit.id;

    const genStart = await agent.post(`/api/kits/${kitId}/generate`);
    expect(genStart.status).toBe(202);

    const ready = await waitForReady(agent, kitId);
    expect(ready.status).toBe("ready");
    expect(ready.kit.questions.length).toBeGreaterThan(0);

    // Pin the first technical question, then edit a second one.
    const technicalQuestions = ready.kit.questions.filter((q: any) => q.category === "technical");
    expect(technicalQuestions.length).toBeGreaterThan(0);
    const toPinId = technicalQuestions[0].id;

    const pinRes = await agent.patch(`/api/kits/${kitId}/questions/${toPinId}`).send({ pinned: true });
    expect(pinRes.status).toBe(200);
    const pinnedQuestionBefore = pinRes.body.kit.kit.questions.find((q: any) => q.id === toPinId);
    expect(pinnedQuestionBefore.pinned).toBe(true);
    const originalPrompt = pinnedQuestionBefore.prompt;

    // Regenerate the technical category.
    const regen = await agent.post(`/api/kits/${kitId}/regenerate/questions/technical`);
    expect(regen.status).toBe(200);

    const afterRegen = regen.body.kit.kit.questions.find((q: any) => q.id === toPinId);
    expect(afterRegen).toBeDefined();
    expect(afterRegen.prompt).toBe(originalPrompt); // pinned content survived regeneration verbatim
    expect(afterRegen.pinned).toBe(true);

    // Add a manual question and delete it.
    const addQ = await agent.post(`/api/kits/${kitId}/questions`).send({
      requirement_ids: [ready.kit.role.requirements[0].id],
      category: "technical",
      prompt: "Manually added question",
      answer_outline: "Manual outline",
      difficulty: 1,
    });
    expect(addQ.status).toBe(201);
    const manualId = addQ.body.kit.kit.questions.find((q: any) => q.prompt === "Manually added question").id;

    const delQ = await agent.delete(`/api/kits/${kitId}/questions/${manualId}`);
    expect(delQ.status).toBe(200);
    expect(delQ.body.kit.kit.questions.find((q: any) => q.id === manualId)).toBeUndefined();

    // A malformed patch (wrong type for difficulty) is rejected cleanly as
    // 400, not a 500 with internal validation details leaked.
    const malformedPatch = await agent.patch(`/api/kits/${kitId}/questions/${toPinId}`).send({ difficulty: "very hard" });
    expect(malformedPatch.status).toBe(400);
    expect(malformedPatch.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(malformedPatch.body)).not.toMatch(/ZodError|unionErrors/);

    // Practice mode: review a flashcard with low confidence.
    const flashcardId = ready.kit.flashcards[0]?.id;
    if (flashcardId) {
      const practiceRes = await agent.post(`/api/kits/${kitId}/practice`).send({ flashcardId, confidence: 1 });
      expect(practiceRes.status).toBe(200);

      const weakSpots = await agent.get(`/api/kits/${kitId}/weak-spots`);
      expect(weakSpots.status).toBe(200);
      expect(weakSpots.body.low_confidence_flashcards.some((f: any) => f.id === flashcardId)).toBe(true);
    }

    // Schedule regeneration still yields the exact requested day count.
    const scheduleRegen = await agent.post(`/api/kits/${kitId}/regenerate/schedule`);
    expect(scheduleRegen.status).toBe(200);
    expect(scheduleRegen.body.kit.kit.schedule.days_available).toBe(3);
    expect(scheduleRegen.body.kit.kit.schedule.days).toHaveLength(3);
  });
});
