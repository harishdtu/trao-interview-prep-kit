import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { createInMemoryRepositories } from "../src/db/memoryRepository";
import { FakeLLMProvider } from "./fixtures/FakeLLMProvider";

function makeApp() {
  const repos = createInMemoryRepositories();
  const app = buildApp(repos, new FakeLLMProvider());
  return { app, repos };
}

describe("auth", () => {
  it("registers a new user and starts a session", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/auth/register").send({ email: "a@example.com", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("a@example.com");
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("rejects duplicate registration with the same email", async () => {
    const { app } = makeApp();
    await request(app).post("/auth/register").send({ email: "dup@example.com", password: "password123" });
    const res = await request(app).post("/auth/register").send({ email: "dup@example.com", password: "password123" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects registration with a weak password", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/auth/register").send({ email: "weak@example.com", password: "123" });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and rejects incorrect ones", async () => {
    const { app } = makeApp();
    await request(app).post("/auth/register").send({ email: "b@example.com", password: "correcthorse" });

    const good = await request(app).post("/auth/login").send({ email: "b@example.com", password: "correcthorse" });
    expect(good.status).toBe(200);

    const bad = await request(app).post("/auth/login").send({ email: "b@example.com", password: "wrongpassword" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 for unauthenticated /auth/me and /api/kits", async () => {
    const { app } = makeApp();
    const me = await request(app).get("/auth/me");
    expect(me.status).toBe(401);

    const kits = await request(app).get("/api/kits");
    expect(kits.status).toBe(401);
  });

  it("returns the current user for an authenticated session, and clears it on logout", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "c@example.com", password: "password123" });

    const me = await agent.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("c@example.com");

    const logout = await agent.post("/auth/logout");
    expect(logout.status).toBe(204);

    const meAfter = await agent.get("/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("never exposes password hashes in any auth response", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const reg = await agent.post("/auth/register").send({ email: "d@example.com", password: "password123" });
    expect(JSON.stringify(reg.body)).not.toMatch(/passwordHash/);
    const me = await agent.get("/auth/me");
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);
  });
});

describe("user isolation", () => {
  it("prevents one user from reading another user's kit by ID", async () => {
    const { app } = makeApp();

    const owner = request.agent(app);
    await owner.post("/auth/register").send({ email: "owner@example.com", password: "password123" });
    const createRes = await owner
      .post("/api/kits")
      .send({ jd: "Some JD text here for a role.", company_url: "https://example.com", days: 3 });
    expect(createRes.status).toBe(201);
    const kitId = createRes.body.kit.id;

    const intruder = request.agent(app);
    await intruder.post("/auth/register").send({ email: "intruder@example.com", password: "password123" });

    const readAttempt = await intruder.get(`/api/kits/${kitId}`);
    expect(readAttempt.status).toBe(404); // never leak existence via 403

    const deleteAttempt = await intruder.delete(`/api/kits/${kitId}`);
    expect(deleteAttempt.status).toBe(404);

    // Owner can still access their own kit.
    const ownerRead = await owner.get(`/api/kits/${kitId}`);
    expect(ownerRead.status).toBe(200);
  });

  it("only lists the requesting user's own kits", async () => {
    const { app } = makeApp();

    const userA = request.agent(app);
    await userA.post("/auth/register").send({ email: "usera@example.com", password: "password123" });
    await userA.post("/api/kits").send({ jd: "JD for role A", company_url: "https://a.example.com", days: 2 });

    const userB = request.agent(app);
    await userB.post("/auth/register").send({ email: "userb@example.com", password: "password123" });
    await userB.post("/api/kits").send({ jd: "JD for role B", company_url: "https://b.example.com", days: 2 });

    const listA = await userA.get("/api/kits");
    expect(listA.body.kits).toHaveLength(1);
    expect(listA.body.kits[0].input.jd).toBe("JD for role A");

    const listB = await userB.get("/api/kits");
    expect(listB.body.kits).toHaveLength(1);
    expect(listB.body.kits[0].input.jd).toBe("JD for role B");
  });
});
