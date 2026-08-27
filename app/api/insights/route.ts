import { NextRequest, NextResponse } from 'next/server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { getActiveInsights, insightQuestion, runInsightsEngine, type InsightRow } from '@/lib/insights'
import { resolveDigestPrefs } from '@/lib/weekly-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

/** Demo mode: three canned findings that match the mock fleet's story, so
 *  the front-door demo shows the product noticing things. */
const DEMO_INSIGHTS = [
  {
    id: 'demo-1', detector: 'idle_money', severity: 2, money: true,
    headline: 'Sakai SW990 hasn\'t worked in 9 days — ~$315 of ownership burned',
    detail: 'Ownership accrues at $35/day whether it works or sits.',
    link: '/assets', fired_at: new Date().toISOString(), evidence: { idleDays: 9 },
  },
  {
    id: 'demo-2', detector: 'cost_concentration', severity: 1, money: true,
    headline: 'Riverfront Tower took $2,140 — 64% of this week\'s tracked cost',
    detail: '4 sites saw machine time this week; $3,340 total tracked.',
    link: '/zones', fired_at: new Date().toISOString(), evidence: {},
  },
  {
    id: 'demo-3', detector: 'receipts_gap', severity: 1, money: true,
    headline: '6 charges · $487 missing receipts — oldest 11d',
    detail: 'Every one of these is a deduction waiting on a photo.',
    link: '/receipts', fired_at: new Date().toISOString(), evidence: {},
  },
] as unknown as InsightRow[]

async function requireUser(): Promise<boolean> {
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    return !!user
  } catch {
    return false
  }
}

/**
 * Active insights for the signed-in user's company + the tap-to-ask
 * questions they suggest. Money-bearing rows are stripped for non-cost
 * roles before they reach the wire (same rule as costToday).
 *
 * LAZY FIRST RUN: when the company has no metrics spine from the last 26h
 * (first deploy, brand-new company, a missed cron night), the engine runs
 * inline — bounded queries, a couple of seconds — so the feature works the
 * first time anyone looks, not after the next 4 AM.
 */
export async function GET() {
  if (isMock) {
    return NextResponse.json({
      insights: DEMO_INSIGHTS,
      questions: DEMO_INSIGHTS.map((r) => insightQuestion(r)),
    }, NO_STORE)
  }
  if (!(await requireUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [companyId, perms] = await Promise.all([getCurrentCompanyId(), getMyPermissions()])
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  try {
    const { data: fresh } = await db.from('company_metrics_daily')
      .select('built_at').eq('company_id', companyId)
      .order('built_at', { ascending: false }).limit(1)
    const builtAt = fresh?.[0]?.built_at ? Date.parse(fresh[0].built_at) : 0
    if (Date.now() - builtAt > 26 * 3_600_000) {
      const { data: co } = await db.from('companies').select('digest_prefs').eq('id', companyId).limit(1)
      const tz = resolveDigestPrefs(co?.[0]?.digest_prefs).tz
      await runInsightsEngine(db, companyId, tz)
    }
  } catch { /* pre-079 database — return empty below */ }

  const insights = await getActiveInsights(db, companyId, { limit: 8, includeMoney: perms.canViewCosts })
  return NextResponse.json({
    insights,
    questions: insights.slice(0, 3).map((r) => insightQuestion(r)),
  }, NO_STORE)
}

/** Dismiss one insight ("saw it, leave me alone") — it stays quiet unless
 *  its magnitude later grows 1.5× (engine rule). Membership is verified
 *  through the session; the write goes through the service client so the
 *  insights table needs no user-facing write policy. */
export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true })
  if (!(await requireUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { id?: string } | null
  const id = typeof body?.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const companyId = await getCurrentCompanyId()
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { error } = await createServiceClient()
    .from('insights')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId)
  if (error) return NextResponse.json({ error: 'dismiss failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
