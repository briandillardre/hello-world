import type { AlertEvent, AlertRule } from '../types'
import { MOCK_ALERTS, MOCK_ALERT_RULES } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** The newest 100 events (the log) PLUS every alert still waiting for a
 *  decision, however old. The 100-row window alone let a few days of routine
 *  zone crossings push unhandled theft and left-site alerts off the page and
 *  every badge — Sep 28: 70 of 91 open alerts were hidden that way, and "Mark
 *  all as handled" could never have reached them. Newest first. */
export async function getAlertEvents(companyId: string): Promise<AlertEvent[]> {
  if (isMock) return MOCK_ALERTS

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  // No zone geometry: the map places a zone's alert pin from its own zone
  // list, and this list rides the 20 s map poll.
  const cols = (innerRule: boolean) => `
      *,
      asset:assets(id, name, type),
      rule:alert_rules${innerRule ? '!inner' : ''}(*, geofence:geofences(id, name, color))
    `
  const [recent, openRuled, openSystem] = await Promise.all([
    supabase
      .from('alert_events')
      .select(cols(false))
      .eq('company_id', companyId)
      .order('triggered_at', { ascending: false })
      .limit(100),
    // Open rule alerts that are not routine enter/exit crossings (the zone
    // log is a log — isZoneLogEvent)…
    supabase
      .from('alert_events')
      .select(cols(true))
      .eq('company_id', companyId)
      .is('acknowledged_at', null)
      .not('rule.trigger', 'in', '(enter,exit)')
      .order('triggered_at', { ascending: false })
      .limit(150),
    // …and open telemetry alerts (022: `kind`, no rule).
    supabase
      .from('alert_events')
      .select(cols(false))
      .eq('company_id', companyId)
      .is('acknowledged_at', null)
      .not('kind', 'is', null)
      .order('triggered_at', { ascending: false })
      .limit(50),
  ])
  const byId = new Map<string, AlertEvent>()
  for (const q of [recent, openRuled, openSystem]) {
    for (const e of (q.data ?? []) as unknown as AlertEvent[]) byId.set(e.id, e)
  }
  return Array.from(byId.values()).sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))
}

export async function acknowledgeAlert(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { error } = await supabase
    .from('alert_events')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
  // Same contract as the bulk path: a swallowed error paints an alert as
  // handled while nothing persisted.
  if (error) throw new Error(error.message)
}

/** Bulk-ack a specific set — the ids on screen, never a blanket sweep (an
 *  alert that lands after the page loaded is never handled unseen).
 *  RLS scopes the update to the caller's company. */
export async function acknowledgeAlerts(ids: string[]): Promise<void> {
  if (isMock || !ids.length) return
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const now = new Date().toISOString()
  const all = ids.slice(0, 500)
  // 100 per UPDATE: every id rides in the request URL, and a few hundred
  // overrun the gateway's request-line limit ("Mark all" sends them all).
  for (let i = 0; i < all.length; i += 100) {
    const { error } = await supabase
      .from('alert_events')
      .update({ acknowledged_at: now })
      .in('id', all.slice(i, i + 100))
      // Already handled keeps its first handled time.
      .is('acknowledged_at', null)
    // Surface failure — a swallowed error here means the UI shows theft
    // alerts as acknowledged while nothing persisted (sec-check P2).
    if (error) throw new Error(error.message)
  }
}

export async function getAlertRules(companyId: string): Promise<AlertRule[]> {
  if (isMock) return MOCK_ALERT_RULES

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('alert_rules')
    .select('*')
    .eq('company_id', companyId)
  return data ?? []
}

export async function createAlertRule(
  companyId: string,
  payload: Pick<AlertRule, 'geofence_id' | 'asset_id' | 'trigger' | 'idle_minutes'> & Pick<Partial<AlertRule>, 'params'>
): Promise<AlertRule | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data, error } = await supabase
    .from('alert_rules')
    .insert({ ...payload, company_id: companyId, active: true })
    .select()
    .single()
  // Pre-043 schema (no params column): retry without it so rule creation
  // never breaks on an un-migrated install.
  if (error && payload.params !== undefined) {
    const rest = { geofence_id: payload.geofence_id, asset_id: payload.asset_id, trigger: payload.trigger, idle_minutes: payload.idle_minutes }
    const { data: retry } = await supabase
      .from('alert_rules')
      .insert({ ...rest, company_id: companyId, active: true })
      .select()
      .single()
    return retry
  }
  return data
}

export async function updateAlertRule(
  id: string,
  payload: Partial<Pick<AlertRule, 'geofence_id' | 'asset_id' | 'trigger' | 'idle_minutes' | 'params' | 'active'>>
): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { error } = await supabase.from('alert_rules').update(payload).eq('id', id)
  if (error && payload.params !== undefined) {
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(payload)) if (k !== 'params') rest[k] = v
    if (Object.keys(rest).length) await supabase.from('alert_rules').update(rest).eq('id', id)
  }
}

/**
 * Bulk coverage for the rules matrix: for each zone, enable (creating when
 * missing) or disable the ZONE-WIDE rule (asset_id null) of one trigger.
 * Idle rules created this way default to 60 minutes.
 */
export async function bulkSetZoneRules(
  companyId: string,
  zoneIds: string[],
  trigger: AlertRule['trigger'],
  enable: boolean
): Promise<void> {
  if (isMock || zoneIds.length === 0) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data: existing } = await supabase
    .from('alert_rules')
    .select('id, geofence_id, active')
    .eq('company_id', companyId)
    .eq('trigger', trigger)
    .is('asset_id', null)
    .in('geofence_id', zoneIds)
  const byZone = new Map((existing ?? []).map((r) => [r.geofence_id as string, r]))

  const flipIds = (existing ?? []).filter((r) => r.active !== enable).map((r) => r.id as string)
  if (flipIds.length) {
    await supabase.from('alert_rules').update({ active: enable }).in('id', flipIds)
  }
  if (enable) {
    const missing = zoneIds.filter((z) => !byZone.has(z))
    if (missing.length) {
      await supabase.from('alert_rules').insert(missing.map((z) => ({
        company_id: companyId, geofence_id: z, asset_id: null, trigger,
        idle_minutes: trigger === 'idle' ? 60 : null, active: true,
      })))
    }
  }
}

export async function deleteAlertRule(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('alert_rules').delete().eq('id', id)
}
