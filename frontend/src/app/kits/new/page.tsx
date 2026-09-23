"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

export default function NewKitPage() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { kit } = await api.createKit(jd, companyUrl, days);
      await api.startGeneration(kit.id);
      router.push(`/kits/${kit.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-serif text-3xl mb-1">New prep kit</h1>
      <p className="text-ink/60 mb-8">
        Paste the job description and the company&rsquo;s website. We&rsquo;ll research the company,
        pull requirements from the JD, and build your kit from there.
      </p>

      <form onSubmit={handleSubmit} className="field-card p-6 space-y-5">
        <div>
          <label className="block text-sm mb-1 text-ink/70">Job description</label>
          <textarea
            required
            rows={10}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the full job description here…"
            className="w-full border border-line bg-white px-3 py-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber font-mono text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-ink/70">Company website</label>
            <input
              type="url"
              required
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="https://company.com"
              className="w-full border border-line bg-white px-3 py-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber"
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-ink/70">Days until interview</label>
            <input
              type="number"
              required
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
              className="w-full border border-line bg-white px-3 py-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber"
            />
          </div>
        </div>
        {error && <p className="text-rose text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-moss text-white py-2.5 rounded-sm hover:bg-moss/90 disabled:opacity-50"
        >
          {loading ? "Starting…" : "Generate my kit"}
        </button>
      </form>
    </div>
  );
}
