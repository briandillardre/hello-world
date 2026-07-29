"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ParsedLab } from "@/lib/types";

export function LabUpload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoResult, setDemoResult] = useState<ParsedLab | null>(null);
  const router = useRouter();

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setDemoResult(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/labs/parse", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    e.target.value = "";
    if (!res.ok) {
      setError(body.error ?? "Upload failed");
      return;
    }
    if (body.demo) setDemoResult(body.parsed as ParsedLab);
    else router.refresh();
  }

  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-xl p-5">
      <p className="font-medium text-sm">Upload a lab report (PDF)</p>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">
        Quest, Labcorp, hospital printouts — anything. We extract every
        biomarker and trend it across draws.
      </p>
      <label className="inline-block">
        <span className="bg-vital-600 hover:bg-vital-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
          {busy ? "Parsing…" : "Choose PDF"}
        </span>
        <input
          type="file"
          accept="application/pdf"
          onChange={upload}
          disabled={busy}
          className="hidden"
        />
      </label>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      {demoResult && (
        <div className="mt-4 text-sm">
          <p className="text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-2">
            Demo mode: parsed {demoResult.biomarkers.length} markers from{" "}
            {demoResult.source_lab ?? "your report"} — not saved. Connect
            Supabase to persist labs.
          </p>
          <ul className="text-slate-600 space-y-0.5 max-h-48 overflow-y-auto">
            {demoResult.biomarkers.map((b) => (
              <li key={b.name}>
                {b.name}: <b>{b.value}</b> {b.unit ?? ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
