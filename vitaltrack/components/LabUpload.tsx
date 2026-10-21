"use client";

// Two-step lab upload: parse → user reviews the extraction → save.
// Nothing touches the record until the user confirms (untrusted-PDF rule).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isMock } from "@/lib/env";
import type { ParsedLab } from "@/lib/types";

export function LabUpload() {
  const [busy, setBusy] = useState<"idle" | "parsing" | "saving">("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ParsedLab | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setBusy("parsing");
    setError("");
    setPreview(null);
    setSaved(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/labs/parse", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      setPreview(body.parsed as ParsedLab);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy("idle");
      input.value = "";
    }
  }

  async function save() {
    if (!preview) return;
    setBusy("saving");
    setError("");
    try {
      const res = await fetch("/api/labs/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parsed: preview }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setSaved(true);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-xl p-5">
      <p className="font-medium text-sm">Upload a lab report (PDF)</p>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">
        Quest, Labcorp, hospital printouts — anything. We extract every
        biomarker, you review the numbers, then save.
      </p>
      <label className="inline-block">
        <span className="bg-vital-600 hover:bg-vital-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
          {busy === "parsing" ? "Parsing…" : "Choose PDF"}
        </span>
        <input
          type="file"
          accept="application/pdf"
          onChange={upload}
          disabled={busy !== "idle"}
          className="hidden"
        />
      </label>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      {saved && (
        <p className="text-sm text-vital-700 mt-3">Saved to your record.</p>
      )}
      {preview && (
        <div className="mt-4 text-sm">
          <p className="font-medium">
            Review the extraction — {preview.biomarkers.length} markers from{" "}
            {preview.source_lab ?? "your report"}
            {preview.collected_at ? `, drawn ${preview.collected_at}` : ""}:
          </p>
          <ul className="text-slate-600 space-y-0.5 max-h-48 overflow-y-auto mt-2">
            {preview.biomarkers.map((b, i) => (
              <li key={`${b.name}-${i}`}>
                {b.name}: <b>{b.value}</b> {b.unit ?? ""}
                {b.ref_low !== null || b.ref_high !== null
                  ? ` (ref ${b.ref_low ?? ""}–${b.ref_high ?? ""})`
                  : ""}
              </li>
            ))}
          </ul>
          {isMock ? (
            <p className="text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3">
              Demo mode: parsing works, saving is disabled. Connect Supabase to
              keep labs.
            </p>
          ) : (
            <div className="flex gap-2 mt-3">
              <button
                onClick={save}
                disabled={busy !== "idle"}
                className="bg-vital-600 hover:bg-vital-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
              >
                {busy === "saving" ? "Saving…" : "Looks right — save to my record"}
              </button>
              <button
                onClick={() => setPreview(null)}
                className="text-sm text-slate-500 px-3"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
