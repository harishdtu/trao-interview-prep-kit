"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";

const STAGE_LABEL: Record<string, string> = {
  validating: "Validating input",
  extracting_requirements: "Extracting requirements",
  crawling_company: "Crawling company site",
  finding_hiring_info: "Finding hiring information",
  researching_interview_process: "Researching interview process",
  generating_technical_questions: "Generating technical questions",
  generating_behavioural_questions: "Generating behavioural questions",
  generating_system_design_questions: "Generating system-design questions",
  generating_company_fit_questions: "Generating company-fit questions",
  checking_coverage: "Checking coverage",
  filling_coverage_gaps: "Filling coverage gaps",
  generating_flashcards: "Generating flashcards",
  allocating_schedule: "Allocating schedule",
  validating_kit: "Validating kit",
  saving_kit: "Saving kit",
  done: "Done",
};

const TABS = ["Overview", "Questions", "Flashcards", "Schedule", "Research"] as const;
type Tab = (typeof TABS)[number];

export default function KitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const kitId = params.id;

  const [record, setRecord] = useState<any>(null);
  const [progress, setProgress] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getKit(kitId);
      setRecord(res.kit);
      return res.kit;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setError(err instanceof ApiError ? err.message : "Could not load kit.");
      return null;
    }
  }, [kitId, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!record || record.status !== "generating") return;
    const interval = setInterval(async () => {
      try {
        const p = await api.getProgress(kitId);
        setProgress(p.events);
        if (p.status !== "generating") {
          clearInterval(interval);
          load();
        }
      } catch {
        clearInterval(interval);
      }
    }, 800);
    return () => clearInterval(interval);
  }, [record, kitId, load]);

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="field-card p-8">
        <p className="text-rose mb-4">{error}</p>
        <Link href="/dashboard" className="text-moss underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!record) return <p className="text-ink/50">Loading…</p>;

  if (record.status === "generating" || record.status === "draft") {
    return (
      <div>
        <Link href="/dashboard" className="text-sm text-moss underline mb-6 inline-block">
          ← Dashboard
        </Link>
        <div className="field-card p-8">
          <h1 className="font-serif text-2xl mb-4">Building your kit…</h1>
          <ul className="space-y-2">
            {progress.length === 0 && <li className="text-ink/50">Starting up…</li>}
            {progress.map((e, i) => (
              <li key={i} className={`text-sm ${e.warning ? "text-amber" : "text-ink/70"}`}>
                {STAGE_LABEL[e.stage] ?? e.stage}
                {e.warning ? ` — ${e.warning}` : ""}
              </li>
            ))}
          </ul>
          {record.status === "draft" && (
            <button
              onClick={() => withBusy("start", async () => { await api.startGeneration(kitId); await load(); })}
              className="mt-6 bg-moss text-white px-4 py-2 rounded-sm"
            >
              Start generation
            </button>
          )}
        </div>
      </div>
    );
  }

  if (record.status === "failed") {
    return (
      <div>
        <Link href="/dashboard" className="text-sm text-moss underline mb-6 inline-block">
          ← Dashboard
        </Link>
        <div className="field-card p-8">
          <h1 className="font-serif text-2xl mb-2 text-rose">Generation failed</h1>
          <p className="text-ink/70 mb-4">{record.generationError?.message}</p>
          <button
            onClick={() => withBusy("retry", async () => { await api.startGeneration(kitId); await load(); })}
            className="bg-moss text-white px-4 py-2 rounded-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const kit = record.kit;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Link href="/dashboard" className="text-sm text-moss underline">
          ← Dashboard
        </Link>
        <Link href={`/kits/${kitId}/practice`} className="text-sm bg-amber text-white px-3 py-1.5 rounded-sm">
          Practice flashcards
        </Link>
      </div>
      <h1 className="font-serif text-3xl mt-3">{kit.role.title}</h1>
      <p className="text-ink/60 mb-6">
        {kit.source.company} · {kit.role.seniority} · {kit.schedule.days_available} day plan
      </p>

      <div className="flex gap-6 border-b border-line mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab-underline pb-2 text-sm ${tab === t ? "active" : "text-ink/50"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab kit={kit} kitId={kitId} busy={busy} withBusy={withBusy} load={load} />}
      {tab === "Questions" && (
        <QuestionsTab kit={kit} kitId={kitId} busy={busy} withBusy={withBusy} load={load} />
      )}
      {tab === "Flashcards" && <FlashcardsTab kit={kit} kitId={kitId} busy={busy} withBusy={withBusy} load={load} />}
      {tab === "Schedule" && <ScheduleTab kit={kit} kitId={kitId} busy={busy} withBusy={withBusy} load={load} />}
      {tab === "Research" && <ResearchTab kit={kit} />}
    </div>
  );
}

