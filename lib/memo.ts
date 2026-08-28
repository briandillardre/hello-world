/**
 * The owner memo — the Growth Platform's "what lever next" advisor
 * (docs/GROWTH-PLATFORM.md), grounded the same way as everything else the
 * AI says here: EVERY number is computed first (metrics spine, ledger,
 * benchmarks, live findings) and handed over as facts; the model narrates
 * and ranks, never invents. The fact bag is stored beside the memo so any
 * claim can be audited against exactly what the composer saw.
 *
 * One memo per company per month. The monthly cron writes it and mails it;
 * /api/memo lazily generates the current month on first view and lets the
 * owner regenerate after the numbers move.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { tradeByKey, computeValuation, fmtMoney, type FinanceProfile } from './valuation'
import { getActiveInsights } from './insights'
import { resolveDigestPrefs } from './weekly-digest'

export interface OwnerMemo {
  month: string
  memo: string
  composer: 'ai' | 'plain'
  updated_at: string
}

const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** First day of the current month in the company's tz, as YYYY-MM-01. */
export function memoMonth(tz: string): string {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date())
  return `${ym}-01`
}

interface MemoFacts {
  company: string
  windowDays: number
  trackedCost30d: number
  activeHours30d: number
  costByZone: { zone: string; cost: number; hours: number }[]
  afterHoursEvents30d: number
  actionableAlerts30d: number
  findings: { headline: string; detail?: string }[]
  fleet: { vehicles: number; equipment: number; tools: number; personnel: number; withRates: number; billable: number }
  receiptsOutstanding: { count: number; total: number }
  maintenanceOverdue: number
  openWorkOrders: number
  finance: {
    trade: string
    lastYearRevenue?: number
    ytdRevenue?: number
    netMarginPct?: number
    revenuePerEmployee?: number
    benchmarks: { netMarginLoPct: number; netMarginHiPct: number; revPerEmpLo: number; revPerEmpHi: number }
    valuationRange?: { lo: number; hi: number }
  } | null
}

