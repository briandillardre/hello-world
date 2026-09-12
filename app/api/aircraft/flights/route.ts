import { NextRequest, NextResponse } from 'next/server'
import { getFlights } from '@/lib/db/aircraft'
import { ARCHIVE_DAYS } from '@/lib/aircraft-source'
import { getCurrentCompanyId } from '@/lib/db/company'
import { guard, safeHex, isMock } from '../_guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The flight list for one airframe: `?hex=a835af&days=30`.
 *
 * Tracks are stripped here — a month of flights with full tracks is megabytes
 * and the list only draws a row per flight. /api/aircraft/flight fetches the
 * one track the charts need.
 */
export async function GET(req: NextRequest) {
  const blocked = await guard(req, 'ac-flights', 15)
  if (blocked) return blocked

  const hex = safeHex(req.nextUrl.searchParams.get('hex'))
  if (!hex) return NextResponse.json({ error: 'bad aircraft' }, { status: 400 })
  const asked = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('days')) || 30, 365))

  if (isMock) {
    const { demoFlights } = await import('@/lib/aircraft-demo')
    return NextResponse.json({
      flights: demoFlights().map(({ track, pattern, ...rest }) => ({
        ...rest,
        banked: true,
        hasTrack: track.length > 0,
        pattern: pattern.map((w) => ({ field: w.field.name || w.field.ident, touchAndGoes: w.touchAndGoes })),
      })),
      archiveDays: ARCHIVE_DAYS,
      demo: true,
    })
  }

  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const db = createServiceClient()

    // Banked rows older than the archive window exist ONLY because some
    // company saved that airframe, so answering them to anybody turns this
    // route into an oracle for other people's watchlists — which migration
    // 108's own header promises it is not. Only the company that saved a
    // plane reads past the public window (sec-check, Sep 12).
    const companyId = await getCurrentCompanyId()
    const { data: mine } = companyId
      ? await db.from('aircraft_saved').select('id')
          .eq('company_id', companyId).eq('hex', hex).eq('active', true).maybeSingle()
      : { data: null }
    const ours = !!mine
    const days = ours ? asked : Math.min(asked, ARCHIVE_DAYS)

    const res = await getFlights(db, hex, days)
    return NextResponse.json({
      flights: res.flights.map(({ track, pattern, ...rest }) => ({
        ...rest,
        hasTrack: track.length > 0,
        // Just the counts on the list — the circuits themselves are megabytes
        // and only the opened flight needs them.
        pattern: pattern.map((w) => ({ field: w.field.name || w.field.ident, touchAndGoes: w.touchAndGoes })),
      })),
      archiveDays: ARCHIVE_DAYS,
      // Only meaningful for a plane we are actually keeping; for anyone else
      // it would answer "has someone else banked this?".
      beyondArchive: ours && res.beyondArchive,
      truncated: res.truncated,
      saved: ours,
      oldestDay: res.oldestDay,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error && e.message.includes('relation') ? 'The flight log is still deploying.' : 'Could not read the flight log.' },
      { status: 503 },
    )
  }
}
