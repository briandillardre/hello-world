import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Custody history for a tool: who carried it, when, from pairing_log
 * (migration 021 — one row per pairing EPISODE, ended_at NULL while live).
 * Answers "which truck had the laser level last Tuesday?" for the tool page.
 *
 * Auth: caller's Supabase session cookie; RLS scopes both the asset lookup
 * and pairing_log to the caller's company. A tool outside the company (or a
 * bogus id) is a 404, never someone else's history.
 */

interface Episode {
  carrierId: string
  carrierName: string
  startMs: number
  endMs: number | null
  open: boolean
}

const WINDOW_MS = 30 * 86_400_000
const EPISODE_CAP = 50
const EMPTY = { episodes: [] as Episode[], lastSeenMs: null, lastGatewayName: null }

export async function GET(req: NextRequest) {
  try {
    const assetId = req.nextUrl.searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })
    if (isMock) return NextResponse.json(EMPTY)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Company-scope check: RLS on assets only returns rows in the caller's
    // company — anything else 404s here before we touch the log.
    const { data: tool, error: toolErr } = await supabase
      .from('assets')
      .select('id, company_id')
      .eq('id', assetId)
      .maybeSingle()
    if (toolErr || !tool) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString()
    const { data: rows, error: logErr } = await supabase
      .from('pairing_log')
      .select('carrier_asset_id, started_at, last_seen, ended_at')
      .eq('member_asset_id', assetId)
      // Episodes that TOUCH the window: still open, or ended inside it —
      // an open pairing that started 40 days ago must not vanish.
      .or(`ended_at.is.null,ended_at.gte.${sinceIso}`)
      .order('started_at', { ascending: false })
      .limit(EPISODE_CAP)
    // Pre-021 database (table missing) → empty history, never a 500.
    if (logErr) return NextResponse.json(EMPTY)

    const carrierIds = Array.from(new Set((rows ?? []).map((r) => r.carrier_asset_id as string)))
    const carrierName = new Map<string, string>()
    if (carrierIds.length) {
      const { data: carriers } = await supabase
        .from('assets')
        .select('id, name')
        .in('id', carrierIds)
      for (const c of carriers ?? []) carrierName.set(c.id as string, (c.name as string) || 'Unknown')
    }

    const episodes: Episode[] = []
    for (const r of rows ?? []) {
      const startMs = Date.parse(r.started_at as string)
      if (!Number.isFinite(startMs)) continue
      const endMs = r.ended_at ? Date.parse(r.ended_at as string) : NaN
      episodes.push({
        carrierId: r.carrier_asset_id as string,
        carrierName: carrierName.get(r.carrier_asset_id as string) ?? 'Unknown',
        startMs,
        endMs: Number.isFinite(endMs) ? endMs : null,
        open: r.ended_at == null,
      })
    }

    // Newest episode's last_seen = the tag's most recent confirmed sighting.
    let lastSeenMs: number | null = null
    let lastGatewayName: string | null = null
    const newest = (rows ?? [])[0]
    if (newest) {
      const seen = Date.parse((newest.last_seen ?? newest.started_at) as string)
      if (Number.isFinite(seen)) lastSeenMs = seen
      lastGatewayName = carrierName.get(newest.carrier_asset_id as string) ?? null
    }

    return NextResponse.json({ episodes, lastSeenMs, lastGatewayName })
  } catch {
    return NextResponse.json(EMPTY)
  }
}
