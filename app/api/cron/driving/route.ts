import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Stop starting new vehicle-days past this (the function has 300 s). */
const BUDGET_MS = 220_000
/** How far back the backfill reaches, and how many days it asks for per company per run. */
const BACKFILL_DAYS = 90
const BACKFILL_PER_COMPANY = 80
/** Watermark: when the last run started (rows created since then are new). */
const STATE_KEY = 'driving.since'

/**
 * Hourly driver-safety builder (migration 129, lib/db/driving.ts) — road
 * vehicles with a hardware tracker only (Safety Score v1). Per run:
 *  1. CHANGED days — every vehicle-day that received fixes since the last
 *     run (today as it fills in; a unit that buffered offline uploads into
 *     its real days), plus yesterday for any truck whose yesterday was last
 *     built before the day ended. Each day is rebuilt whole and idempotently.
 *  2. BACKFILL — older days (≤ 90) with fixes but no row at the current
 *     engine version, oldest first, until the time budget runs out. A first
 *     deploy catches up over a few hours of runs; a math change (a new
 *     ENGINE_VERSION) re-banks history the same way. Nothing runs at deploy.
 *  3. ADDRESSES — the new events' spots go through the geocode cache so the
 *     pages can say "near 123 Main St" without a network call.
 * Fails closed on CRON_SECRET, like every service-role cron.
 */