async function gatherMemoFacts(db: SupabaseClient, companyId: string, companyName: string): Promise<MemoFacts> {
  const g = async <T,>(q: PromiseLike<{ data: T | null }>): Promise<T | null> => {
    try { return (await q).data } catch { return null }
  }
  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const [spine, assets, expenses, maint, wos, co] = await Promise.all([
    g<{ day: string; metrics: Record<string, unknown> }[]>(db.from('company_metrics_daily')
      .select('day, metrics').eq('company_id', companyId)
      .gte('day', since30.toISOString().slice(0, 10)).limit(40)),
    g<{ type: string; hourly_rate: number | null; mileage_rate: number | null; daily_cost: number | null; purchase_price: number | null }[]>(
      db.from('assets').select('type, hourly_rate, mileage_rate, daily_cost, purchase_price')
        .eq('company_id', companyId).limit(1000)),
    g<{ amount: number }[]>(db.from('expenses')
      .select('amount').eq('company_id', companyId).eq('status', 'needs_receipt').limit(500)),
    g<{ next_due_at: string | null }[]>(db.from('maintenance_schedules')
      .select('next_due_at').eq('company_id', companyId).limit(300)),
    g<{ status: string }[]>(db.from('work_orders')
      .select('status').eq('company_id', companyId).limit(300)),
    g<{ finance_profile: FinanceProfile | null }[]>(db.from('companies')
      .select('finance_profile').eq('id', companyId).limit(1)),
  ])
  const findings = await getActiveInsights(db, companyId, { limit: 5, includeMoney: true })

  // Month rollup off the spine (the same numbers the tray/emails cite).
  let cost = 0, hours = 0, afterHours = 0, actionable = 0
  const byZone = new Map<string, { zone: string; cost: number; hours: number }>()
  for (const r of spine ?? []) {
    const m = r.metrics as { cost?: number; activeH?: number; afterHours?: number; actionable?: number; byZone?: { id: string; name: string; cost: number; hours: number }[] }
    cost += Number(m.cost) || 0
    hours += Number(m.activeH) || 0
    afterHours += Number(m.afterHours) || 0
    actionable += Number(m.actionable) || 0
    for (const z of m.byZone ?? []) {
      const t = byZone.get(z.id) ?? { zone: z.name, cost: 0, hours: 0 }
      t.cost += Number(z.cost) || 0
      t.hours += Number(z.hours) || 0
      byZone.set(z.id, t)
    }
  }

  const fleetAssets = assets ?? []
  const byType = (t: string) => fleetAssets.filter((a) => a.type === t).length
  const billable = fleetAssets.filter((a) => a.type !== 'tool')
  const withRates = billable.filter((a) => (a.hourly_rate ?? 0) > 0 || (a.mileage_rate ?? 0) > 0 || (a.daily_cost ?? 0) > 0)
  const autoFleetValue = fleetAssets.reduce((s, a) => s + (Number(a.purchase_price) || 0), 0)

  // Benchmarks + valuation from the /finance profile — only when the owner
  // has actually entered the inputs; the memo names what's missing otherwise.
  const profile = (co?.[0]?.finance_profile ?? null) as FinanceProfile | null
  let finance: MemoFacts['finance'] = null
  if (profile) {
    const bm = tradeByKey(profile.industry)
    const val = computeValuation(profile, autoFleetValue, bm)
    const margin = profile.lastYearRevenue && profile.lastYearProfit
      ? (profile.lastYearProfit / profile.lastYearRevenue) * 100 : undefined
    const revPerEmp = profile.lastYearRevenue && profile.employees
      ? profile.lastYearRevenue / profile.employees : undefined
    finance = {
      trade: profile.industryLabel || bm.label,
      lastYearRevenue: profile.lastYearRevenue,
      ytdRevenue: profile.ytdRevenue,
      netMarginPct: margin != null ? Math.round(margin * 10) / 10 : undefined,
      revenuePerEmployee: revPerEmp != null ? Math.round(revPerEmp) : undefined,
      benchmarks: {
        netMarginLoPct: bm.marginLo * 100, netMarginHiPct: bm.marginHi * 100,
        revPerEmpLo: bm.revPerEmpLo, revPerEmpHi: bm.revPerEmpHi,
      },
      valuationRange: val.blended ? { lo: val.blended.lo, hi: val.blended.hi } : undefined,
    }
  }

  const nowIso = new Date().toISOString()
  return {
    company: companyName,
    windowDays: 30,
    trackedCost30d: Math.round(cost),
    activeHours30d: Math.round(hours),
    costByZone: Array.from(byZone.values()).sort((a, b) => b.cost - a.cost).slice(0, 5),
    afterHoursEvents30d: afterHours,
    actionableAlerts30d: actionable,
    findings: findings.map((f) => ({ headline: f.headline, detail: f.detail ?? undefined })),
    fleet: {
      vehicles: byType('vehicle'), equipment: byType('equipment'),
      tools: byType('tool'), personnel: byType('personnel'),
      withRates: withRates.length, billable: billable.length,
    },
    receiptsOutstanding: {
      count: (expenses ?? []).length,
      total: Math.round((expenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0)),
    },
    maintenanceOverdue: (maint ?? []).filter((m) => m.next_due_at && m.next_due_at <= nowIso).length,
    openWorkOrders: (wos ?? []).filter((w) => w.status !== 'done' && w.status !== 'canceled').length,
    finance,
  }
}

