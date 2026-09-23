"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  draft: "Not started",
  generating: "Generating…",
  ready: "Ready",
  failed: "Generation failed",
};

export default function DashboardPage() {
  const router = useRouter();
  const [kits, setKits] = useState<any[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then((res) => setEmail(res.user.email))
      .catch(() => router.replace("/login"));
    api
      .listKits()
      .then((res) => setKits(res.kits))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load kits."));
  }, [router]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this kit? This cannot be undone.")) return;
    await api.deleteKit(id);
    setKits((prev) => (prev ? prev.filter((k) => k.id !== id) : prev));
  }

  async function handleLogout() {
    await api.logout();
    router.replace("/login");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl">Your prep kits</h1>
          {email && <p className="text-ink/60 text-sm mt-1">Signed in as {email}</p>}
        </div>
        <div className="flex gap-3">
          <Link href="/kits/new" className="bg-moss text-white px-4 py-2 rounded-sm hover:bg-moss/90">
            New kit
          </Link>
          <button onClick={handleLogout} className="border border-line px-4 py-2 rounded-sm hover:bg-white">
            Sign out
          </button>
        </div>
      </div>

      {error && <p className="text-rose">{error}</p>}

      {kits === null && !error && <p className="text-ink/50">Loading…</p>}

      {kits?.length === 0 && (
        <div className="field-card p-10 text-center">
          <p className="font-serif text-xl mb-2">No kits yet</p>
          <p className="text-ink/60 mb-4">Paste a job description and a company site to build your first one.</p>
          <Link href="/kits/new" className="text-moss underline">
            Create your first kit
          </Link>
        </div>
      )}

      <div className="grid gap-3">
        {kits?.map((k) => (
          <div key={k.id} className="field-card p-5 flex items-center justify-between">
            <Link href={`/kits/${k.id}`} className="flex-1">
              <p className="font-serif text-lg">
                {k.kit?.role?.title || "Untitled role"}
                {k.kit?.source?.company ? ` — ${k.kit.source.company}` : ""}
              </p>
              <p className="text-sm text-ink/60 mt-1">
                {STATUS_LABEL[k.status] ?? k.status} · {k.input.days} day{k.input.days === 1 ? "" : "s"} ·{" "}
                {new Date(k.createdAt).toLocaleDateString()}
              </p>
            </Link>
            <button
              onClick={() => handleDelete(k.id)}
              className="text-rose text-sm ml-4 hover:underline"
              aria-label="Delete kit"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
