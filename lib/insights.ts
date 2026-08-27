/**
 * The insights engine — the AI that watches so nobody has to know what to ask
 * (Brian, Aug 27: "these guys won't know what to ask it").
 *
 * Three moving parts, all deterministic:
 *   1. A daily METRICS SPINE (company_metrics_daily): each local day's tracked
 *      cost, hours, per-zone splits and alert counts, rolled up from tables
 *      that already exist (usage_daily is the money ledger). Rebuilt for the
 *      whole 35-day window on every run, so trend baselines exist from the
 *      FIRST run — no month of warm-up before the product gets smart.
 *   2. DETECTORS: pure functions over the spine + live state that emit typed
 *      findings with the evidence numbers and a deep link. Rules find the
 *      facts; no model ever invents a number (same contract as the digests).
 *   3. SUPPRESSION: one live row per story (company_id+fingerprint unique).
 *      A story re-asserts only when its magnitude moves ±20%; a dismissed
 *      story stays dismissed until it grows 1.5×. Anti-cry-wolf lives in the
 *      engine, not in every surface's good intentions.
 *
 * Surfaces cap what they show (tray ≤2 rows sev≥2, emails ≤3, chips ≤3) —
 * the wow is the product noticing, not a wall of findings.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { usageFromLedger } from './costs'
import { dayKey } from './dates'

export type InsightDetector =
  | 'burn_pace' | 'cost_spike' | 'cost_concentration'
  | 'after_hours_trend' | 'idle_money' | 'receipts_gap'

export interface InsightRow {
  id: string
  detector: InsightDetector
  severity: 1 | 2 | 3
  headline: string
  detail: string | null
  link: string | null
  money: boolean
  fired_at: string
  evidence: Record<string, unknown>
}

interface Candidate {
  detector: InsightDetector
  /** detector:subject — the story's identity across runs. */
  fingerprint: string
  severity: 1 | 2 | 3
  headline: string
  detail?: string
  link?: string
  money: boolean
  /** Suppression scalar: re-fires only when this moves ±20%. */
  magnitude: number
  evidence: Record<string, unknown>
}

const WINDOW_DAYS = 35
/** A story the engine stops re-asserting goes quiet after this cushion
 *  (covers a missed cron day without letting stale stories linger). */
const EXPIRES_DAYS = 3
const REFIRE_MOVE = 0.2
const UNDISMISS_GROWTH = 1.5

const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** Local-day keys for the last n days, oldest first (index n-1 = today). */
function dayKeys(tz: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * 86_400_000, tz))
  return out
}

type LedgerRow = { geofence_id: string; asset_id: string; day: string; on_site_secs: number; active_secs: number }
type AssetRow = {
  id: string; name: string; type: string; active: boolean | null; created_at: string | null
  hourly_rate: number | null; mileage_rate: number | null; daily_cost: number | null
  tracker_id: string | null
}
type ZoneRow = { id: string; name: string; kind: string | null; budget: number | null; completed_at: string | null }
// Supabase's builder types a many-to-one join as an array even though the
// runtime returns an object — accept both and normalize at the read.
type RuleSlim = { trigger?: string | null }
type AlertRowSlim = { kind: string | null; triggered_at: string; rule: RuleSlim | RuleSlim[] | null }
const ruleOf = (a: AlertRowSlim): RuleSlim | null => (Array.isArray(a.rule) ? a.rule[0] ?? null : a.rule)

interface DayMetrics {
  cost: number
  activeH: number
  presentH: number
  byZone: { id: string; name: string; cost: number; hours: number }[]
  afterHours: number
  actionable: number
}

/** Price one bag of ledger rows with the house function (same math as the
 *  zone pages and the map's burn chips — surfaces must never disagree). */
function price(rows: LedgerRow[], assets: AssetRow[]): { cost: number; activeH: number; presentH: number } {
  const usage = usageFromLedger(rows, assets as unknown as Parameters<typeof usageFromLedger>[1])
  return {
    cost: usage.reduce((s, u) => s + u.amount, 0),
    activeH: usage.reduce((s, u) => s + u.activeHours, 0),
    presentH: usage.reduce((s, u) => s + u.presentHours, 0),
  }
}

/** Everything the detectors need, fetched once, every query bounded and
 *  tolerant of tables a customer's migration level may not have yet. */
