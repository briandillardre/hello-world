"use client";

import { useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";

const STARTERS = [
  "What stands out in my data right now?",
  "What bloodwork should I ask my doctor about?",
  "Why has my sleep been worse lately?",
  "Draft questions for my next doctor visit",
];

export function AdvisorChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/advisor/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Advisor unavailable");
      setMessages([...next, { role: "assistant", content: body.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="max-w-3xl">
      {messages.length === 0 && (
        <div className="grid sm:grid-cols-2 gap-2 mb-6">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="text-left text-sm bg-white border border-slate-200 hover:border-vital-500 rounded-xl px-4 py-3"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-4 mb-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-vital-600 text-white ml-12"
                : "bg-white border border-slate-200 mr-4"
            }`}
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-400 mr-4">
            Reading your data…
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 sticky bottom-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your data, goals, or what to test next…"
          className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-vital-500"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-vital-600 hover:bg-vital-700 disabled:opacity-50 text-white rounded-xl px-5 text-sm font-medium"
        >
          Send
        </button>
      </form>
    </div>
  );
}
