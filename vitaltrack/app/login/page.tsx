"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { isMock } from "@/lib/env";
import Link from "next/link";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not send link");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-8">
        <h1 className="text-2xl font-bold text-vital-700">VitalTrack</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          Sign in with a magic link
        </p>
        {searchParams?.error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
            Sign-in failed: {searchParams.error}. Request a fresh link below
            (links must be opened in the same browser).
          </p>
        )}
        {isMock ? (
          <div className="text-sm text-slate-600">
            <p className="mb-4">
              Demo mode is on (no Supabase configured) — no sign-in needed.
            </p>
            <Link
              href="/dashboard"
              className="block text-center bg-vital-600 hover:bg-vital-700 text-white rounded-lg py-2 font-medium"
            >
              Open the demo dashboard
            </Link>
          </div>
        ) : status === "sent" ? (
          <p className="text-sm text-slate-600">
            Check your email — the sign-in link is on its way.
          </p>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital-500"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full bg-vital-600 hover:bg-vital-700 disabled:opacity-50 text-white rounded-lg py-2 font-medium"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-600">{message}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
