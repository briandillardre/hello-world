// CRUD endpoint for health-record items (conditions, medications, goals).
// Writes also append a timeline event so the record stays a story.

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/supabase-server";
import { insertRecordItem, insertEvent } from "@/lib/db";

export const runtime = "nodejs";

const TABLES = ["conditions", "medications", "goals"] as const;
type Table = (typeof TABLES)[number];

const FIELDS: Record<Table, string[]> = {
  conditions: ["name", "kind", "onset", "resolved_at", "status", "severity", "notes"],
  medications: ["name", "dose", "kind", "started", "stopped", "reason"],
  goals: ["title", "metric", "target_value", "direction", "deadline", "status", "notes"],
};

export async function POST(req: NextRequest) {
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
    if (v !== undefined && v !== "") values[field] = v;
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
