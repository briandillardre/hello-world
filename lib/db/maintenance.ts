import type { MaintenanceSchedule, ServiceRecord } from '../types'
import { MOCK_MAINTENANCE_SCHEDULES, MOCK_SERVICE_RECORDS, MOCK_CURRENT_READINGS } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface MaintenanceStatus extends MaintenanceSchedule {
  current_value: number
  used: number // amount consumed since last service
  remaining: number // until due (negative = overdue)
  pct: number // 0-100+ progress toward due
  status: 'ok' | 'due_soon' | 'overdue'
}

export async function getMaintenanceSchedules(companyId: string): Promise<MaintenanceSchedule[]> {
  if (isMock) return MOCK_MAINTENANCE_SCHEDULES

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('maintenance_schedules')
    .select('*')
    .eq('company_id', companyId)
  return data ?? []
}

export async function getServiceRecords(companyId: string, assetId?: string): Promise<ServiceRecord[]> {
  if (isMock) {
    return assetId
      ? MOCK_SERVICE_RECORDS.filter(r => r.asset_id === assetId)
      : MOCK_SERVICE_RECORDS
  }

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  let q = supabase.from('service_records').select('*').eq('company_id', companyId)
  if (assetId) q = q.eq('asset_id', assetId)
  const { data } = await q.order('service_date', { ascending: false })
  return data ?? []
}

export async function getCurrentReadings(): Promise<Record<string, number>> {
  // In production this comes from latest OBD2 odometer / engine-hour telemetry.
  if (isMock) return MOCK_CURRENT_READINGS
  return {}
}

export function computeStatus(
  schedule: MaintenanceSchedule,
  currentValue: number
): MaintenanceStatus {
  const used = schedule.interval_type === 'days'
    ? daysSince(schedule.last_service_date)
    : Math.max(0, currentValue - schedule.last_service_value)
  const remaining = schedule.interval_value - used
  const pct = schedule.interval_value > 0 ? (used / schedule.interval_value) * 100 : 0
  const status: MaintenanceStatus['status'] =
    remaining <= 0 ? 'overdue' : pct >= 85 ? 'due_soon' : 'ok'
  return { ...schedule, current_value: currentValue, used, remaining, pct, status }
}

function daysSince(date: string | null): number {
  if (!date) return 0
  return Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000))
}

export async function createServiceRecord(
  companyId: string,
  payload: Omit<ServiceRecord, 'id' | 'company_id'>
): Promise<ServiceRecord | null> {
  if (isMock) return null

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('service_records')
    .insert({ ...payload, company_id: companyId })
    .select()
    .single()
  return data
}
