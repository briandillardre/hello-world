'use server'

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

async function client() {
  const { createClient } = await import('@/lib/supabase-server')
  return { supabase: createClient(), companyId: await getCurrentCompanyId() }
}

export async function addTaskAction(zoneId: string, input: { title: string; assigneeId?: string; dueDate?: string; high?: boolean }): Promise<Result & { task?: ProjectTask }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const title = input.title.trim().slice(0, 300)
  if (!title) return { ok: false, error: 'Write the task first.' }
  const { supabase, companyId } = await client()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('project_tasks').insert({
    company_id: companyId,
    geofence_id: zoneId,
    title,
    priority: input.high ? 'high' : 'normal',
    assignee_id: input.assigneeId || null,
    due_date: input.dueDate || null,
    created_by: user?.id ?? null,
  }).select('id, title, status, priority, assignee_id, due_date, created_at, done_at').single()
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true, task: data as ProjectTask }
}

/** Edit a punch item in place — reassign, retitle, redate, reprioritize
 *  ("need to be able to click and edit these", Aug 6). */
export async function updateTaskAction(zoneId: string, taskId: string, input: { title: string; assigneeId?: string; dueDate?: string; high?: boolean }): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const title = input.title.trim().slice(0, 300)
  if (!title) return { ok: false, error: 'The task needs a name.' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_tasks')
    .update({
      title,
      priority: input.high ? 'high' : 'normal',
      assignee_id: input.assigneeId || null,
      due_date: input.dueDate || null,
    })
    .eq('id', taskId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Save failed — try again.' }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function updateMilestoneAction(zoneId: string, milestoneId: string, input: { name: string; targetDate?: string }): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const name = input.name.trim().slice(0, 200)
  if (!name) return { ok: false, error: 'The milestone needs a name.' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_milestones')
    .update({ name, target_date: input.targetDate || null })
    .eq('id', milestoneId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Save failed — try again.' }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function toggleTaskAction(zoneId: string, taskId: string, done: boolean): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_tasks')
    .update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null })
    .eq('id', taskId).eq('company_id', companyId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function deleteTaskAction(zoneId: string, taskId: string): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_tasks').delete().eq('id', taskId).eq('company_id', companyId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function addMilestoneAction(zoneId: string, input: { name: string; targetDate?: string }): Promise<Result & { milestone?: ProjectMilestone }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const name = input.name.trim().slice(0, 200)
  if (!name) return { ok: false, error: 'Name the milestone first.' }
  const { supabase, companyId } = await client()
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
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_milestones')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', milestoneId).eq('company_id', companyId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function deleteMilestoneAction(zoneId: string, milestoneId: string): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('project_milestones').delete().eq('id', milestoneId).eq('company_id', companyId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}

export async function saveBudgetAction(zoneId: string, budget: number | null): Promise<Result> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (budget != null && (!Number.isFinite(budget) || budget < 0 || budget > 1e9)) {
    return { ok: false, error: 'Enter a valid amount.' }
  }
  const { supabase, companyId } = await client()
  const { error } = await supabase.from('geofences')
    .update({ budget }).eq('id', zoneId).eq('company_id', companyId)
  if (error) return { ok: false, error: MIGRATION_HINT }
  revalidatePath(`/zones/${zoneId}`)
  return { ok: true }
}
