import { NextResponse } from 'next/server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { ensureOwnerMemo } from '@/lib/memo'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
  return NextResponse.json({ memo }, NO_STORE)
}
