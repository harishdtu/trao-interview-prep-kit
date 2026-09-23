"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";

export default function PracticePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const kitId = params.id;

  const [cards, setCards] = useState<any[] | null>(null);
  const [progress, setProgress] = useState<Record<string, any>>({});
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weakSpots, setWeakSpots] = useState<any>(null);

  useEffect(() => {
    api
      .getPractice(kitId)
      .then((res) => {
        setCards(res.flashcards);
        setProgress(res.progress);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof ApiError ? err.message : "Could not load practice session.");
      });
    api.weakSpots(kitId).then(setWeakSpots).catch(() => {});
  }, [kitId, router]);

  async function rate(confidence: 1 | 2 | 3) {
    if (!cards) return;
    const card = cards[index];
    const res = await api.submitPractice(kitId, card.id, confidence);
    setProgress(res.progress);
    setRevealed(false);
    setIndex((i) => (i + 1 < cards.length ? i + 1 : i));
  }

  if (error) {
    return (
      <div className="field-card p-8">
        <p className="text-rose mb-4">{error}</p>
        <Link href={`/kits/${kitId}`} className="text-moss underline">
          Back to kit
        </Link>
      </div>
    );
  }

  if (!cards) return <p className="text-ink/50">Loading…</p>;

  if (cards.length === 0) {
    return (
      <div className="field-card p-8">
        <p>No flashcards to practice yet.</p>
        <Link href={`/kits/${kitId}`} className="text-moss underline">
          Back to kit
        </Link>
      </div>
    );
  }

  const card = cards[index];
  const cardProgress = progress[card.id];
  const coveredCount = Object.keys(progress).length;

  return (
    <div className="max-w-xl mx-auto">
      <Link href={`/kits/${kitId}`} className="text-sm text-moss underline mb-6 inline-block">
        ← Back to kit
      </Link>

      <div className="flex items-center justify-between mb-4 text-sm text-ink/60">
        <span>
          Card {index + 1} of {cards.length}
        </span>
        <span>
          {coveredCount} of {cards.length} practiced at least once
        </span>
      </div>

      <div className="field-card p-8 min-h-[220px] flex flex-col justify-between">
        <div>
          <p className="text-xs text-ink/40 mb-3">
            {cardProgress ? `Last confidence: ${cardProgress.confidence}/3 · reviewed ${cardProgress.timesReviewed}×` : "Not yet practiced"}
          </p>
          <p className="font-serif text-xl">{card.front}</p>
          {revealed && <p className="text-ink/70 mt-4 border-t border-line pt-4">{card.back}</p>}
        </div>

        {!revealed ? (
          <button onClick={() => setRevealed(true)} className="mt-6 bg-moss text-white py-2 rounded-sm">
            Reveal answer
          </button>
        ) : (
          <div className="mt-6">
            <p className="text-sm text-ink/60 mb-2">How confident were you?</p>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => rate(1)} className="bg-rose/10 text-rose py-2 rounded-sm">
                Weak
              </button>
              <button onClick={() => rate(2)} className="bg-amber/10 text-amber py-2 rounded-sm">
                Okay
              </button>
              <button onClick={() => rate(3)} className="bg-moss/10 text-moss py-2 rounded-sm">
                Strong
              </button>
            </div>
          </div>
        )}
      </div>

      {weakSpots && (weakSpots.low_confidence_flashcards.length > 0 || weakSpots.never_practiced_flashcards.length > 0) && (
        <div className="field-card p-6 mt-6">
          <h2 className="font-serif text-lg mb-2">Weak spots</h2>
          {weakSpots.weak_requirements.length > 0 && (
            <div className="mb-3">
              <p className="text-sm text-ink/60 mb-1">Requirements needing more attention:</p>
              <ul className="text-sm text-rose list-disc list-inside">
                {weakSpots.weak_requirements.map((r: any) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ul>
            </div>
          )}
          {weakSpots.never_practiced_flashcards.length > 0 && (
            <p className="text-sm text-ink/60">
              {weakSpots.never_practiced_flashcards.length} card(s) not practiced yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
