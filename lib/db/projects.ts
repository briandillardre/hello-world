import type { ProjectTask, ProjectMilestone } from '../actions/projects'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ProjectHubData {
  /** null = migration 046 not run yet — hub renders its setup note. */
  available: boolean
  tasks: ProjectTask[]
  milestones: ProjectMilestone[]
  members: { id: string; name: string }[]
  /** All-time job-coded receipts for this zone (approved + pending). */
  receiptsTotal: number
}

/** Everything the zone page's Project Hub needs. Tolerates a pre-046 DB. */
export async function getProjectHubData(companyId: string, zoneId: string): Promise<ProjectHubData> {
  const empty: ProjectHubData = { available: false, tasks: [], milestones: [], members: [], receiptsTotal: 0 }
  if (isMock) return { ...empty, available: true }
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const [tasksRes, milestonesRes, profilesRes, receiptsRes] = await Promise.all([
      supabase.from('project_tasks')
        .select('id, title, status, priority, assignee_id, due_date, created_at, done_at')
        .eq('geofence_id', zoneId).order('created_at', { ascending: false }).limit(300),
      supabase.from('project_milestones')
        .select('id, name, target_date, done_at')
        .eq('geofence_id', zoneId).order('target_date', { ascending: true, nullsFirst: false }).limit(100),
      supabase.from('profiles').select('id, name, email').eq('company_id', companyId),
      supabase.from('receipts').select('amount')
        .eq('company_id', companyId).eq('project_geofence_id', zoneId).neq('status', 'rejected'),
    ])
    if (tasksRes.error || milestonesRes.error) return empty // pre-046
    return {
      available: true,
      tasks: (tasksRes.data ?? []) as ProjectTask[],
      milestones: (milestonesRes.data ?? []) as ProjectMilestone[],
      members: (profilesRes.data ?? []).map((p) => ({
        id: p.id as string,
        name: (p.name as string) || (p.email as string) || 'Unnamed',
      })),
      receiptsTotal: (receiptsRes.data ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0),
    }
  } catch {
    return empty
  }
}
