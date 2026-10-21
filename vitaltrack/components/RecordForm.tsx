"use client";

// Add-item form for the health record. One component, three shapes.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Table = "conditions" | "medications" | "goals";

const FORM_FIELDS: Record<
  Table,
  Array<{ name: string; label: string; type: "text" | "date" | "number" | "select"; options?: string[] }>
> = {
  conditions: [
    { name: "name", label: "Name (e.g. Knee surgery 2019)", type: "text" },
    { name: "kind", label: "Kind", type: "select", options: ["injury", "condition", "surgery", "family_history"] },
    { name: "status", label: "Status", type: "select", options: ["active", "managed", "resolved"] },
    { name: "onset", label: "Onset date", type: "date" },
    { name: "resolved_at", label: "Resolved date", type: "date" },
    { name: "severity", label: "Severity 1-5", type: "number" },
    { name: "notes", label: "Notes", type: "text" },
  ],
  medications: [
    { name: "name", label: "Name", type: "text" },
    { name: "dose", label: "Dose (e.g. 2000 IU)", type: "text" },
    { name: "kind", label: "Kind", type: "select", options: ["medication", "supplement"] },
    { name: "started", label: "Started", type: "date" },
    { name: "stopped", label: "Stopped", type: "date" },
    { name: "reason", label: "Reason", type: "text" },
  ],
  goals: [
    { name: "title", label: "Goal (e.g. Resting HR under 58)", type: "text" },
    {
      name: "metric",
      label: "Auto-track metric (optional)",
      type: "select",
      options: ["", "resting_hr", "hrv", "steps", "stress", "body_battery", "sleep_score", "weight"],
    },
    { name: "target_value", label: "Target value", type: "number" },
    { name: "direction", label: "Direction", type: "select", options: ["", "above", "below"] },
    { name: "deadline", label: "Deadline", type: "date" },
  ],
};

export function RecordForm({ table, title }: { table: Table; title: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const values: Record<string, unknown> = {};
    for (const [k, v] of Array.from(form.entries())) {
      if (typeof v === "string" && v !== "") {
        values[k] = ["severity", "target_value"].includes(k) ? Number(v) : v;
      }
    }
    if (table === "goals" && !values.status) values.status = "active";
    const res = await fetch("/api/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ table, values }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to save");
    }
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-vital-600 hover:text-vital-700 font-medium"
      >
        + Add {title}
      </button>
    );

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 mt-2"
    >
      {FORM_FIELDS[table].map((f) => (
        <label key={f.name} className="block text-sm">
          <span className="text-slate-600">{f.label}</span>
          {f.type === "select" ? (
            <select
              name={f.name}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              {f.options!.map((o) => (
                <option key={o} value={o}>
                  {o === "" ? "—" : o.replace("_", " ")}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.name}
              type={f.type}
              required={f.name === "name" || f.name === "title"}
              step={f.type === "number" ? "any" : undefined}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
          )}
        </label>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="bg-vital-600 hover:bg-vital-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5 text-sm font-medium"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-slate-500 px-3"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
