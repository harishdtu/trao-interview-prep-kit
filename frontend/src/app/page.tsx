"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    api
      .me()
      .then(() => router.replace("/dashboard"))
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <p className="font-serif text-lg text-ink/70">Loading your notebook…</p>
    </div>
  );
}
