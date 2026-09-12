import { NextRequest, NextResponse } from 'next/server'
import { getBankedFlight, fieldAt } from '@/lib/db/aircraft'
import { fetchTraceDays, utcDay } from '@/lib/aircraft-source'
import { flightsFromTraces } from '@/lib/aircraft-log'
import { guard, safeHex, isMock } from '../_guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

/**
 * One flight, with the track the three charts are drawn from:
 * `?id=<hex>-<takeoff epoch>`.
 *
 * Banked first (one row read). Otherwise the flight is re-derived from the
 * upstream day it happened on — the id carries the takeoff second, so that
 * is a single day file, not the whole window.
 */
export async function GET(req: NextRequest) {
  const blocked = await guard(req, 'ac-flight', 12)
  if (blocked) return blocked
  const id = (req.nextUrl.searchParams.get('id') ?? '').trim()
  if (isMock) {
    const { demoFlights } = await import('@/lib/aircraft-demo')
    return NextResponse.json({ flight: demoFlights().find((f) => f.id === id) ?? null, demo: true })
  }

  const m = /^([0-9a-f]{6})-(\d{9,11})$/.exec(id)
  if (!m) return NextResponse.json({ error: 'bad flight' }, { status: 400 })
  const hex = safeHex(m[1])
  const startedAt = Number(m[2])
  if (!hex || !Number.isFinite(startedAt)) return NextResponse.json({ error: 'bad flight' }, { status: 400 })

  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const db = createServiceClient()
    const banked = await getBankedFlight(db, id)
    if (banked?.track?.length) return NextResponse.json({ flight: banked })

    // Not banked: re-derive from the day this flight took off, plus the day
    // either side so a midnight crossing comes back whole. THREE day files —
    // never the whole window. Going through getFlights() here pulled every
    // banked track in the span out of Postgres (up to 500 × ~38 KB ≈ 19 MB)
    // to then keep one of them (sec-check, Sep 12).
    const day = utcDay(new Date(startedAt * 1000))
    const around = [-1, 0, 1].map((d) => utcDay(new Date((startedAt + d * 86_400) * 1000)))
    const traces = await fetchTraceDays(hex, Array.from(new Set([day, ...around])))
    const flight = flightsFromTraces(traces, { fieldAt }).flights.find((f) => f.id === id) ?? null
    return NextResponse.json({ flight })
  } catch {
    return NextResponse.json({ error: 'Could not read that flight.' }, { status: 503 })
  }
}
