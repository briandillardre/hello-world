// Connects the signed-in user's Garmin via Junction (ex-Vital), entirely
// server-side: we create (or resolve) the Junction user under OUR
// client_user_id, store the mapping with the service client, and hand back
// a Junction Link URL. Users can never claim an arbitrary Junction user id
// — the integrations table is not writable from the client (see 001 RLS).

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/supabase-server";
import { createServiceClient, isMock } from "@/lib/supabase";
import { sameOriginOk } from "@/lib/security";

export const runtime = "nodejs";

const API_BASE =
  process.env.JUNCTION_API_BASE || "https://api.sandbox.tryvital.io";

async function junctionFetch(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-vital-api-key": process.env.JUNCTION_API_KEY!,
      ...(init?.headers ?? {}),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req))
    return NextResponse.json({ error: "cross-origin blocked" }, { status: 403 });
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isMock)
    return NextResponse.json(
      { error: "demo mode: connect Supabase + Junction env vars first" },
      { status: 503 }
    );
  if (!process.env.JUNCTION_API_KEY)
    return NextResponse.json(
      { error: "JUNCTION_API_KEY not configured" },
      { status: 503 }
    );

  try {
    // 1. Create the Junction user keyed by our auth uid (idempotent-ish:
    //    on conflict, resolve the existing one).
    let junctionUserId: string | null = null;
    const createRes = await junctionFetch("/v2/user/", {
      method: "POST",
      body: JSON.stringify({ client_user_id: userId }),
    });
    if (createRes.ok) {
      const body = (await createRes.json()) as { user_id?: string };
      junctionUserId = body.user_id ?? null;
    } else {
      const resolveRes = await junctionFetch(`/v2/user/resolve/${userId}`);
      if (resolveRes.ok) {
        const body = (await resolveRes.json()) as { user_id?: string };
        junctionUserId = body.user_id ?? null;
      }
    }
    if (!junctionUserId)
      return NextResponse.json(
        { error: "could not create/resolve Junction user" },
        { status: 502 }
      );

    // 2. Store the mapping (service role — table is closed to clients).
    const supabase = createServiceClient();
    const { error: mapError } = await supabase.from("integrations").upsert(
      {
        user_id: userId,
        provider: "junction",
        external_user_id: junctionUserId,
        status: "connected",
      },
      { onConflict: "provider,external_user_id" }
    );
    if (mapError)
      return NextResponse.json({ error: mapError.message }, { status: 500 });

    // 3. Mint a Link token so the user can attach their Garmin account.
    const tokenRes = await junctionFetch("/v2/link/token", {
      method: "POST",
      body: JSON.stringify({ user_id: junctionUserId }),
    });
    if (!tokenRes.ok)
      return NextResponse.json(
        { error: "could not create Junction link token" },
        { status: 502 }
      );
    const tokenBody = (await tokenRes.json()) as { link_token?: string };
    if (!tokenBody.link_token)
      return NextResponse.json(
        { error: "no link token returned" },
        { status: 502 }
      );

    return NextResponse.json({
      ok: true,
      linkUrl: `https://link.tryvital.io/?token=${encodeURIComponent(tokenBody.link_token)}`,
    });
  } catch (err) {
    console.error("junction connect error", err);
    return NextResponse.json(
      { error: "Junction unreachable, try again" },
      { status: 502 }
    );
  }
}
