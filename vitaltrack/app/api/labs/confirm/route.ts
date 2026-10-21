// Persists a user-reviewed lab extraction (step 2 of the upload flow).
// The payload is re-validated server-side; demo mode never persists.

import { NextRequest, NextResponse } from "next/server";
import { getUserId, createUserClient } from "@/lib/supabase-server";
import { isMock } from "@/lib/supabase";
import { sameOriginOk } from "@/lib/security";
import { validateParsedLab } from "@/lib/labs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req))
    return NextResponse.json({ error: "cross-origin blocked" }, { status: 403 });
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (!Number.isFinite(contentLength) || contentLength > 512_000)
    return NextResponse.json({ error: "too large" }, { status: 413 });
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isMock)
    return NextResponse.json(
      { error: "demo mode: labs are not saved" },
      { status: 503 }
    );

  let parsed;
  try {
    const body = await req.json();
    parsed = validateParsedLab(body.parsed);
  } catch {
    parsed = null;
  }
  if (!parsed)
    return NextResponse.json({ error: "bad payload" }, { status: 400 });

  const supabase = createUserClient();
  const { data: report, error: reportError } = await supabase
    .from("lab_reports")
    .insert({
      user_id: userId,
      source_lab: parsed.source_lab,
      collected_at: parsed.collected_at,
      parsed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (reportError || !report)
    return NextResponse.json(
      { error: reportError?.message ?? "insert failed" },
      { status: 500 }
    );

  const { error: bioError } = await supabase.from("biomarkers").insert(
    parsed.biomarkers.map((b) => ({
      ...b,
      report_id: report.id,
      user_id: userId,
      collected_at: parsed.collected_at,
    }))
  );
  if (bioError)
    return NextResponse.json({ error: bioError.message }, { status: 500 });

  await supabase.from("events").insert({
    user_id: userId,
    ts: parsed.collected_at
      ? `${parsed.collected_at}T09:00:00Z`
      : new Date().toISOString(),
    kind: "lab_draw",
    title: `Bloodwork — ${parsed.source_lab ?? "lab report"}`,
    detail: `${parsed.biomarkers.length} markers saved from upload`,
  });

  return NextResponse.json({ ok: true, report_id: report.id });
}
