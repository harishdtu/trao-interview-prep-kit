# AI Interview Prep Kit — Trao Full-Stack Assessment

A web app that turns a job description + a company website + a days-until-interview
number into a structured, editable interview prep kit: extracted requirements,
category-organized questions with deterministic coverage guarantees, flashcards,
and a deterministically-allocated day-by-day study schedule.

## 1. Overview

A user pastes a job description, gives a company URL and a number of days until
their interview, and the system:

1. Extracts structured requirements from the JD (via Gemini).
2. Crawls the company site (dynamic link discovery/ranking, not hardcoded paths).
3. Looks for hiring/interview-process pages and public interview discussion.
4. Generates interview questions per category, each tied to real requirement IDs.
5. Deterministically checks requirement coverage (plain code, no LLM) and fills
   gaps with a bounded second pass.
6. Generates flashcards.
7. Deterministically allocates the questions across exactly the requested number
   of days.
8. Persists the kit, editable and re-generatable section-by-section, with pinned
   and user-edited content always preserved.
9. Offers flashcard practice mode with confidence tracking and weakest-first
   ordering, plus a "Weak Spots" report.
10. Runs the identical pipeline from a `npm run evaluate` batch CLI for automated
    grading.

## 2. Features

- Email/password auth with hashed passwords, HTTP-only session cookies, and
  strict per-user data isolation.
- Company research: bounded, ranked, dynamic crawl with SSRF protection and
  honest handling of unreachable pages / missing hiring info / missing public
  interview discussion (never fabricated).
- Sequential (not single-prompt) Gemini pipeline with per-stage progress,
  retries/backoff, and Zod-validated structured output.
- Deterministic coverage checking and deterministic day-schedule allocation —
  both pure application code, unit- and integration-tested.
- Full kit editing: add/edit/delete/pin questions and flashcards, per-category
  regeneration that never discards pinned/edited/user-created content.
- Practice mode with confidence-weighted, weakest-first ordering.
- Weak Spots report (low-confidence cards, never-practiced cards, uncovered
  requirements) computed deterministically from stored data.
- Batch evaluator CLI producing the exact required output contract.

## 3. Tech stack

- **Frontend:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS.
- **Backend:** Node.js, Express, TypeScript.
- **Database:** MongoDB via Mongoose, behind a repository interface (works with
  Atlas or local Mongo; falls back to in-memory storage if unreachable).
- **LLM:** Google Gemini (`@google/generative-ai`), free-tier-compatible model,
  configurable via `GEMINI_MODEL`.
- **Testing:** Vitest + Supertest.

## 4. Architecture

```
backend/src/
  auth/          hashing, session middleware, register/login/logout/me routes
  db/            repository interfaces + in-memory and Mongoose implementations
  llm/           LLMProvider interface, GeminiProvider, DryRunProvider (local smoke-test only)
  retrieval/     SSRF-safe URL checking
  research/      crawler, link ranker, interview-discussion research, orchestration
  generation/    requirement extraction, company brief, questions, flashcards, pipeline
  coverage/      deterministic coverage checker
  scheduling/    deterministic schedule allocator
  validation/    Appendix-A kit Zod schema + referential-integrity checks
  kits/          kit service (business logic), routes, editable-entity merge logic
  batch/         evaluate.ts — the CLI entry point
  middleware/    auth guard, error handler
  app.ts         Express app factory (used by both the server and tests)
  index.ts       server bootstrap

frontend/src/
  app/           Next.js App Router pages (login, register, dashboard, kits/new,
                 kits/[id], kits/[id]/practice)
  lib/api.ts     typed fetch client against the backend
```

LLM calls are isolated behind `LLMProvider` (`generateText` / `generateStructured`),
so `GeminiProvider` is the only file that talks to Gemini; everything else is
provider-agnostic and unit-testable with a fake provider.

## 5. Setup

```bash
# Backend
cd backend
cp .env.example .env      # fill in GEMINI_API_KEY at minimum
npm install
npm run dev                # http://localhost:4000

# Frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev                # http://localhost:3000
```

