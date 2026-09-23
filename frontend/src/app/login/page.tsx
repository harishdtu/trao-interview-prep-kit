"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="font-serif text-3xl mb-1">Welcome back</h1>
      <p className="text-ink/60 mb-8">Sign in to pick up where you left off.</p>

      <form onSubmit={handleSubmit} className="field-card p-6 space-y-4">
        <div>
          <label className="block text-sm mb-1 text-ink/70">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-line bg-white px-3 py-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-ink/70">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-line bg-white px-3 py-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber"
          />
        </div>
        {error && <p className="text-rose text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-moss text-white py-2 rounded-sm hover:bg-moss/90 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-ink/60">
        New here?{" "}
        <Link href="/register" className="text-moss underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
