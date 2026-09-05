'use server'

import { requireEditOrThrow } from '@/lib/permissions-server'
import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import type { MaintenanceIntervalType } from '@/lib/types'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

type Result = { ok: boolean; error?: string }

const INTERVAL_TYPES: MaintenanceIntervalType[] = ['engine_hours', 'mileage', 'days']

/**
 * Create a service schedule — the countdown the overdue math runs against.
 * `lastServiceValue` is the baseline reading (hours/odometer at the last
 * service); the last-done date is stamped now so day-based intervals start
 * counting from today.
 */
export async function createScheduleAction(input: {
  assetId: string
  description: string
  intervalType: MaintenanceIntervalType
  intervalValue: number
  /** Reading at last service (engine hours or miles); ignored for day intervals. */
  lastServiceValue?: number
}): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const description = input.description.trim().slice(0, 200)
  const intervalValue = Number(input.intervalValue)
  if (!input.assetId || !description) return { ok: false, error: 'Pick the machine and name the service.' }
  if (!Number.isFinite(intervalValue) || intervalValue <= 0) return { ok: false, error: 'The interval must be a positive number.' }
  if (!INTERVAL_TYPES.includes(input.intervalType)) return { ok: false, error: 'Pick an interval type.' }

  const companyId = await getCurrentCompanyId()
  // The FK alone would accept ANY company's asset UUID — verify ownership
  // before writing the schedule (sec-check, Aug 18).
  {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: owned } = await createClient()
      .from('assets').select('id').eq('id', input.assetId).eq('company_id', companyId).maybeSingle()
    if (!owned) return { ok: false, error: 'That machine is not in your fleet.' }
  }
  const { createSchedule } = await import('@/lib/db/maintenance')
  const created = await createSchedule(companyId, {
    asset_id: input.assetId,
    interval_type: input.intervalType,
    interval_value: intervalValue,
    last_service_value: Math.max(0, Number(input.lastServiceValue) || 0),
    last_service_date: new Date().toISOString(),
    description,
  })
  if (!created) return { ok: false, error: 'Could not create the schedule. Is migration 002 applied?' }
  revalidatePath('/maintenance')
  return { ok: true }
}
