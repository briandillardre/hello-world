import { NextRequest, NextResponse } from 'next/server'
import { addDaysKey } from '@/lib/dates'
import { companyToday, mirrorFuelExpenses, runFuelCheck } from '@/lib/db/fuel-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The fuel pilot's nightly re-check (migration 130, lib/db/fuel-check.ts).
 * The evidence a fuel purchase is judged on arrives AFTER it: the gauge
 * reading that shows the fill, the engine running the next morning, a
 * tracker's buffered fixes. So every night, for each company in a pilot:
 *   1. card-alert / receipt fuel charges from `expenses` join the pilot;
 *   2. anything never checked (a big import that ran out of time) is checked;
 *   3. the last 14 days are checked again — exceptions update in place,
 *      a verdict is never touched, a kind that now passes is cleared.
 *
 * Its own cron rather than a step in an existing one: it has its own
 * five-minute budget (the station lookups ride a free community geocoder
 * that can take seconds a call), so a slow night here can never starve the
 * health checks or the insights run. 09:35 UTC = 5:35 AM Eastern, after the
 * overnight uploads and the hourly hours ledger.
 *
 * Fails CLOSED on CRON_SECRET like every other cron here.
 * Manual test: GET /api/cron/fuel-check with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const started = Date.now()
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: pilots, error } = await svc.from('fuel_pilot').select('company_id').limit(100)
  if (error) return NextResponse.json({ ok: false, error: 'fuel_pilot unreadable (migration 130 pending?)' }, { status: 200 })
  const ids = ((pilots ?? []) as { company_id: string }[]).map((p) => p.company_id)
  const results: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i++) {
    const left = 280_000 - (Date.now() - started)
    if (left < 15_000) { results.push({ company: ids[i], skipped: 'out of time' }); continue }
    const share = Math.max(15_000, Math.floor(left / (ids.length - i)))
    try {
      const { data: co } = await svc.from('companies').select('digest_prefs').eq('id', ids[i]).maybeSingle()
      const { todayKey } = companyToday((co as { digest_prefs?: unknown } | null)?.digest_prefs)
      const since = addDaysKey(todayKey, -14)
      const mirrored = await mirrorFuelExpenses(svc, ids[i], since)
      const backlog = await runFuelCheck(svc, ids[i], { uncheckedOnly: true, budgetMs: Math.floor(share * 0.4), geocodeCalls: 40 })
      const recent = await runFuelCheck(svc, ids[i], { sinceKey: since, budgetMs: Math.floor(share * 0.6), geocodeCalls: 30 })
      results.push({ company: ids[i], mirrored, backlog, recent })
    } catch (err) {
      console.error('fuel check cron failed for', ids[i], err instanceof Error ? err.message : err)
      results.push({ company: ids[i], failed: true })
    }
  }
  return NextResponse.json({ ok: true, companies: ids.length, ms: Date.now() - started, results })
}