async function gather(db: SupabaseClient, companyId: string, tz: string) {
  const g = async <T,>(q: PromiseLike<{ data: T | null }>): Promise<T | null> => {
    try { return (await q).data } catch { return null }
  }
  const days = dayKeys(tz, WINDOW_DAYS)
  const [assets, zones, ledger, alerts, expenses] = await Promise.all([
    g<AssetRow[]>(db.from('assets')
      .select('id, name, type, active, created_at, hourly_rate, mileage_rate, daily_cost, tracker_id')
      .eq('company_id', companyId).limit(1000)),
    g<ZoneRow[]>(db.from('geofences')
      .select('id, name, kind, budget, completed_at')
      .eq('company_id', companyId).is('owner_id', null).limit(500)),
    // The whole company ledger — a year of asset-days is a few thousand tiny
    // rows (same read + cap as /api/zone-burn). All-time feeds burn-vs-budget;
    // the 35-day slice feeds the daily spine.
    g<LedgerRow[]>(db.from('usage_daily')
      .select('geofence_id, asset_id, day, on_site_secs, active_secs')
      .eq('company_id', companyId).limit(50_000)),
    g<AlertRowSlim[]>(db.from('alert_events')
      .select('kind, triggered_at, rule:alert_rules(trigger)')
      .eq('company_id', companyId).gte('triggered_at', new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString())
      .limit(2000)),
    g<{ amount: number; txn_date: string }[]>(db.from('expenses')
      .select('amount, txn_date')
      .eq('company_id', companyId).eq('status', 'needs_receipt').limit(500)),
  ])
  return { days, assets: assets ?? [], zones: zones ?? [], ledger: ledger ?? [], alerts: alerts ?? [], expenses: expenses ?? [] }
}

/** Per-local-day metrics for the whole window, derived from one ledger read. */
function buildSpine(data: Awaited<ReturnType<typeof gather>>, tz: string): Map<string, DayMetrics> {
  const { days, assets, zones, ledger, alerts } = data
  const daySet = new Set(days)
  const zoneName = new Map(zones.map((z) => [z.id, z.name]))
  const byDay = new Map<string, LedgerRow[]>()
  for (const r of ledger) {
    if (!daySet.has(r.day)) continue
    const rows = byDay.get(r.day)
    if (rows) rows.push(r)
    else byDay.set(r.day, [r])
  }
  const alertsByDay = new Map<string, { afterHours: number; actionable: number }>()
  for (const a of alerts) {
    const k = dayKey(Date.parse(a.triggered_at), tz)
    const b = alertsByDay.get(k) ?? { afterHours: 0, actionable: 0 }
    const trigger = ruleOf(a)?.trigger ?? null
    const zoneLog = !a.kind && (trigger === 'enter' || trigger === 'exit')
    if (!zoneLog) b.actionable++
    if (trigger === 'after_hours_movement') b.afterHours++
    alertsByDay.set(k, b)
  }
  const spine = new Map<string, DayMetrics>()
  for (const d of days) {
    const rows = byDay.get(d) ?? []
    const totals = price(rows, assets)
    const byZoneRows = new Map<string, LedgerRow[]>()
    for (const r of rows) {
      const zr = byZoneRows.get(r.geofence_id)
      if (zr) zr.push(r)
      else byZoneRows.set(r.geofence_id, [r])
    }
    const byZone = Array.from(byZoneRows.entries())
      .map(([id, zr]) => {
        const p = price(zr, assets)
        return { id, name: zoneName.get(id) ?? 'zone', cost: Math.round(p.cost), hours: Math.round(p.activeH * 10) / 10 }
      })
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)
    const al = alertsByDay.get(d) ?? { afterHours: 0, actionable: 0 }
    spine.set(d, {
      cost: Math.round(totals.cost),
      activeH: Math.round(totals.activeH * 10) / 10,
      presentH: Math.round(totals.presentH * 10) / 10,
      byZone,
      afterHours: al.afterHours,
      actionable: al.actionable,
    })
  }
  return spine
}

