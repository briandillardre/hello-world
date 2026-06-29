import type { AlertEvent, AlertRule } from '../types'
import { MOCK_ALERTS, MOCK_ALERT_RULES } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getAlertEvents(companyId: string): Promise<AlertEvent[]> {
  if (isMock) return MOCK_ALERTS

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('alert_events')
    .select(`
      *,
      asset:assets(id, name, type),
      rule:alert_rules(*, geofence:geofences(id, name, color))
    `)
    .eq('company_id', companyId)
    .order('triggered_at', { ascending: false })
    .limit(100)
  return data ?? []
}

export async function acknowledgeAlert(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase
    .from('alert_events')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
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
  payload: Pick<AlertRule, 'geofence_id' | 'asset_id' | 'trigger' | 'idle_minutes'>
): Promise<AlertRule | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('alert_rules')
    .insert({ ...payload, company_id: companyId, active: true })
    .select()
    .single()
  return data
}

export async function updateAlertRule(
  id: string,
  payload: Partial<Pick<AlertRule, 'geofence_id' | 'asset_id' | 'trigger' | 'idle_minutes' | 'active'>>
): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('alert_rules').update(payload).eq('id', id)
}

export async function deleteAlertRule(id: string): Promise<void> {
  if (isMock) return

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  await supabase.from('alert_rules').delete().eq('id', id)
}