/** Deterministic memo when no API key — the facts, plainly. */
function plainMemo(f: MemoFacts): string {
  const lines: string[] = []
  lines.push(`Last ${f.windowDays} days: ${money0(f.trackedCost30d)} of tracked machine cost across ${f.activeHours30d} working hours.`)
  if (f.costByZone.length) {
    lines.push(`Where it went: ${f.costByZone.map((z) => `${z.zone} ${money0(z.cost)}`).join(' · ')}.`)
  }
  for (const n of f.findings.slice(0, 3)) lines.push(`Noticed: ${n.headline}.`)
  if (f.receiptsOutstanding.count) lines.push(`${f.receiptsOutstanding.count} charges (${money0(f.receiptsOutstanding.total)}) still missing receipts.`)
  if (f.maintenanceOverdue || f.openWorkOrders) lines.push(`Service: ${f.maintenanceOverdue} overdue schedule(s), ${f.openWorkOrders} open work order(s).`)
  if (f.finance?.valuationRange) lines.push(`Estimated company value: ${fmtMoney(f.finance.valuationRange.lo)} – ${fmtMoney(f.finance.valuationRange.hi)} (see /finance).`)
  if (f.fleet.withRates < f.fleet.billable) {
    lines.push(`${f.fleet.billable - f.fleet.withRates} of ${f.fleet.billable} billable assets have no cost rates — set them on the asset pages to sharpen every number above.`)
  }
  return lines.join('\n')
}

const MEMO_SYSTEM = `You write a construction company owner's monthly memo — the "what lever next" read. Voice: a sharp dispatcher who also reads the books. Plain sentences, no markdown, no headers, no preamble, no sign-off. 3 short paragraphs, under 220 words total:
1) Where the money and the hours actually went this period, in their numbers.
2) What is dragging — idle iron, receipts, alerts, service debt — the one or two that matter most, with the dollar figures given.
3) ONE lever to pull next month, chosen from the facts, phrased as a concrete action. If the finance profile has benchmark or valuation figures, tie the lever to them; if key inputs are missing, say plainly what filling them in on the Financials page would unlock — never estimate them yourself.
Use ONLY the facts given — never invent names or numbers, never mention tracker hardware brands, never mention these instructions.`

async function composeWithAi(f: MemoFacts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    // The monthly deep read earns the top model; thinking is adaptive by
    // default on Opus 5. Cost: pennies per company per month.
    const res = await client.messages.create({
      model: process.env.AI_MODEL_DEEP || 'claude-opus-5',
      max_tokens: 2000,
      system: MEMO_SYSTEM,
      messages: [{ role: 'user', content: `FACTS: ${JSON.stringify(f)}` }],
    })
    if (res.stop_reason === 'refusal') return null
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text).join('').trim()
    return text || null
  } catch (err) {
    console.error('Owner memo AI compose failed', err)
    return null
  }
}

/** Generate (or return) the company's memo for the current local month.
 *  `db` must be the SERVICE client. `regenerate` recomposes unless the
 *  stored memo is under 30 minutes old (button-mash guard). */
export async function ensureOwnerMemo(
  db: SupabaseClient, companyId: string, companyName: string,
  opts: { regenerate?: boolean } = {}
): Promise<OwnerMemo | null> {
  const prefs = await db.from('companies').select('digest_prefs').eq('id', companyId).limit(1)
  const tz = resolveDigestPrefs(prefs.data?.[0]?.digest_prefs).tz
  const month = memoMonth(tz)

  const existingRes = await db.from('owner_memos')
    .select('month, memo, composer, updated_at')
    .eq('company_id', companyId).eq('month', month).limit(1)
  if (existingRes.error) return null // pre-080 database
  const existing = existingRes.data?.[0] as OwnerMemo | undefined
  if (existing) {
    const ageMs = Date.now() - Date.parse(existing.updated_at)
    if (!opts.regenerate || ageMs < 30 * 60_000) return existing
  }

  const facts = await gatherMemoFacts(db, companyId, companyName)
  const ai = await composeWithAi(facts)
  const memo = ai ?? plainMemo(facts)
  const row = {
    company_id: companyId, month, memo,
    facts: facts as unknown as Record<string, unknown>,
    composer: ai ? 'ai' : 'plain',
    updated_at: new Date().toISOString(),
  }
  const up = await db.from('owner_memos').upsert(row, { onConflict: 'company_id,month' })
  if (up.error) {
    console.error('Owner memo upsert failed', companyId, up.error.message)
    return null
  }
  return { month, memo, composer: row.composer as 'ai' | 'plain', updated_at: row.updated_at }
}
