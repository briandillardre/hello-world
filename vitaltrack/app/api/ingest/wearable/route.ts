// Junction (ex-Vital) webhook ingest. Same discipline as HammerTrack's
// flespi handler: signature verified (svix scheme), timing-safe compare,
// fails closed when the secret is unset.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createServiceClient, isMock } from "@/lib/supabase";
import { normalizeJunctionEvent } from "@/lib/wearables";

export const runtime = "nodejs";

const TOLERANCE_S = 5 * 60;

function verifySvix(req: NextRequest, body: string): boolean {
  const secret = process.env.JUNCTION_WEBHOOK_SECRET;
  if (!secret) return false; // fail closed
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_S)
    return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  // Header format: "v1,<base64> v1,<base64> ..."
  for (const part of signatures.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf))
      return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (isMock)
    return NextResponse.json(
      { ok: false, error: "demo mode: ingest disabled" },
      { status: 503 }
    );

  const body = await req.text();
  if (!verifySvix(req, body))
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const normalized = normalizeJunctionEvent(payload);
  if (!normalized.junctionUserId)
    return NextResponse.json({ ok: true, skipped: "no user id" });

  const supabase = createServiceClient();

  // Map Junction's user id → our user via integrations table.
  const { data: integration } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "junction")
    .eq("external_user_id", normalized.junctionUserId)
    .maybeSingle();
  if (!integration)
    return NextResponse.json({ ok: true, skipped: "unknown junction user" });
  const userId = integration.user_id as string;

  let wrote = 0;
  if (normalized.metrics.length) {
    const rows = normalized.metrics.map((m) => ({
      user_id: userId,
      ts: m.ts,
      type: m.type,
      value: m.value,
      source: "junction",
    }));
    const { error } = await supabase
      .from("metric_samples")
      .upsert(rows, { onConflict: "user_id,ts,type" });
    if (error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    wrote += rows.length;
  }
  if (normalized.sleep) {
    const { error } = await supabase.from("sleep_sessions").upsert(
      {
        user_id: userId,
        ...normalized.sleep,
        source: "junction",
      },
      { onConflict: "user_id,start_ts" }
    );
    if (error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    wrote += 1;
  }
  if (normalized.activity) {
    const { error } = await supabase.from("activities").upsert(
      {
        user_id: userId,
        ...normalized.activity,
        source: "junction",
      },
      { onConflict: "user_id,start_ts" }
    );
    if (error)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    wrote += 1;
  }

  return NextResponse.json({ ok: true, wrote });
}
