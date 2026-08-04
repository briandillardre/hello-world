import type { WorkOrder } from '../actions/workorders'
import type { MaintenanceStatus } from './maintenance'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface WorkOrderData {
  /** false = migration 050 not applied yet — UI shows the setup note. */
  available: boolean
  orders: WorkOrder[]
  members: { id: string; name: string }[]
}

/** Open + recent work orders, newest first, plus the assignee roster. */
export async function getWorkOrders(companyId: string): Promise<WorkOrderData> {
  const empty: WorkOrderData = { available: false, orders: [], members: [] }
  if (isMock) return { ...empty, available: true }
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const [woRes, profRes] = await Promise.all([
      supabase.from('work_orders').select('*').eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(300),
      supabase.from('profiles').select('id, name, email').eq('company_id', companyId),
    ])
    if (woRes.error) return empty // pre-050
    return {
      available: true,
      orders: (woRes.data ?? []) as WorkOrder[],
      members: (profRes.data ?? []).map((p) => ({
        id: p.id as string,
        name: (p.name as string) || (p.email as string) || 'Unnamed',
      })),
    }
  } catch { return empty }
}

/**
 * The auto layer: every OVERDUE schedule gets an open work order, exactly
 * once (unique partial index makes re-runs no-ops). Runs on maintenance
 * page load — cheap, idempotent, and no cron to babysit. This is the edge
 * over Tenna: the reading that opened the WO came off the truck itself.
 */
export async function ensureScheduleWorkOrders(
  companyId: string,
  overdue: (MaintenanceStatus & { name: string })[],
  readings: Record<string, number>
): Promise<number> {
  if (isMock || overdue.length === 0) return 0
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    let created = 0
    for (const s of overdue) {
      const { error } = await supabase.from('work_orders').insert({
        company_id: companyId,
        asset_id: s.asset_id,
        title: `${s.description || 'Scheduled service'} — ${s.name}`,
        detail: `Auto-opened: ${s.interval_type.replace('_', ' ')} interval of ${s.interval_value} exceeded.`,
        source: 'schedule',
        source_ref: s.id,
        priority: 'high',
        reading: readings[s.asset_id] ?? null,
      })
      // 23505 = an open WO for this schedule already exists — exactly right.
      if (!error) created++
      else if (error.code !== '23505') break // table missing / real failure — stop quietly
    }
    return created
  } catch { return 0 }
}