function OverviewTab({ kit, kitId, busy, withBusy, load }: any) {
  const uncoveredMust = kit.role.requirements.filter(
    (r: any) => r.priority === "must" && kit.coverage.uncovered_requirement_ids.includes(r.id)
  );
  return (
    <div className="space-y-6">
      <div className="field-card p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-serif text-xl">Company brief</h2>
          <button
            disabled={busy === "brief"}
            onClick={() => withBusy("brief", async () => { await api.regenerateCompanyBrief(kitId); await load(); })}
            className="text-sm text-moss underline disabled:opacity-50"
          >
            {busy === "brief" ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
        <p className="text-ink/80">{kit.company_brief.summary}</p>
        <p className="text-ink/60 text-sm mt-2">{kit.company_brief.what_they_do}</p>
        {kit.company_brief.sources?.length > 0 && (
          <p className="text-xs text-ink/40 mt-3">Sources: {kit.company_brief.sources.join(", ")}</p>
        )}
      </div>

      <div className="field-card p-6">
        <h2 className="font-serif text-xl mb-3">Requirements</h2>
        <div className="space-y-2">
          {kit.role.requirements.map((r: any) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span
                className={`px-2 py-0.5 rounded-sm text-xs ${
                  r.priority === "must" ? "bg-moss/10 text-moss" : "bg-amber/10 text-amber"
                }`}
              >
                {r.priority}
              </span>
              <span className="text-ink/40 text-xs">{r.kind}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="field-card p-6">
        <h2 className="font-serif text-xl mb-2">Coverage</h2>
        {uncoveredMust.length === 0 ? (
          <p className="text-moss text-sm">Every must-have requirement has at least one question. ✓</p>
        ) : (
          <div>
            <p className="text-rose text-sm mb-2">
              {uncoveredMust.length} must-have requirement{uncoveredMust.length === 1 ? "" : "s"} still
              uncovered:
            </p>
            <ul className="text-sm text-ink/70 list-disc list-inside">
              {uncoveredMust.map((r: any) => (
                <li key={r.id}>{r.text}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-ink/40 mt-2">Checked deterministically after {kit.coverage.passes} pass(es).</p>
      </div>
    </div>
  );
}

function QuestionsTab({ kit, kitId, busy, withBusy, load }: any) {
  const categories = ["technical", "behavioural", "system-design", "company-fit"];
  return (
    <div className="space-y-6">
      {categories.map((cat) => {
        const questions = kit.questions.filter((q: any) => q.category === cat);
        return (
          <div key={cat} className="field-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-xl capitalize">{cat.replace("-", " ")}</h2>
              <button
                disabled={busy === `regen-${cat}`}
                onClick={() =>
                  withBusy(`regen-${cat}`, async () => {
                    await api.regenerateQuestions(kitId, cat);
                    await load();
                  })
                }
                className="text-sm text-moss underline disabled:opacity-50"
              >
                {busy === `regen-${cat}` ? "Regenerating…" : "Regenerate category"}
              </button>
            </div>
            {questions.length === 0 && <p className="text-ink/40 text-sm">No questions in this category yet.</p>}
            <div className="space-y-3">
              {questions.map((q: any) => (
                <div key={q.id} className="border-t border-line pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm flex-1">{q.prompt}</p>
                    <div className="flex gap-2 shrink-0 text-xs">
                      {q.pinned && <span className="text-amber">pinned</span>}
                      {q.edited && <span className="text-ink/40">edited</span>}
                      <button
                        onClick={() =>
                          withBusy(`pin-${q.id}`, async () => {
                            await api.patchQuestion(kitId, q.id, { pinned: !q.pinned });
                            await load();
                          })
                        }
                        className="text-moss underline"
                      >
                        {q.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        onClick={() =>
                          withBusy(`del-${q.id}`, async () => {
                            await api.deleteQuestion(kitId, q.id);
                            await load();
                          })
                        }
                        className="text-rose underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-ink/50 mt-1">
                    Difficulty {q.difficulty} · covers {q.requirement_ids.join(", ")}
                  </p>
                  <p className="text-sm text-ink/70 mt-1">{q.answer_outline}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlashcardsTab({ kit, kitId, busy, withBusy, load }: any) {
  return (
    <div className="field-card p-6">
      <div className="grid sm:grid-cols-2 gap-4">
        {kit.flashcards.map((f: any) => (
          <div key={f.id} className="border border-line rounded-sm p-4 bg-white">
            <p className="font-medium text-sm">{f.front}</p>
            <p className="text-ink/60 text-sm mt-2">{f.back}</p>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-ink/40">{f.requirement_ids.join(", ")}</span>
              <button
                onClick={() =>
                  withBusy(`delf-${f.id}`, async () => {
                    await api.deleteFlashcard(kitId, f.id);
                    await load();
                  })
                }
                className="text-rose text-xs underline"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {kit.flashcards.length === 0 && <p className="text-ink/40 text-sm">No flashcards yet.</p>}
    </div>
  );
}

function ScheduleTab({ kit, kitId, busy, withBusy, load }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          disabled={busy === "sched"}
          onClick={() => withBusy("sched", async () => { await api.regenerateSchedule(kitId); await load(); })}
          className="text-sm text-moss underline disabled:opacity-50"
        >
          {busy === "sched" ? "Rebuilding…" : "Rebuild schedule"}
        </button>
      </div>
      {kit.schedule.days.map((day: any) => (
        <div key={day.day} className="field-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg">Day {day.day}</h3>
            <span className="text-sm text-ink/60">{day.minutes} min · {day.focus}</span>
          </div>
          <ul className="mt-2 text-sm text-ink/70 space-y-1">
            {day.question_ids.map((qid: string) => {
              const q = kit.questions.find((x: any) => x.id === qid);
              return <li key={qid}>• {q ? q.prompt : qid}</li>;
            })}
            {day.question_ids.length === 0 && <li className="text-ink/40">Review day — no new material scheduled.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ResearchTab({ kit }: any) {
  return (
    <div className="space-y-4">
      <div className="field-card p-6">
        <h2 className="font-serif text-xl mb-3">Pages used</h2>
        {kit.source.pages_used.length === 0 ? (
          <p className="text-ink/50 text-sm">No pages could be retrieved from the company site.</p>
        ) : (
          <ul className="text-sm text-moss space-y-1">
            {kit.source.pages_used.map((url: string) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer" className="underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
