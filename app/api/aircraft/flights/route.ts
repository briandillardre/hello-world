import { NextRequest, NextResponse } from 'next/server'
import { getFlights } from '@/lib/db/aircraft'
import { ARCHIVE_DAYS } from '@/lib/aircraft-source'
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
  const blocked = await guard(req, 'ac-flights', 40)
  if (blocked) return blocked

  const hex = safeHex(req.nextUrl.searchParams.get('hex'))
  if (!hex) return NextResponse.json({ error: 'bad aircraft' }, { status: 400 })
  const days = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('days')) || 30, 365))

  if (isMock) {
    const { demoFlights } = await import('@/lib/aircraft-demo')
    return NextResponse.json({
      flights: demoFlights().map(({ track, ...rest }) => ({ ...rest, banked: true, hasTrack: track.length > 0 })),
      archiveDays: ARCHIVE_DAYS,
      demo: true,
    })
  }

  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const res = await getFlights(createServiceClient(), hex, days)
    return NextResponse.json({
      flights: res.flights.map(({ track, ...rest }) => ({ ...rest, hasTrack: track.length > 0 })),
      archiveDays: ARCHIVE_DAYS,
      beyondArchive: res.beyondArchive,
      oldestDay: res.oldestDay,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error && e.message.includes('relation') ? 'The flight log is still deploying.' : 'Could not read the flight log.' },
      { status: 503 },
    )
  }
}
