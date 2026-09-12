import { NextRequest, NextResponse } from 'next/server'
import { flightsFromTraces } from '@/lib/aircraft-log'
import { aircraftNear, availableDays, fetchTraceDays, utcDay } from '@/lib/aircraft-source'
import { findAirport } from '@/lib/airports'
import { bankFlights, getAllSavedAirports, fieldAt } from '@/lib/db/aircraft'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The sweep that fills an airport board.
 *
 * FlightRadar24 locks a field's history past 12 hours behind a paid tier, and
 * there is no free endpoint that answers "what used KGMU today" at any price.
 * So this builds it the same way saved planes work — by writing it down:
 *
 *   1. Look near each watched field (one cheap call per airport).
 *   2. For every airframe seen there, read its trace and derive its flights —
 *      the same pipeline the flight log already runs.
 *   3. Bank the ones whose confirmed origin or destination IS that field.
 *
 * Step 2 is the expensive one, so an airframe already banked for today is
 * skipped entirely. A busy field costs a few dozen trace reads a day; a quiet
 * one costs almost nothing.
 *
 * Runs every 20 minutes: a departure stays visible near the field for longer
 * than that as it climbs out, and an arrival is on the ground for longer
 * still. Fails CLOSED on CRON_SECRET like every other cron here.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const now = new Date()
  const today = utcDay(now)
  // One sweep must never turn into hundreds of upstream reads.
  const budget = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('max')) || 60, 200))
  const radius = Math.max(3, Math.min(Number(req.nextUrl.searchParams.get('r')) || 12, 30))

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  let idents: string[]
  try {
    idents = await getAllSavedAirports(db)
  } catch {
    return NextResponse.json({ ok: true, skipped: 'pre-110 schema' })
  }
  if (!idents.length) return NextResponse.json({ ok: true, airports: 0 })

  const results: { ident: string; seen: number; read: number; banked: number }[] = []
  let spent = 0

  for (const ident of idents.slice(0, 25)) {
    const field = findAirport(ident)
    if (!field) { results.push({ ident, seen: 0, read: 0, banked: 0 }); continue }
    try {
      const seen = await aircraftNear(field.lat, field.lon, radius)
      if (!seen.length) {
        await db.from('airports_saved').update({ last_swept_at: now.toISOString() }).eq('ident', ident).eq('active', true)
        results.push({ ident, seen: 0, read: 0, banked: 0 })
        continue
      }

      // Who have we already read today? Those cost nothing to skip.
      const hexes = seen.map((a) => a.hex)
      const { data: already } = await db.from('aircraft_flights')
        .select('hex').in('hex', hexes)
        .gte('started_at', `${today}T00:00:00Z`)
      const done = new Set(((already ?? []) as { hex: string }[]).map((r) => r.hex))

      let read = 0
      let banked = 0
      for (const a of seen) {
        if (spent >= budget) break
        if (done.has(a.hex)) continue
        spent++
        read++
        // Today plus yesterday: an arrival at 00:30 local departed the day
        // before, and its flight belongs on this board.
        const traces = await fetchTraceDays(a.hex, availableDays(now, 2), now)
        if (!traces.length) continue
        const { flights } = flightsFromTraces(traces, { fieldAt })
        // Only what actually touched THIS field. Everything else the aircraft
        // did today is somebody else's business — and banking it would turn a
        // sweep of one airport into a crawl of the whole network.
        const mine = flights.filter((f) => {
          const ends = [f.departed ? fieldAt(f.from.lat, f.from.lon)?.ident : null,
                        f.arrived ? fieldAt(f.to.lat, f.to.lon)?.ident : null]
          return ends.includes(ident)
        })
        if (mine.length) banked += (await bankFlights(db, mine)).written
      }

      await db.from('airports_saved').update({ last_swept_at: now.toISOString() }).eq('ident', ident).eq('active', true)
      results.push({ ident, seen: seen.length, read, banked })
    } catch (e) {
      console.error('airport sweep failed for', ident, e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ ok: true, airports: idents.length, upstreamReads: spent, results })
}
