// CRUD endpoint for health-record items (conditions, medications, goals).
// Writes also append a timeline event so the record stays a story.

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/supabase-server";
import { insertRecordItem, insertEvent } from "@/lib/db";
import { sameOriginOk } from "@/lib/security";

export const runtime = "nodejs";

const TABLES = ["conditions", "medications", "goals"] as const;
type Table = (typeof TABLES)[number];

const FIELDS: Record<Table, string[]> = {
  conditions: ["name", "kind", "onset", "resolved_at", "status", "severity", "notes"],
  medications: ["name", "dose", "kind", "started", "stopped", "reason"],
  goals: ["title", "metric", "target_value", "direction", "deadline", "status", "notes"],
};

// Enum-ish fields validated server-side: they flow into SQL check
// constraints (fail late, ugly 500s) and into the AI system prompt
// (goals.metric had no DB constraint at all — the injection vector).
const ENUMS: Record<string, string[]> = {
  "conditions.kind": ["injury", "condition", "surgery", "family_history"],
  "conditions.status": ["active", "managed", "resolved"],
  "medications.kind": ["medication", "supplement"],
  "goals.status": ["active", "achieved", "abandoned"],
  "goals.direction": ["above", "below"],
  "goals.metric": [
    "steps",
    "resting_hr",
    "hrv",
    "stress",
    "body_battery",
    "sleep_score",
    "spo2",
    "respiration",
    "weight",
    "calories",
  ],
};

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req))
    return NextResponse.json({ error: "cross-origin blocked" }, { status: 403 });
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (!Number.isFinite(contentLength) || contentLength > 100_000)
    return NextResponse.json({ error: "too large" }, { status: 413 });
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const table = body.table as Table;
  if (!TABLES.includes(table))
    return NextResponse.json({ error: "bad table" }, { status: 400 });

  const values: Record<string, unknown> = {};
  for (const field of FIELDS[table]) {
    const v = (body.values as Record<string, unknown> | undefined)?.[field];
    if (v === undefined || v === "") continue;
    const allowed = ENUMS[`${table}.${field}`];
    if (allowed && !allowed.includes(String(v)))
      return NextResponse.json(
        { error: `invalid ${field}` },
        { status: 400 }
      );
    values[field] = v;
  }
  const label = String(values.name ?? values.title ?? "").trim();
  if (!label)
    return NextResponse.json({ error: "name/title required" }, { status: 400 });

  const result = await insertRecordItem(userId, table, values);
  if (result.demo)
    return NextResponse.json(
      { error: "demo mode: changes are not saved" },
      { status: 503 }
    );
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: 500 });

  const kind =
    table === "medications"
      ? "medication"
      : table === "goals"
        ? "goal"
        : (values.kind as string) === "surgery"
          ? "surgery"
          : (values.kind as string) === "injury"
            ? "injury"
            : "condition";
  await insertEvent(userId, {
    ts: new Date().toISOString(),
    kind: kind as "condition",
    title: `Added: ${label}`,
    detail: null,
  });

  return NextResponse.json({ ok: true });
}