## 6. Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | backend | yes (for real generation) | never sent to the browser |
| `GEMINI_MODEL` | backend | yes | defaults to `gemini-1.5-flash` |
| `MONGODB_URI` | backend | no | Atlas or local; falls back to in-memory if unreachable |
| `SESSION_SECRET` | backend | yes in production | signs the session cookie |
| `PORT` | backend | no | default `4000` |
| `FRONTEND_ORIGIN` | backend | no | CORS allow-origin, default `http://localhost:3000` |
| `ALLOW_PRIVATE_FETCHES` | backend | no | `true` only for local/batch use with localhost company URLs |
| `MAX_PAGES` | backend | no | crawl bound, default `8` |
| `MAX_COVERAGE_PASSES` | backend | no | default `2` |
| `SEARCH_API_URL` / `SEARCH_API_KEY` | backend | no | optional public-interview-discussion search backend (see §10) |
| `NEXT_PUBLIC_API_URL` | frontend | yes | backend base URL |

## 7. MongoDB setup

Either:
- **Atlas:** create a free cluster, get the `mongodb+srv://...` connection
  string, set it as `MONGODB_URI`.
- **Local:** run `mongod` locally and use `mongodb://127.0.0.1:27017/trao`.

If `MONGODB_URI` is unset or unreachable at startup, the server logs a warning
and falls back to an in-memory repository implementation so the app is still
fully usable for development/testing — the persistence layer is a swappable
interface (`src/db/repository.ts`) with two implementations
(`memoryRepository.ts`, `mongoRepository.ts`), selected automatically in
`src/db/index.ts`. Nothing in the app blocks on a live database.

## 8. Gemini setup

Get an API key from Google AI Studio, set `GEMINI_API_KEY`. Pick a free-tier
model for `GEMINI_MODEL` (default `gemini-1.5-flash`). The key is only ever
read server-side (`src/llm/GeminiProvider.ts`) and never returned to the
client.

## 9. Why Gemini / which model

Required by the assessment brief (to stay on a genuine free tier). The model
is fully configurable via `GEMINI_MODEL` rather than hardcoded, so it can be
swapped for a higher-tier model without code changes.

## 10. Retrieval / crawling strategy

`src/research/crawler.ts`: fetches the homepage, discovers on-site links via
Cheerio, ranks them by signal terms (careers/jobs/hiring/interview/engineering/
culture/handbook/company/about/team — see `linkRanker.ts`) rather than assuming
a fixed path, then fetches the top-ranked pages up to `MAX_PAGES`. Every fetch
enforces: SSRF-safe URL validation (`retrieval/urlSafety.ts`, rejects private/
loopback addresses unless `ALLOW_PRIVATE_FETCHES=true`), a request timeout, a
response-size cap, an allowed-content-type check, and post-redirect
re-validation. A single failed page is recorded and does not abort the crawl.

Public interview-discussion search (`research/interviewDiscussion.ts`) is
pluggable via `SEARCH_API_URL`/`SEARCH_API_KEY`. No such credential is implied
by the assessment's own environment-variable list, so without one configured
this stage explicitly reports "unavailable" with a reason, rather than
fabricating discussion content — consistent with the assessment's "honest
incomplete data > fabricated data" principle.

All retrieved content is explicitly labeled untrusted evidence in every LLM
prompt it's used in (`UNTRUSTED_CONTENT_PREFIX` in `llm/LLMProvider.ts`), so a
malicious or manipulated webpage cannot inject instructions into generation.

## 11. Sequential generation pipeline

`src/generation/pipeline.ts` runs stages strictly in order (each stage's
output feeds the next — see the file for the exact sequence and progress
stage names): validate → extract requirements → crawl company → identify
hiring pages → research public interview discussion → generate questions
per category (technical, behavioural, system-design, company-fit) → check
coverage → fill gaps (bounded) → re-check coverage → generate flashcards →
allocate schedule → validate → persist. This is not a single giant prompt;
each stage is its own Gemini call (or, for coverage/scheduling, plain code)
via the `LLMProvider` interface, and progress events are emitted at each step.

