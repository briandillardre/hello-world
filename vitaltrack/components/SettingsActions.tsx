"use client";

import { useState } from "react";

export function ImportForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setBusy(true);
    setResult("");
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    const res = await fetch("/api/import/garmin", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    e.target.value = "";
    if (!res.ok) setResult(`Error: ${body.error ?? "import failed"}`);
    else
      setResult(
        `Imported ${body.metricsWritten} daily metrics, ${body.activitiesWritten} activities.` +
          (body.errors?.length ? ` Skipped: ${body.errors.join("; ")}` : "")
      );
  }

  return (
    <div>
      <label className="inline-block">
        <span className="bg-vital-600 hover:bg-vital-700 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer">
          {busy ? "Importing…" : "Choose .csv / .fit files"}
        </span>
        <input
          type="file"
          multiple
          accept=".csv,.fit"
          onChange={upload}
          disabled={busy}
          className="hidden"
        />
      </label>
      {result && <p className="text-sm text-slate-600 mt-2">{result}</p>}
    </div>
  );
}

export function DataRights() {
  const [status, setStatus] = useState("");

  async function eraseAll() {
    if (
      !window.confirm(
        "Delete ALL your health data from VitalTrack? This cannot be undone."
      )
    )
      return;
    const res = await fetch("/api/data", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setStatus(res.ok ? "All data deleted." : `Error: ${body.error ?? "failed"}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href="/api/data"
        className="border border-slate-300 hover:border-vital-500 rounded-lg px-4 py-2 text-sm font-medium"
      >
        Export everything (JSON)
      </a>
      <button
        onClick={eraseAll}
        className="border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-4 py-2 text-sm font-medium"
      >
        Delete all my data
      </button>
      {status && <p className="text-sm text-slate-600">{status}</p>}
    </div>
  );
}