function detect(data: Awaited<ReturnType<typeof gather>>, spine: Map<string, DayMetrics>): Candidate[] {
  const { days, assets, zones, ledger, expenses } = data
  const out: Candidate[] = []
  const last7 = days.slice(-7)
  const prior28 = days.slice(0, WINDOW_DAYS - 7)

  // ── burn_pace: a budgeted site at ≥80% of its budget ──
  const budgeted = zones.filter((z) => (z.kind ?? 'site') === 'site' && !z.completed_at && Number(z.budget) > 0)
  if (budgeted.length) {
    const byZone = new Map<string, LedgerRow[]>()
    for (const r of ledger) {
      const zr = byZone.get(r.geofence_id)
      if (zr) zr.push(r)
      else byZone.set(r.geofence_id, [r])
    }
    for (const z of budgeted) {
      const spent = price(byZone.get(z.id) ?? [], assets).cost
      const budget = Number(z.budget)
      const pct = Math.round((spent / budget) * 100)
      if (pct < 80) continue
      out.push({
        detector: 'burn_pace',
        fingerprint: `burn_pace:${z.id}`,
        severity: pct >= 100 ? 3 : 2,
        headline: pct >= 100
          ? `${z.name} is OVER budget — ${money0(spent)} tracked against ${money0(budget)}`
          : `${z.name} is at ${pct}% of its ${money0(budget)} budget`,
        detail: `${money0(spent)} of tracked machine time has accrued against this site's ${money0(budget)} budget.`,
        link: `/zones/${z.id}`,
        money: true,
        magnitude: pct,
        evidence: { zone: z.name, spent: Math.round(spent), budget, pct },
      })
    }
  }

  // ── cost_spike: this week is running well over the recent weekly normal ──
  const sum = (ks: string[]) => ks.reduce((s, k) => s + (spine.get(k)?.cost ?? 0), 0)
  const week = sum(last7)
  const priorDaysWithData = prior28.filter((k) => (spine.get(k)?.cost ?? 0) > 0).length
  const base = sum(prior28) / 4
  if (priorDaysWithData >= 7 && base >= 100 && week >= base * 1.4 && week - base >= 250) {
    const zoneTotals = new Map<string, { name: string; cost: number }>()
    for (const k of last7) {
      for (const z of spine.get(k)?.byZone ?? []) {
        const t = zoneTotals.get(z.id) ?? { name: z.name, cost: 0 }
        t.cost += z.cost
        zoneTotals.set(z.id, t)
      }
    }
    const driver = Array.from(zoneTotals.values()).sort((a, b) => b.cost - a.cost)[0]
    const pctOver = Math.round(((week - base) / base) * 100)
    out.push({
      detector: 'cost_spike',
      fingerprint: 'cost_spike:week',
      severity: 2,
      headline: `Tracked cost is running ${money0(week)} this week — ${pctOver}% over your ~${money0(base)}/wk normal`,
      detail: driver ? `Biggest driver: ${driver.name} (${money0(driver.cost)} this week).` : undefined,
      link: '/reports',
      money: true,
      magnitude: week,
      evidence: { week: Math.round(week), baseline: Math.round(base), pctOver, driver: driver?.name ?? null },
    })
  }

  // ── cost_concentration: one site is eating the week ──
  {
    const zoneTotals = new Map<string, { id: string; name: string; cost: number }>()
    for (const k of last7) {
      for (const z of spine.get(k)?.byZone ?? []) {
        const t = zoneTotals.get(z.id) ?? { id: z.id, name: z.name, cost: 0 }
        t.cost += z.cost
        zoneTotals.set(z.id, t)
      }
    }
    const active = Array.from(zoneTotals.values()).filter((z) => z.cost > 0).sort((a, b) => b.cost - a.cost)
    const total = active.reduce((s, z) => s + z.cost, 0)
    if (active.length >= 2 && total >= 300) {
      const top = active[0]
      const share = Math.round((top.cost / total) * 100)
      if (share >= 60) {
        out.push({
          detector: 'cost_concentration',
          fingerprint: `cost_concentration:${top.id}`,
          severity: 1,
          headline: `${top.name} took ${money0(top.cost)} — ${share}% of this week's tracked cost`,
          detail: `${active.length} sites saw machine time this week; ${money0(total)} total tracked.`,
          link: `/zones/${top.id}`,
          money: true,
          magnitude: share,
          evidence: { zone: top.name, cost: top.cost, share, weekTotal: total },
        })
      }
    }
  }

  // ── after_hours_trend: this week's after-hours movement vs normal ──
  {
    const cnt = (ks: string[]) => ks.reduce((s, k) => s + (spine.get(k)?.afterHours ?? 0), 0)
    const week7 = cnt(last7)
    const baseWk = cnt(prior28) / 4
    if (week7 >= 3 && week7 >= 2 * Math.max(baseWk, 0.5)) {
      out.push({
        detector: 'after_hours_trend',
        fingerprint: 'after_hours_trend:week',
        severity: 2,
        headline: `After-hours movement is up — ${week7} events this week vs ~${Math.round(baseWk * 10) / 10}/wk normal`,
        detail: 'Worth a look even if each one had a reason: patterns are how equipment walks off.',
        link: '/alerts',
        money: false,
        magnitude: week7,
        evidence: { week: week7, baselinePerWeek: Math.round(baseWk * 10) / 10 },
      })
    }
  }

  // ── idle_money: equipment with ownership cost that hasn't worked in a week ──
  {
    const todayK = days[days.length - 1]
    const lastActive = new Map<string, string>()
    for (const r of ledger) {
      if (r.active_secs < 600) continue
      const prev = lastActive.get(r.asset_id)
      if (!prev || r.day > prev) lastActive.set(r.asset_id, r.day)
    }
    for (const a of assets) {
      if (a.type !== 'equipment' || a.active === false || !(Number(a.daily_cost) > 0)) continue
      // Brand-new assets haven't had a chance to work yet — not an insight.
      if (a.created_at && Date.now() - Date.parse(a.created_at) < 10 * 86_400_000) continue
      const last = lastActive.get(a.id) ?? null
      const idleDays = last
        ? Math.max(0, Math.round((Date.parse(todayK) - Date.parse(last)) / 86_400_000))
        : WINDOW_DAYS
      if (idleDays < 7) continue
      const burn = idleDays * Number(a.daily_cost)
      out.push({
        detector: 'idle_money',
        fingerprint: `idle_money:${a.id}`,
        severity: idleDays >= 14 ? 3 : 2,
        headline: `${a.name} hasn't worked in ${idleDays >= WINDOW_DAYS ? `${WINDOW_DAYS}+` : idleDays} days — ~${money0(burn)} of ownership burned`,
        detail: `Ownership accrues at ${money0(Number(a.daily_cost))}/day whether it works or sits. Put it on a job or park the cost.`,
        link: `/assets/${a.id}`,
        money: true,
        magnitude: burn,
        evidence: { asset: a.name, idleDays, dailyCost: Number(a.daily_cost), burn: Math.round(burn) },
      })
    }
  }

  // ── receipts_gap: missing-receipt pile worth chasing ──
  {
    const count = expenses.length
    const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    if (count >= 5 || total >= 400) {
      const oldest = expenses.reduce<string | null>((m, e) => (!m || e.txn_date < m ? e.txn_date : m), null)
      const oldestDays = oldest ? Math.max(0, Math.round((Date.now() - Date.parse(oldest)) / 86_400_000)) : 0
      out.push({
        detector: 'receipts_gap',
        fingerprint: 'receipts_gap:pile',
        severity: total >= 1000 ? 2 : 1,
        headline: `${count} charge${count === 1 ? '' : 's'} · ${money0(total)} missing receipts${oldestDays ? ` — oldest ${oldestDays}d` : ''}`,
        detail: 'Every one of these is a deduction waiting on a photo.',
        link: '/receipts',
        money: true,
        magnitude: total || count,
        evidence: { count, total: Math.round(total), oldestDays },
      })
    }
  }

  return out
}

