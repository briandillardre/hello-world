'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface WorkOrder {
  id: string
  asset_id: string
  title: string
  detail: string | null
  source: 'manual' | 'schedule' | 'fault' | 'health'
  priority: 'normal' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'waiting_parts' | 'done' | 'canceled'
  assignee_id: string | null
  due_date: string | null
  reading: number | null
  parts_cost: number
  labor_hours: number
  labor_rate: number | null
  created_at: string
  completed_at: string | null
}

type Result = { ok: boolean; error?: string }
const HINT = 'Run migration 050_work_orders.sql in the Supabase SQL Editor first.'

async function client() {
  const { createClient } = await import('@/lib/supabase-server')
  return { supabase: createClient(), companyId: await getCurrentCompanyId() }
}

export async function createWorkOrderAction(input: {
  assetId: string; title: string; detail?: string
  priority?: WorkOrder['priority']; assigneeId?: string; dueDate?: string
  source?: WorkOrder['source']; sourceRef?: string; reading?: number
}): Promise<Result & { wo?: WorkOrder }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const title = input.title.trim().slice(0, 200)
  if (!title || !input.assetId) return { ok: false, error: 'Pick the machine and name the job.' }
  const { supabase, companyId } = await client()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('work_orders').insert({
    company_id: companyId,
    asset_id: input.assetId,
    title,
    detail: input.detail?.trim().slice(0, 2000) || null,
    priority: input.priority ?? 'normal',
    assignee_id: input.assigneeId || null,
    due_date: input.dueDate || null,
    source: input.source ?? 'manual',
    source_ref: input.sourceRef ?? null,
    reading: input.reading ?? null,
    created_by: user?.id ?? null,
  }).select('*').single()
  if (error) return { ok: false, error: HINT }
  revalidatePath('/maintenance')
  return { ok: true, wo: data as WorkOrder }
}

export async function updateWorkOrderAction(id: string, patch: {
  status?: WorkOrder['status']; priority?: WorkOrder['priority']
  assigneeId?: string | null; dueDate?: string | null
}): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const row: Record<string, unknown> = {}
  if (patch.status) row.status = patch.status
  // Reopening clears the completion stamps — otherwise a reopened WO could
  // be completed AGAIN, double-writing service history and resetting the
  // schedule clock twice (sec-check, Aug 18).
  if (patch.status === 'open') { row.completed_at = null; row.service_record_id = null }
  if (patch.priority) row.priority = patch.priority
  if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId || null
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate || null
  const { error } = await supabase.from('work_orders').update(row).eq('id', id).eq('company_id', companyId)
  if (error) return { ok: false, error: HINT }
  revalidatePath('/maintenance')
  return { ok: true }
}

/**
 * Completion is the whole point: one action closes the WO, writes the
 * service-history record (with real costs), and — when the WO came from a
 * schedule — resets that schedule's counter so the next interval starts
 * counting from today's reading. Tenna makes this three screens.
 */
export async function completeWorkOrderAction(id: string, input: {
  partsCost?: number; laborHours?: number; laborRate?: number
  vendor?: string; notes?: string; reading?: number
}): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { data: wo } = await supabase.from('work_orders')
    .select('*').eq('id', id).eq('company_id', companyId).single()
  if (!wo) return { ok: false, error: 'Work order not found' }
  if (wo.status === 'done') return { ok: true }

  const parts = Math.max(0, Number(input.partsCost) || 0)
  const laborHours = Math.max(0, Number(input.laborHours) || 0)
  const laborRate = Math.max(0, Number(input.laborRate) || 0)
  const cost = parts + laborHours * laborRate
  const reading = Number.isFinite(Number(input.reading)) ? Number(input.reading) : wo.reading

  const { data: rec, error: recErr } = await supabase.from('service_records').insert({
    company_id: companyId,
    asset_id: wo.asset_id,
    cost,
    vendor: (input.vendor ?? '').trim().slice(0, 120),
    notes: [wo.title, (input.notes ?? '').trim()].filter(Boolean).join(' — ').slice(0, 2000),
    odometer_or_hours: reading,
  }).select('id').single()
  if (recErr) return { ok: false, error: 'Could not write the service record.' }

  const { error } = await supabase.from('work_orders').update({
    status: 'done',
    completed_at: new Date().toISOString(),
    parts_cost: parts,
    labor_hours: laborHours,
    labor_rate: laborRate || null,
    service_record_id: rec?.id ?? null,
  }).eq('id', id).eq('company_id', companyId)
  if (error) return { ok: false, error: HINT }

  // Schedule-born WO → restart that schedule's clock at the service reading.
  if (wo.source === 'schedule' && wo.source_ref) {
    const patch: Record<string, unknown> = { last_service_date: new Date().toISOString() }
    if (reading != null) patch.last_service_value = reading
    await supabase.from('maintenance_schedules').update(patch)
      .eq('id', wo.source_ref).eq('company_id', companyId)
  }
  revalidatePath('/maintenance')
  return { ok: true }
}

export async function cancelWorkOrderAction(id: string): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('work_orders')
    .update({ status: 'canceled', completed_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId)
  if (error) return { ok: false, error: HINT }
  revalidatePath('/maintenance')
  return { ok: true }
}