## 12. Deterministic coverage

**Edge case: empty vs. short JD.** A completely empty/whitespace-only JD is
rejected as `INVALID_INPUT` at the pipeline's validate-input stage — there is
zero evidence to extract anything from, so this is a genuine failure rather
than a thin kit. A very short but *non-empty* JD (e.g. the assessment's own
"JD with only two lines" edge case) is **not** rejected — it proceeds through
the full pipeline and produces a thin-but-valid kit with however few
requirements the JD actually supports, per the assessment's "don't invent
requirements" principle. Both halves of this distinction are covered by
regression tests in `tests/pipeline.test.ts`. This is also why the batch
evaluator's fixture cases (`fixtures/cases.json`) show 4 `"ok"` / 1 `"failed"`
— the one failure is a deliberately empty JD, included specifically to prove
the batch evaluator continues past a failing case rather than aborting.

`src/coverage/coverage.ts` — pure function, no LLM call. For every
requirement, checks whether any generated question references its ID.
Unit-tested (`tests/coverage.test.ts`) and integration-tested through the full
pipeline (`tests/pipeline.test.ts`, which proves the second pass actually
covers every "must" requirement using a fake LLM provider).

## 13. Deterministic scheduling

`src/scheduling/schedule.ts` — pure function, no LLM call. Scores each
question by requirement priority + difficulty + category weight, sorts
descending, round-robins across exactly the requested number of days. Tested
for 1, 3, 4, 5, and 60-day cases, integer-only minutes, no orphan question
IDs, and must/harder material landing on earlier days (`tests/schedule.test.ts`).

## 14. Regeneration / edit preservation

`src/kits/editableEntity.ts` implements the merge: every question/flashcard
carries `{origin, edited, pinned}`. Regenerating a category only replaces
items that are still `origin: "generated"`, not `edited`, and not `pinned`;
everything else (pinned, user-edited, or user-added) survives untouched, and
freshly-generated content never overwrites a preserved ID. Proven with
dedicated unit tests (`tests/mergeGenerated.test.ts`) and a full HTTP-level
integration test that pins a question, regenerates its category, and asserts
the pinned question's content is byte-identical afterward
(`tests/fullLifecycle.test.ts`).

## 15. Authentication / session model

`bcryptjs` password hashing (12 rounds), `express-session` with HTTP-only,
`sameSite: lax` cookies (`secure: true` in production), Mongo-backed session
store in production when Mongo is connected (else the in-memory store, fine
for dev/tests). `requireAuth` middleware guards every `/api/kits/*` route.
Ownership is checked on every kit route; a kit belonging to another user
returns `404` (never `403`, so existence is never leaked). No password reset
or email verification, per the assessment's explicit scope.

## 16. Practice mode

`GET/POST /api/kits/:id/practice`. Cards are served one at a time, ordered by
ascending confidence (never-practiced cards sort first, i.e. treated as
weakest). Each review updates `{confidence, timesReviewed, lastReviewedAt}`
per card, persisted per kit/user.

## 17. Creative feature: Weak Spots Report

`GET /api/kits/:id/weak-spots` — computed entirely from stored data (no LLM):
low-confidence flashcards, never-practiced flashcards, requirements whose
cards are weak/unpracticed, and any still-uncovered requirements from the
kit's own coverage record.

## 18. Batch evaluator

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Reads a JSON array of `{id, jd, company_url, days}`, runs the **exact same**
`generateKit` pipeline the web app uses (no separate/mock pipeline), honors
each case's `days`, continues after individual failures, and writes:

```json
{
  "version": "1.0",
  "generated_at": "...",
  "kits": [
    { "id": "case-01", "status": "ok", "kit": { ... }, "error": null },
    { "id": "case-04", "status": "failed", "kit": null, "error": { "code": "...", "message": "..." } }
  ]
}
```

Bounded concurrency (`--concurrency`, default 2). Supports `localhost`
company URLs when `ALLOW_PRIVATE_FETCHES=true` (needed for the evaluation
harness). See §22 for a real run against fixture cases.