/** Run the whole engine for one company: rebuild the metrics spine, run the
 *  detectors, and reconcile the insights table under the suppression rules.
 *  `db` must be the SERVICE client (writes bypass the read-only RLS). */
export async function runInsightsEngine(db: SupabaseClient, companyId: string, tz: string): Promise<{ fired: number }> {
  const data = await gather(db, companyId, tz)
  const spine = buildSpine(data, tz)

  // Persist the spine — the whole window, idempotent. History exists from
  // the first run because usage_daily already holds it.
  const spineRows = data.days.map((day) => ({
    company_id: companyId,
    day,
    metrics: spine.get(day) ?? {},
    built_at: new Date().toISOString(),
  }))
  try {
    await db.from('company_metrics_daily').upsert(spineRows, { onConflict: 'company_id,day' })
  } catch { /* pre-079 database — detectors still run off the in-memory spine */ }

  const candidates = detect(data, spine)
  let existing: { id: string; fingerprint: string; dismissed_at: string | null; evidence: Record<string, unknown> }[] = []
  try {
    const { data: rows } = await db.from('insights')
      .select('id, fingerprint, dismissed_at, evidence')
      .eq('company_id', companyId).limit(200)
    existing = (rows ?? []) as typeof existing
  } catch { return { fired: 0 } /* pre-079 database */ }
  const byFp = new Map(existing.map((r) => [r.fingerprint, r]))

  const expiresAt = new Date(Date.now() + EXPIRES_DAYS * 86_400_000).toISOString()
  for (const c of candidates) {
    const prev = byFp.get(c.fingerprint)
    const base = {
      detector: c.detector, severity: c.severity, headline: c.headline,
      detail: c.detail ?? null, link: c.link ?? null, money: c.money,
      evidence: { ...c.evidence, magnitude: c.magnitude }, expires_at: expiresAt,
    }
    try {
      if (!prev) {
        await db.from('insights').insert({ company_id: companyId, fingerprint: c.fingerprint, ...base, fired_at: new Date().toISOString() })
        continue
      }
      const prevMag = Number(prev.evidence?.magnitude) || 0
      const moved = prevMag === 0 ? true : Math.abs(c.magnitude - prevMag) / Math.abs(prevMag) >= REFIRE_MOVE
      if (prev.dismissed_at) {
        // Dismissed stories stay quiet unless they GROW past the shrug —
        // creeping ±20% wobble must not resurrect what the owner waved off.
        if (c.magnitude >= prevMag * UNDISMISS_GROWTH) {
          await db.from('insights').update({ ...base, dismissed_at: null, fired_at: new Date().toISOString() }).eq('id', prev.id)
        }
        continue
      }
      if (moved) {
        await db.from('insights').update({ ...base, fired_at: new Date().toISOString() }).eq('id', prev.id)
      } else {
        // Story still true, magnitude steady: stay visible at the old
        // fired_at (no fake freshness), just keep it from expiring.
        await db.from('insights').update({ expires_at: expiresAt }).eq('id', prev.id)
      }
    } catch { /* row-level failure — never kill the whole run */ }
  }
  return { fired: candidates.length }
}

