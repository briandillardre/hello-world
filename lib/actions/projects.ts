'use server'

import { requireEditOrThrow } from '@/lib/permissions-server'
import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ProjectTask {
  id: string
  title: string
  status: 'open' | 'done'
  priority: 'normal' | 'high'
  assignee_id: string | null
  due_date: string | null
  created_at: string
  done_at: string | null
}

export interface ProjectMilestone {
  id: string
  name: string
  target_date: string | null
  done_at: string | null
}

type Result = { ok: boolean; error?: string }
const MIGRATION_HINT = 'Run migration 046_project_management.sql in the Supabase SQL Editor first.'

/**
 * Writes run on the service role AFTER requireEditOrThrow() (every action calls
 * it first) with the company checked on every row — the 138 pattern; members
 * are left with reads only once the step-2 migration lands (board #224). A zone and an assignee must be the
 * caller's company's.
 */
async function client() {
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { supabase: createServiceClient(), companyId: await getCurrentCompanyId(), userId: user?.id ?? null }
}

const UUID = /^[0-9a-f-]{36}$/i

async function ownZone(supabase: Awaited<ReturnType<typeof client>>['supabase'], companyId: string | null, zoneId: string): Promise<boolean> {
  if (!companyId || !UUID.test(zoneId)) return false
  const { data } = await supabase.from('geofences').select('id').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  return !!data
}

async function ownMember(supabase: Awaited<ReturnType<typeof client>>['supabase'], companyId: string | null, userId: string | undefined | null): Promise<boolean> {
  if (!userId) return true
  if (!companyId || !UUID.test(userId)) return false
  const { data } = await supabase.from('profiles').select('id').eq('id', userId).eq('company_id', companyId).maybeSingle()
  return !!data
}

export async function addTaskAction(zoneId: string, input: { title: string; assigneeId?: string; dueDate?: string; high?: boolean }): Promise<Result & { task?: ProjectTask }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const title = input.title.trim().slice(0, 300)
  if (!title) return { ok: false, error: 'Write the task first.' }
  const { supabase, companyId, userId } = await client()
  if (!(await ownZone(supabase, companyId, zoneId))) return { ok: false, error: 'That site wasn’t found.' }
  if (!(await ownMember(supabase, companyId, input.assigneeId))) return { ok: false, error: 'Pick someone on your team.' }
  const { data, error } = await supabase.from('project_tasks').insert({
    company_id: companyId,
    geofence_id: zoneId,
    title,
    priority: input.high ? 'high' : 'normal',
    assignee_id: input.assigneeId || null,
    due_date: input.dueDate || null,
    created_by: userId,
  }).select('id, title, status, priority, assignee_id, due_date, created_at, done_at').single()
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true, task: data as ProjectTask }
}

/** Edit a punch item in place — reassign, retitle, redate, reprioritize
 *  ("need to be able to click and edit these", Aug 6). */
export async function updateTaskAction(zoneId: string, taskId: string, input: { title: string; assigneeId?: string; dueDate?: string; high?: boolean }): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const title = input.title.trim().slice(0, 300)
  if (!title) return { ok: false, error: 'The task needs a name.' }
  const { supabase, companyId } = await client()
  if (!(await ownMember(supabase, companyId, input.assigneeId))) return { ok: false, error: 'Pick someone on your team.' }
  const { error } = await supabase.from('project_tasks')
    .update({
      title,
      priority: input.high ? 'high' : 'normal',
      assignee_id: input.assigneeId || null,
      due_date: input.dueDate || null,
    })
    .eq('id', taskId).eq('company_id', companyId).eq('geofence_id', zoneId)
  if (error) return { ok: false, error: 'Save failed — try again.' }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function updateMilestoneAction(zoneId: string, milestoneId: string, input: { name: string; targetDate?: string }): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const name = input.name.trim().slice(0, 200)
  if (!name) return { ok: false, error: 'The milestone needs a name.' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_milestones')
    .update({ name, target_date: input.targetDate || null })
    .eq('id', milestoneId).eq('company_id', companyId).eq('geofence_id', zoneId)
  if (error) return { ok: false, error: 'Save failed — try again.' }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function toggleTaskAction(zoneId: string, taskId: string, done: boolean): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_tasks')
    .update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null })
    .eq('id', taskId).eq('company_id', companyId).eq('geofence_id', zoneId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function deleteTaskAction(zoneId: string, taskId: string): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_tasks').delete().eq('id', taskId).eq('company_id', companyId).eq('geofence_id', zoneId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function addMilestoneAction(zoneId: string, input: { name: string; targetDate?: string }): Promise<Result & { milestone?: ProjectMilestone }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const name = input.name.trim().slice(0, 200)
  if (!name) return { ok: false, error: 'Name the milestone first.' }
  const { supabase, companyId } = await client()
  if (!(await ownZone(supabase, companyId, zoneId))) return { ok: false, error: 'That site wasn’t found.' }
  const { data, error } = await supabase.from('project_milestones').insert({
    company_id: companyId,
    geofence_id: zoneId,
    name,
    target_date: input.targetDate || null,
  }).select('id, name, target_date, done_at').single()
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true, milestone: data as ProjectMilestone }
}

export async function toggleMilestoneAction(zoneId: string, milestoneId: string, done: boolean): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_milestones')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', milestoneId).eq('company_id', companyId).eq('geofence_id', zoneId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function deleteMilestoneAction(zoneId: string, milestoneId: string): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_milestones').delete().eq('id', milestoneId).eq('company_id', companyId).eq('geofence_id', zoneId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function saveBudgetAction(zoneId: string, budget: number | null): Promise<Result> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (budget != null && (!Number.isFinite(budget) || budget < 0 || budget > 1e9)) {
    return { ok: false, error: 'Enter a valid amount.' }
  }
  // The budget stays on the caller's own session: the zone policies decide who may set dollars.
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const companyId = await getCurrentCompanyId()
  const { error } = await supabase.from('geofences')
    .update({ budget }).eq('id', zoneId).eq('company_id', companyId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}