## 19. Test commands

```bash
cd backend
npm test              # vitest run — 54 tests
npm run typecheck      # tsc --noEmit -p tsconfig.json
npm run build           # production build

cd frontend
npm run build          # production build (typechecks + lints via next build)
```

## 19a. Verification status

| Component | Status |
|---|---|
| Backend logic (pipeline, coverage, scheduling, merge, crawler, batch CLI) | **Verified — 54/54 tests passing across 10 test files** |
| Gemini integration | **Verified against live Gemini** using `gemini-3.5-flash-lite`. Real end-to-end kit generation was completed successfully, including company research, requirements extraction, questions, flashcards, and schedule generation. |
| MongoDB integration | **Verified against MongoDB Atlas**. The backend successfully connected to the live Atlas database and the application was exercised through the authenticated browser flow. |
| Backend build/typecheck | **Verified — `npm run build` passes cleanly** |
| Frontend build | **Verified — `next build` passes cleanly and generates all application routes** |
| Frontend in a browser | **Verified manually** — registration/login, kit creation, generation, questions, pinning, regeneration, flashcards, schedule, practice mode, confidence tracking, and deletion were exercised. |
| Batch evaluator | **Verified against live Gemini** using the provided fixture set. With `--concurrency 1`, 4 valid cases completed successfully. The remaining case intentionally contains an empty JD and correctly returns `INVALID_INPUT` with `Job description is required.` |
| Security/error handling | **Verified** through the automated backend test suite, including SSRF protections, malformed request handling, JD validation, and bounded input handling. |

### Batch evaluator verification

The evaluator was run with:

```bash
npm run evaluate -- --input fixtures/cases.json --output kits-live-4.json --concurrency 1

Result:

case-01 — passed
case-02 — passed
case-03 — rejected as INVALID_INPUT because the JD is intentionally empty
case-04 — passed
case-05 — passed

The empty-JD behavior is intentional: empty or whitespace-only job descriptions are rejected, while short but non-empty descriptions are allowed to produce a thin but valid kit.

The Gemini free-tier rate limit can require sequential evaluator execution (--concurrency 1) for the five-case fixture. This does not change the evaluator pipeline or output contract.

20. Deployment instructions

Backend: any Node host (Render/Railway/Fly/EC2/etc). Set all backend environment variables from §6, then run:

npm run build
npm start

Set MONGODB_URI to a MongoDB Atlas cluster for persistent storage.

Frontend: Vercel or any compatible Next.js host. Set:

NEXT_PUBLIC_API_URL=<deployed-backend-url>

Then run:

npm run build
npm start
CORS: set the backend's FRONTEND_ORIGIN to the deployed frontend URL.
Cookies: with NODE_ENV=production, session cookies are marked secure, so the backend must be served over HTTPS.

Deployment status: The application has been fully verified locally with live Gemini and MongoDB Atlas integrations, but it has not yet been deployed to a public hosting provider.

Remaining deployment steps are hosting-specific: deploy the backend and frontend, configure the production environment variables, configure the production frontend origin, and verify the deployed URLs.

21. Tradeoffs
Generation progress uses polling (GET /:id/progress) rather than SSE, for reliability and simplicity. The event log is in-memory per-process, which is suitable for a single backend instance but would need a shared store such as Redis or MongoDB for a multi-instance deployment.
Public interview-discussion search is pluggable but has no default provider wired in because no search-provider credentials were specified in the assessment environment-variable list. The system degrades honestly rather than fabricating research results.
The in-memory repository fallback trades persistence for zero-setup development. The application logs which repository implementation is active rather than silently falling back.
The evaluator can run with controlled concurrency. Sequential execution (--concurrency 1) is useful when working within Gemini free-tier request limits.
22. Known limitations
No automated frontend test suite (React Testing Library / Playwright) is currently included. Backend correctness, deterministic generation logic, coverage, scheduling, regeneration/merge behavior, crawler behavior, and security validation are covered by the automated backend suite.
The generation progress event log is process-local. A multi-instance production deployment would require a shared progress/event store.
Public interview-discussion search has no default external search provider configured. When unavailable, the pipeline does not fabricate sources or claims.
The current deployment has not been made publicly accessible. The application has instead been verified locally with live Gemini and MongoDB Atlas integrations.
Gemini free-tier request limits may require lower evaluator concurrency. The five-case fixture was successfully exercised with --concurrency 1.

## 23. Security considerations

- Passwords hashed with bcrypt (12 rounds), never returned in any API
  response.
- Sessions: HTTP-only, `sameSite: lax`, `secure` in production, 7-day
  expiration, `logout` calls `session.destroy()` and clears the cookie.
- SSRF: `retrieval/urlSafety.ts` blocks loopback/private/link-local addresses
  for both **IPv4** (`10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`,
  `172.16.0.0/12`, `192.168.0.0/16`, plus decimal/hex/octal-encoded forms,
  which Node's own `URL` parser normalizes back to dotted-quad) and **IPv6**
  (`::1`, `fe80::/10` link-local, `fc00::/7` unique-local, and IPv4-mapped
  IPv6 addresses like `::ffff:127.0.0.1`, in both the dotted-quad and the
  hex-group form Node normalizes it to). Only the explicit
  `ALLOW_PRIVATE_FETCHES=true` (intended for local/batch use) permits them,
  and redirects are re-validated post-fetch against the same check. All of
  the above is covered by regression tests (`tests/urlSafety.test.ts`) that
  probe each bypass technique directly, added during a security audit pass
  that found the IPv6 gap (the initial implementation only exact-matched the
  bracketed `[::1]` hostname form, which never matches the literal `::1` in
  its private-hostname set — every IPv6 address was silently allowed through
  until this was fixed).
- Response-size and content-type limits on every crawled page; request
  timeouts.
- Job description length is capped (`MAX_JD_CHARS`, 20,000 characters) at
  both the HTTP layer and the pipeline's own entry point (so the batch CLI
  path can't bypass it either) as a cost/DoS guard against an oversized
  prompt.
- All crawled content is explicitly framed as untrusted evidence in every
  LLM prompt, never as instructions (prompt-injection defense).
- Ownership checks on every kit route; cross-user access returns `404`, not
  `403`, to avoid leaking existence. Mongo `findById`-style calls are
  wrapped so a malformed ID string returns a clean 404 rather than crashing
  on a cast error.
- Structured error handling: a `ZodError` from an internal validation step
  (e.g. a malformed `PATCH` body producing an invalid kit) is caught and
  returned as a clean `400 VALIDATION_ERROR` rather than a `500` that leaked
  the full internal schema/union error tree to the client — also found and
  fixed during this audit pass, with a regression test in
  `tests/fullLifecycle.test.ts` asserting the response never contains
  `ZodError`/`unionErrors`. Every other `5xx` response now returns a generic
  message instead of the raw internal error string.
- No secrets committed; `.env.example` files document required variables,
  `.gitignore` excludes `.env*`.

---

## Demo script (3–4 minutes)

1. **Register/login** — show the session cookie persists across a refresh.
2. **New kit** — paste a real JD with a mix of "required" and "bonus" lines,
   plus a real company URL; submit.
3. **Generation progress** — point out the staged progress list (crawling →
   questions per category → coverage check → flashcards → schedule), and any
   honest warnings (e.g. "no dedicated hiring page found").
4. **Overview tab** — company brief with cited source pages, requirements
   list with must/nice badges, and the coverage panel showing 0 uncovered
   must-haves.
5. **Questions tab** — pin one question, then hit "Regenerate category" on
   that same category; show the pinned question's text is unchanged while
   the rest regenerate.
6. **Schedule tab** — show the exact requested day count and integer minute
   totals.
7. **Practice mode** — reveal a card, rate it "Weak"; go back and show the
   Weak Spots report now lists it.
8. **Batch evaluator** — run
   `npm run evaluate -- --input fixtures/cases.json --output out.json`
   in a terminal, then open the output file to show the Appendix-B wrapper
   and a mix of `"status": "ok"` / `"status": "failed"` entries.