/** Active insights for display, newest-severity first. Money rows are
 *  stripped for non-cost roles — same wire rule as costToday. */
export async function getActiveInsights(
  db: SupabaseClient, companyId: string,
  opts: { limit?: number; includeMoney: boolean }
): Promise<InsightRow[]> {
  try {
    const { data } = await db.from('insights')
      .select('id, detector, severity, headline, detail, link, money, fired_at, evidence')
      .eq('company_id', companyId)
      .is('dismissed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('severity', { ascending: false })
      .order('fired_at', { ascending: false })
      .limit(50)
    return ((data ?? []) as InsightRow[])
      .filter((r) => opts.includeMoney || !r.money)
      .slice(0, opts.limit ?? 10)
  } catch {
    return [] /* pre-079 database */
  }
}

/** Top insight headlines for the owner digests/briefing — plain strings the
 *  email composers list as facts (the email AI narrates, never invents).
 *  Owner emails include money rows; caps at 3 so a busy week can't flood
 *  the morning read. */
export async function getInsightHeadlines(db: SupabaseClient, companyId: string, limit = 3): Promise<string[]> {
  const rows = await getActiveInsights(db, companyId, { limit, includeMoney: true })
  return rows.map((r) => r.headline)
}

/** Demo mode's canned findings — numbers cross-checked against the mock
 *  world so the "product noticing things" claims agree with the screens
 *  next to them (truth-check): concentration math from PROJECTS'
 *  equipCostPerDay (19,250 + 10,600 over a 5-day week), receipts from the
 *  demo /receipts pile (3 charges / $464 / oldest 2d), after-hours from the
 *  demo's theft-alert story. Detector thresholds hold for each. */
export const DEMO_INSIGHTS: InsightRow[] = [
  {
    id: 'demo-1', detector: 'cost_concentration', severity: 2, money: true,
    headline: 'Riverfront Tower took $19,250 — 64% of this week\'s tracked machine cost',
    detail: '2 sites saw machine time this week; $29,850 total tracked.',
    link: '/zones', fired_at: new Date().toISOString(),
    evidence: { zone: 'Riverfront Tower', cost: 19250, share: 64, weekTotal: 29850 },
  },
  {
    id: 'demo-2', detector: 'after_hours_trend', severity: 2, money: false,
    headline: 'After-hours movement is up — 3 events this week vs ~1/wk normal',
    detail: 'Worth a look even if each one had a reason: patterns are how equipment walks off.',
    link: '/alerts', fired_at: new Date().toISOString(),
    evidence: { week: 3, baselinePerWeek: 1 },
  },
  {
    id: 'demo-3', detector: 'receipts_gap', severity: 1, money: true,
    headline: '3 charges · $464 missing receipts — oldest 2d',
    detail: 'Every one of these is a deduction waiting on a photo.',
    link: '/receipts', fired_at: new Date().toISOString(),
    evidence: { count: 3, total: 464, oldestDays: 2 },
  },
]

/** The tap-to-ask question each insight suggests — every one lands on a
 *  question the assistant answers well (grounded intent or agent tools). */
export function insightQuestion(row: Pick<InsightRow, 'detector' | 'evidence'>): string {
  switch (row.detector) {
    case 'burn_pace': return `How is ${String(row.evidence?.zone ?? 'that site')} doing against its budget?`
    case 'cost_spike': return 'Why is this week running over our normal cost?'
    case 'cost_concentration': return 'Where did this week\'s money go?'
    case 'after_hours_trend': return 'What moved after hours this week?'
    case 'idle_money': return `Which machines are sitting idle?`
    case 'receipts_gap': return 'Which receipts are we missing?'
  }
}
