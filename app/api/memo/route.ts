import { NextResponse } from 'next/server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { ensureOwnerMemo } from '@/lib/memo'

export const dynamic = 'force-dynamic'
// Full function budget: the first production compose was killed at 120s
// mid-model-call, stranding a pending claim — give the deep read room.
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

// Demo-world numbers, all cross-checked against lib/projects.ts +
// lib/insights.ts DEMO_INSIGHTS: week machine cost $29,850 ($19,250
// Riverfront + $10,600 Maple St) × 4 weeks = $119,400 month ($77,000 /
// $42,400); Riverfront budget $260,000 with $181,000 spent → $79,000 left
// ≈ one month at the $77,000 pace. Receipts $464 / after-hours 3-vs-1
// match DEMO_INSIGHTS verbatim.
const DEMO_MEMO = `Riverfront Tower carried the month: $77,000 of the $119,400 in tracked machine cost, with Maple St Grading taking most of the rest. Working hours held steady around the fleet's normal pace, and the trucks kept their runs tight between the yard and the two active sites.

What's dragging: $464 in charges are still waiting on receipts, and after-hours movement ticked up to three events this week against your usual one. None of them turned into a loss — but that pattern is exactly how equipment walks off.

The lever for next month: Riverfront Tower is at $181,000 of its $260,000 budget — 70 cents of every budgeted dollar already spent — and at this month's $77,000 machine pace the remaining $79,000 is about one more month of runway, less once labor lands on top. If there's more than a month of work left out there, start the change-order conversation now, while it's still a conversation.`

async function requireCostUser(): Promise<{ ok: boolean; companyId?: string }> {
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    if (!user) return { ok: false }
  } catch { return { ok: false } }
  const [companyId, perms] = await Promise.all([getCurrentCompanyId(), getMyPermissions()])
  if (!perms.canViewCosts) return { ok: false }
  return { ok: true, companyId }
}

/** The current month's owner memo — generated on first view (lazy), so the
 *  page works the day the feature ships, not after the next month-boundary
 *  cron. Cost permission required: the memo is money end to end. */
export async function GET() {
  if (isMock) {
    return NextResponse.json({ memo: { month: new Date().toISOString().slice(0, 8) + '01', memo: DEMO_MEMO, composer: 'ai', updated_at: new Date().toISOString() } }, NO_STORE)
  }
  const auth = await requireCostUser()
  if (!auth.ok || !auth.companyId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: co } = await db.from('companies').select('name').eq('id', auth.companyId).limit(1)
  const memo = await ensureOwnerMemo(db, auth.companyId, co?.[0]?.name ?? 'Your company')
  // 'pending' = another runner is composing this very moment — tell the card
  // to keep its composing state and ask again, instead of hiding for 30 min.
  if (memo === 'pending') return NextResponse.json({ memo: null, pending: true }, NO_STORE)
  if (!memo) {
    // A null memo means a swallowed DB error somewhere in the ensure path.
    // Mirror that path step by step with the SAME month value and report
    // each step's PostgREST message to the (cost-gated, own-company)
    // caller — Vercel function logs aren't at hand when this bites.
    const { memoMonth } = await import('@/lib/memo')
    const { resolveDigestPrefs } = await import('@/lib/weekly-digest')
    const prefs = await db.from('companies').select('digest_prefs').eq('id', auth.companyId).limit(1)
    const tz = resolveDigestPrefs(prefs.data?.[0]?.digest_prefs).tz
    let month = 'THREW'
    try { month = memoMonth(tz) } catch (e) { month = `THREW:${String(e).slice(0, 120)}` }
    const read = await db.from('owner_memos')
      .select('month, composer, updated_at')
      .eq('company_id', auth.companyId).eq('month', month).limit(1)
    let claim: string = 'skipped'
    if (!read.error) {
      const probe = await db.from('owner_memos')
        .upsert(
          { company_id: auth.companyId, month, memo: '', composer: 'pending', updated_at: new Date(0).toISOString() },
          { onConflict: 'company_id,month', ignoreDuplicates: true }
        )
        .select('month')
      claim = probe.error ? probe.error.message : `ok:${probe.data?.length ?? 0}`
      await db.from('owner_memos').delete().eq('company_id', auth.companyId).eq('month', month).eq('composer', 'pending').eq('memo', '')
    }
    return NextResponse.json({
      memo: null,
      debug: { tz, month, read: read.error?.message ?? null, rows: read.data ?? [], claim },
    }, NO_STORE)
  }
  return NextResponse.json({ memo }, NO_STORE)
}

/** Regenerate this month's memo (owner pressed the button after the numbers
 *  moved). ensureOwnerMemo refuses to recompose a memo under 30 minutes old,
 *  so the button can't be mashed into API spend. */
export async function POST() {
  if (isMock) return NextResponse.json({ ok: true })
  const auth = await requireCostUser()
  if (!auth.ok || !auth.companyId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: co } = await db.from('companies').select('name').eq('id', auth.companyId).limit(1)
  const memo = await ensureOwnerMemo(db, auth.companyId, co?.[0]?.name ?? 'Your company', { regenerate: true })
  if (memo === 'pending') return NextResponse.json({ memo: null, pending: true }, NO_STORE)
  return NextResponse.json({ memo }, NO_STORE)
}
