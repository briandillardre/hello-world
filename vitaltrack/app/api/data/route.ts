// Data rights from day one (plan §6): GET = export everything as JSON,
// DELETE = erase all health data for the signed-in user.

import { NextResponse, type NextRequest } from "next/server";
import { getUserId, createUserClient } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";
import { sameOriginOk } from "@/lib/security";
import * as db from "@/lib/db";

export const runtime = "nodejs";

const TABLES = [
  "profiles",
  "ai_digests",
  "metric_samples",
  "sleep_sessions",
  "activities",
  "conditions",
  "medications",
  "goals",
  "lab_reports",
  "biomarkers",
  "events",
  "integrations",
] as const;

export async function GET() {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (isMock) {
    const [metrics, sleep, conditions, meds, goals, labs, biomarkers, events] =
      await Promise.all([
        db.getDailyMetrics(userId, 100000),
        db.getSleepSessions(userId, 100000),
        db.getConditions(userId),
        db.getMedications(userId),
        db.getGoals(userId),
        db.getLabReports(userId),
        db.getBiomarkers(userId),
        db.getEvents(userId),
      ]);
    return exportResponse({
      demo: true,
      daily_metrics: metrics,
      sleep_sessions: sleep,
      conditions,
      medications: meds,
      goals,
      lab_reports: labs,
      biomarkers,
      events,
    });
  }

  const supabase = createUserClient();
  const dump: Record<string, unknown> = {};
  for (const table of TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .limit(100000);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    dump[table] = data;
  }
  return exportResponse(dump);
}

function exportResponse(payload: unknown) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="vitaltrack-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export async function DELETE(req: NextRequest) {
  if (!sameOriginOk(req))
    return NextResponse.json({ error: "cross-origin blocked" }, { status: 403 });
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isMock)
    return NextResponse.json(
      { error: "demo mode: nothing to delete" },
      { status: 503 }
    );

  const supabase = createUserClient();
  for (const table of TABLES) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
