import { NextRequest, NextResponse } from 'next/server'
import { getAirportBoard } from '@/lib/db/aircraft'
import { findAirport } from '@/lib/airports'
import { guard, isMock } from '../_guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * The board for one field: `?ident=KGMU&days=7`.
 *
 * A pure read of flights we have already derived — no upstream calls, so it
 * is cheap and instant. What it can show depends entirely on how long the
 * field has been watched, and the response says so rather than letting an
 * empty morning read as "nothing flew".
 */
export async function GET(req: NextRequest) {
  const blocked = await guard(req, 'ac-board', 30)
  if (blocked) return blocked

  const raw = (req.nextUrl.searchParams.get('ident') ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{3,4}$/.test(raw)) return NextResponse.json({ error: 'bad airfield' }, { status: 400 })
  const field = findAirport(raw)
  if (!field) return NextResponse.json({ error: `No airfield called ${raw}.` }, { status: 404 })
  const days = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('days')) || 7, 90))

  if (isMock) {
    const { demoBoard } = await import('@/lib/aircraft-demo')
    return NextResponse.json({ field, movements: demoBoard(), demo: true })
  }

  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const db = createServiceClient()
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const movements = await getAirportBoard(db, field.ident, since)
    // When did we start watching? An empty board on a field added an hour ago
    // means something very different from one on a field watched for a month.
    const { data: watch } = await db.from('airports_saved')
      .select('created_at, last_swept_at').eq('ident', field.ident).eq('active', true)
      .order('created_at').limit(1).maybeSingle()
    const w = watch as { created_at: string; last_swept_at: string | null } | null
    return NextResponse.json({
      field,
      movements: movements.map(({ track, pattern, ...rest }) => ({
        ...rest,
        touchAndGoes: pattern.reduce((n, p) => n + p.touchAndGoes, 0),
        hasTrack: track.length > 0,
      })),
      watchingSince: w?.created_at ?? null,
      lastSweptAt: w?.last_swept_at ?? null,
    })
  } catch {
    return NextResponse.json({ error: 'Could not read that board.' }, { status: 503 })
  }
}
