import { NextRequest, NextResponse } from 'next/server'
import { guard, isMock } from '../_guard'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getSavedAircraft, MOCK_SAVED } from '@/lib/db/aircraft'
import { liveStates } from '@/lib/aircraft-live'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

/**
 * The caller's saved planes (the flight log's watchlist) and — with ?live=1 —
 * where each one is right now.
 *
 * The map polls this beside its own aircraft feed so a saved plane draws
 * red and blinking wherever it is in the air, even outside the 250 nm the
 * local feed covers; /aircraft uses it to say "in the air now" on the list.
 * Signed in + the aircraft view level (guard); the list itself is read under
 * RLS, so it is the caller's company's and nobody else's. `/api/planes` is
 * public and must stay ignorant of who saved what, which is why the join
 * happens here and on the client, never in that feed.
 */
export async function GET(req: NextRequest) {
  const blocked = await guard(req, 'ac-saved', 60)
  if (blocked) return blocked
  const wantLive = req.nextUrl.searchParams.get('live') === '1'
  const saved = isMock ? MOCK_SAVED : await getSavedAircraft(await getCurrentCompanyId())
  // Demo mode saves nothing and the demo airframe is fiction — no live lookup.
  const live = wantLive && saved.length && !isMock ? await liveStates(saved.map((s) => s.hex)) : null
  return NextResponse.json(
    {
      saved: saved.map((s) => ({
        hex: s.hex, reg: s.reg, label: s.label, typeCode: s.typeCode, descr: s.descr,
        live: live?.planes.get(s.hex) ?? null,
      })),
      // How old the live answer already is on our side, so the client dates
      // each fix the way it dates the feed's (the same seen_pos + age rule).
      ageMs: live ? Math.max(0, Date.now() - live.at) : null,
      // false = the feed did not answer and nothing usable was cached; the
      // client keeps what it had rather than treating silence as "landed".
      liveOk: !wantLive || !saved.length || isMock || !!live,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
