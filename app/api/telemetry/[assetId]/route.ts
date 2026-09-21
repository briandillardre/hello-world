import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getTruckReadings, getTruckTrend, pickTrendKeys } from '@/lib/db/telemetry'
import { safeTz } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * Truck readings for ONE asset (115): the newest value of every parameter
 * its tracker has sent, and — with ?trend=1 — the last week's daily
 * min / max / avg for the readings that earn a chart.
 *
 * Signed in only; row-level security scopes it to the caller's company and
 * hides what the per-asset visibility ladder hides. A key that is not this
 * company's (or not visible) reads exactly like one that has never reported.
 */
export async function GET(req: NextRequest, { params }: { params: { assetId: string } }) {
  const id = (params.assetId ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const { createClient } = await import('@/lib/supabase-server')
  const { data: auth } = await createClient().auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const latest = await getTruckReadings(id)
  const wantTrend = req.nextUrl.searchParams.get('trend') === '1'
  const days = Number(req.nextUrl.searchParams.get('days') ?? 7)
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const trend = wantTrend && latest
    ? await getTruckTrend(id, pickTrendKeys(latest.readings), Number.isFinite(days) ? days : 7, tz)
    : undefined

  return NextResponse.json(
    { readings: latest?.readings ?? {}, updatedAt: latest?.updatedAt ?? null, trend },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