export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo' })
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  const runStart = new Date(started).toISOString()
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { readState, writeState } = await import('@/lib/system-state')
  const { resolveDigestPrefs } = await import('@/lib/weekly-digest')
  const { buildVehicleDay, classOfAsset, daysBetween, isScoredAsset, loadCompanyCtx } = await import('@/lib/db/driving')
  const { ENGINE_VERSION } = await import('@/lib/driving-score')
  const { addDaysKey, dayKey, safeTz, zonedMidnightMs } = await import('@/lib/dates')
  const db = createServiceClient()

  const { data: assetRows, error } = await db.from('assets').select('id, company_id, type, tracker_id, metadata')
    .eq('active', true).eq('type', 'vehicle').limit(5000)
  if (error) return NextResponse.json({ ok: false, error: 'assets read failed' }, { status: 500 })
  const assets = ((assetRows ?? []) as { id: string; company_id: string; type: string; tracker_id: string | null; metadata: Record<string, unknown> | null }[]).filter(isScoredAsset)
  if (!assets.length) return NextResponse.json({ ok: true, vehicles: 0 })
  const companyOf = new Map(assets.map((a) => [a.id, a.company_id]))
  // Light or medium/heavy decides the harsh-event thresholds (GVWR, else the map icon).
  const classOf = new Map(assets.map((a) => [a.id, classOfAsset(a)]))
  const companyIds = Array.from(new Set(assets.map((a) => a.company_id)))
  const { data: cos } = await db.from('companies').select('id, digest_prefs').in('id', companyIds)
  const tzOf = new Map<string, string>(companyIds.map((id) => [id, 'America/New_York']))
  for (const c of (cos ?? []) as { id: string; digest_prefs: unknown }[]) tzOf.set(c.id, safeTz(resolveDigestPrefs(c.digest_prefs).tz))

  type Ctx = Awaited<ReturnType<typeof loadCompanyCtx>>
  const ctxs = new Map<string, Ctx>()
  const ctxFor = async (companyId: string): Promise<Ctx> => {
    let c = ctxs.get(companyId)
    if (!c) {
      const tz = tzOf.get(companyId) ?? 'America/New_York'
      c = await loadCompanyCtx(db, companyId, tz, dayKey(Date.now(), tz))
      ctxs.set(companyId, c)
    }
    return c
  }

  // ── 1. Changed days ───────────────────────────────────────────────────────
  const stored = await readState<{ at?: string }>(db, STATE_KEY)
  const sinceMs = stored?.at && Number.isFinite(Date.parse(stored.at)) ? Date.parse(stored.at) - 5 * 60_000 : started - 2 * 86_400_000
  const tasks = new Map<string, { assetId: string; companyId: string; day: string }>()
  const add = (assetId: string, day: string) => {
    const companyId = companyOf.get(assetId)
    if (companyId) tasks.set(`${assetId}|${day}`, { assetId, companyId, day })
  }
  const { data: dirty, error: dirtyErr } = await db.rpc('driving_dirty', { p_since: new Date(sinceMs).toISOString(), p_assets: assets.map((a) => a.id) })
  if (dirtyErr) return NextResponse.json({ ok: false, error: 'driving_dirty failed — is migration 129 applied?' }, { status: 500 })
  for (const d of (dirty ?? []) as { asset_id: string; min_ts: string; max_ts: string }[]) {
    const tz = tzOf.get(companyOf.get(d.asset_id) ?? '') ?? 'America/New_York'
    for (const day of daysBetween(Date.parse(d.min_ts), Date.parse(d.max_ts), tz)) add(d.asset_id, day)
  }
  // Yesterday, for any truck whose yesterday was last built before the day ended.
  const yKeys = new Map<string, string>(companyIds.map((id) => [id, addDaysKey(dayKey(started, tzOf.get(id) ?? 'America/New_York'), -1)]))
  const { data: yRows } = await db.from('driving_daily').select('asset_id, day, updated_at')
    .in('asset_id', assets.map((a) => a.id)).in('day', Array.from(new Set(yKeys.values())))
  const yBuilt = new Map(((yRows ?? []) as { asset_id: string; day: string; updated_at: string }[]).map((r) => [`${r.asset_id}|${r.day}`, Date.parse(r.updated_at)]))
  for (const a of assets) {
    const y = yKeys.get(a.company_id)
    if (!y) continue
    const builtAt = yBuilt.get(`${a.id}|${y}`)
    const endedAt = zonedMidnightMs(addDaysKey(y, 1), tzOf.get(a.company_id) ?? 'America/New_York') + 15 * 60_000
    // No row yet is the backfill's job when the day had fixes; a stale one is rebuilt here.
    if (builtAt != null && builtAt < endedAt) add(a.id, y)
  }

  let built = 0, skipped = 0, failed = 0, pending = 0
  const spots: { lat: number; lng: number }[] = []
  const errors: string[] = []
  const run = async (t: { assetId: string; companyId: string; day: string }) => {
    const r = await buildVehicleDay(db, await ctxFor(t.companyId), t.assetId, t.day, classOf.get(t.assetId) ?? 'light')
    if (!r.ok) { failed++; if (errors.length < 5 && r.error) errors.push(r.error); return }
    if (!r.wrote) { skipped++; return }
    built++
    for (const e of r.events) if (spots.length < 200) spots.push({ lat: e.lat, lng: e.lng })
  }
  // Newest first: today's numbers are what people are looking at.
  for (const t of Array.from(tasks.values()).sort((a, b) => b.day.localeCompare(a.day))) {
    if (Date.now() - started > BUDGET_MS) { pending++; continue }
    try { await run(t) } catch (err) { failed++; if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err)) }
  }
  // The watermark moves only when every changed day was handled — otherwise
  // the next run sees the same rows as new again.
  if (!pending && !failed) await writeState(db, STATE_KEY, { at: runStart })

  // ── 2. Backfill ───────────────────────────────────────────────────────────
  let backfilled = 0
  for (const companyId of companyIds) {
    if (Date.now() - started > BUDGET_MS) break
    const tz = tzOf.get(companyId) ?? 'America/New_York'
    const today = dayKey(started, tz)
    const { data: todo, error: todoErr } = await db.rpc('driving_backfill_todo', {
      p_assets: assets.filter((a) => a.company_id === companyId).map((a) => a.id),
      p_from: addDaysKey(today, -BACKFILL_DAYS), p_to: addDaysKey(today, -1), p_tz: tz,
      p_version: ENGINE_VERSION, p_limit: BACKFILL_PER_COMPANY,
    })
    if (todoErr) { if (errors.length < 5) errors.push(todoErr.message); continue }
    for (const t of (todo ?? []) as { asset_id: string; day: string }[]) {
      if (Date.now() - started > BUDGET_MS) break
      if (tasks.has(`${t.asset_id}|${t.day}`)) continue
      try {
        const before = built
        await run({ assetId: t.asset_id, companyId, day: t.day })
        if (built > before) backfilled++
      } catch (err) { failed++; if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err)) }
    }
  }

  // ── 3. Addresses for the new events ───────────────────────────────────────
  let named = 0
  if (spots.length && Date.now() - started < BUDGET_MS + 30_000) {
    try {
      const { resolvePlaces } = await import('@/lib/reverse-geocode')
      const got = await resolvePlaces(spots, 15)
      named = Object.values(got).filter(Boolean).length
    } catch { /* addresses are garnish */ }
  }

  return NextResponse.json({
    ok: failed === 0, vehicles: assets.length, changedDays: tasks.size, built, backfilled, skipped, failed, pending, named,
    ms: Date.now() - started, ...(errors.length ? { errors } : {}),
  })
}
