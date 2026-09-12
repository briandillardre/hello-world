import { NextRequest, NextResponse } from 'next/server'
import { flightsFromTraces } from '@/lib/aircraft-log'
import { availableDays, fetchTraceDays, lookupAircraft, utcDay } from '@/lib/aircraft-source'
import { bankFlights, getAllSavedHexes, getBankedFlights } from '@/lib/db/aircraft'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The thing that makes "save a plane" mean something.
 *
 * adsb.lol keeps a rolling ~30 days. Every night this reads the days that
 * have passed since we last looked for each SAVED airframe and writes their
 * completed flights into `aircraft_flights`, which has no expiry. Day 31 of
 * a saved plane's history exists because this ran; for a plane nobody saved
 * it never existed at all.
 *
 * Deliberately small and repeatable rather than clever:
 *  • Only days with nothing banked are fetched, so a normal night is one day
 *    per plane and a plane added today backfills the whole window once.
 *  • Upserts by flight id, so running it twice changes nothing.
 *  • A flight still flagged open (it ran to the edge of its day file) is
 *    re-read the next night and rewritten whole once its other half lands.
 *
 * Fails CLOSED on CRON_SECRET like every other cron here — it spends a free
 * community API on our behalf and must not be pokeable by the internet.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const now = new Date()
  const force = req.nextUrl.searchParams.get('force') === '1'
  // One airframe can take a few seconds of upstream reads; stay inside the
  // lambda budget and let the next run pick up the rest.
  const budget = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('max')) || 40, 200))

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  let hexes: string[]
  try {
    hexes = await getAllSavedHexes(db)
  } catch {
    return NextResponse.json({ ok: true, skipped: 'pre-108 schema' })
  }
  if (!hexes.length) return NextResponse.json({ ok: true, saved: 0 })

  // Longest-unsynced first, so a big list still gives every plane its turn
  // instead of starving the tail of the alphabet.
  const { data: rows } = await db.from('aircraft_saved')
    .select('hex, last_synced_at').eq('active', true)
  const syncedAt = new Map<string, string | null>()
  for (const r of (rows ?? []) as { hex: string; last_synced_at: string | null }[]) {
    const prev = syncedAt.get(r.hex)
    if (prev === undefined || (r.last_synced_at ?? '') < (prev ?? '')) syncedAt.set(r.hex, r.last_synced_at)
  }
  const queue = hexes
    .sort((a, b) => (syncedAt.get(a) ?? '').localeCompare(syncedAt.get(b) ?? ''))
    .slice(0, budget)

  const results: { hex: string; days: number; banked: number; failed?: number }[] = []
  const window = availableDays(now)

  for (const hex of queue) {
    try {
      // Which days do we already hold? A day with a CLOSED banked flight is
      // finished; a day whose flight is still open gets re-read so its other
      // half can be joined on.
      const banked = await getBankedFlights(db, hex, new Date(now.getTime() - 32 * 86_400_000).toISOString())
      // A day counts as settled only if we read it AFTER it finished.
      //
      // This cron runs at 02:20 UTC, so its read of "today" only ever sees
      // 00:00–02:20 of it. Marking that day done because a red-eye landed at
      // 01:00 UTC lost every later flight that day, permanently — the day was
      // never re-read and the live path skipped it too (ship-check, Sep 12).
      const dayEndMs = (d: string) => Date.parse(`${d}T00:00:00Z`) + 86_400_000
      const settled = new Set<string>()
      for (const f of banked) {
        const day = utcDay(new Date(f.startedAt * 1000))
        const readAfterDayEnded = f.bankedAt ? Date.parse(f.bankedAt) >= dayEndMs(day) : false
        if (!f.openEnd && readAfterDayEnded) settled.add(day)
      }
      settled.delete(utcDay(now))
      const todo = force ? window : window.filter((d) => !settled.has(d))
      if (!todo.length) {
        await db.from('aircraft_saved').update({ last_synced_at: now.toISOString() }).eq('hex', hex).eq('active', true)
        results.push({ hex, days: 0, banked: 0 })
        continue
      }

      // Never derive a day without the day BEFORE it. A red-eye is stitched
      // from two files; reading the later one alone yields an orphan
      // `openStart` fragment that banks as a second copy of the same trip and
      // never self-heals (ship-check, Sep 12). The stitched result upserts
      // onto the earlier day's id, so this stays idempotent.
      const withPredecessors = Array.from(new Set(todo.flatMap((d) => [
        d,
        utcDay(new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000)),
      ]))).sort().reverse()
      const traces = await fetchTraceDays(hex, withPredecessors, now)
      const { ident, flights } = flightsFromTraces(traces)
      const { written: wrote, failed } = await bankFlights(db, flights)

      const newest = flights.reduce((m, f) => Math.max(m, f.endedAt), 0)
      // A partial write must not look like progress — leaving last_synced_at
      // alone puts this airframe back at the front of tomorrow's queue.
      const patch: Record<string, unknown> = failed ? {} : { last_synced_at: now.toISOString() }
      if (newest) patch.last_flight_at = new Date(newest * 1000).toISOString()
      // Keep the saved row's identity honest — tail numbers do get reassigned.
      if (ident?.reg) { patch.reg = ident.reg; patch.type_code = ident.typeCode; patch.descr = ident.desc }
      else {
        const looked = await lookupAircraft(hex)
        if (looked?.reg) { patch.reg = looked.reg; patch.type_code = looked.typeCode; patch.descr = looked.desc; patch.owner = looked.owner }
      }
      if (Object.keys(patch).length) {
        // By hex across every company: each field written here is public
        // upstream data, and `label` / `notes` are never touched.
        await db.from('aircraft_saved').update(patch).eq('hex', hex).eq('active', true)
      }
      results.push({ hex, days: todo.length, banked: wrote, failed })
    } catch (e) {
      console.error('aircraft-log failed for', hex, e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({
    ok: true,
    saved: hexes.length,
    processed: results.length,
    remaining: Math.max(0, hexes.length - results.length),
    results,
  })
}
