"use client";

import { useState } from "react";

export function ConnectGarmin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/integrations/junction", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Connect failed");
      setLinkUrl(body.linkUrl);
      window.open(body.linkUrl, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={connect}
        disabled={busy}
        className="bg-vital-600 hover:bg-vital-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
      >
        {busy ? "Connecting…" : "Connect Garmin"}
      </button>
      {linkUrl && (
        <p className="text-sm text-slate-600 mt-2">
          A Junction Link window opened — finish connecting there. Blocked
          pop-up?{" "}
          <a href={linkUrl} target="_blank" rel="noopener" className="text-vital-600 underline">
            open it here
          </a>
          .
        </p>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

export function ImportForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const files = input.files;
    if (!files?.length) return;
    setBusy(true);
    setResult("");
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await fetch("/api/import/garmin", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setResult(`Error: ${body.error ?? "import failed"}`);
      else
        setResult(
          `Imported ${body.metricsWritten} daily metrics, ${body.activitiesWritten} activities.` +
            (body.errors?.length ? ` Skipped: ${body.errors.join("; ")}` : "")
        );
    } catch (err) {
      setResult(
        `Error: ${err instanceof Error ? err.message : "import failed"}`
      );
    } finally {
      setBusy(false);
      input.value = "";
    }
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
    try {
      const res = await fetch("/api/data", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      setStatus(
        res.ok ? "All data deleted." : `Error: ${body.error ?? "failed"}`
      );
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : "failed"}`);
    }
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
