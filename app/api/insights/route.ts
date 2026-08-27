import { NextRequest, NextResponse } from 'next/server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { DEMO_INSIGHTS, getActiveInsights, insightQuestion, runInsightsEngine } from '@/lib/insights'
import { resolveDigestPrefs } from '@/lib/weekly-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

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
      // Claim the spine BEFORE the heavy gather: the tray and the Ask chips
      // fetch together on first open, and both passed the staleness check —
      // this upsert closes the door on the second runner (sec-check).
      const { dayKey } = await import('@/lib/dates')
      await db.from('company_metrics_daily').upsert(
        { company_id: companyId, day: dayKey(Date.now(), tz), metrics: {}, built_at: new Date().toISOString() },
        { onConflict: 'company_id,day' }
      )
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
  // UUID shape check up front: a malformed id should be a 400, not a
  // Postgres cast error surfacing as a 500.
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'valid id required' }, { status: 400 })
  }

  const [companyId, perms] = await Promise.all([getCurrentCompanyId(), getMyPermissions()])
  const { createServiceClient } = await import('@/lib/supabase-server')
  let q = createServiceClient()
    .from('insights')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId)
  // Dismissal is company-wide state: a role that can't SEE money rows must
  // not be able to silence them off the owner's surfaces (sec-check).
  if (!perms.canViewCosts) q = q.eq('money', false)
  const { error } = await q
  if (error) return NextResponse.json({ error: 'dismiss failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
