import { MOCK_COMPANY } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export type Role = 'admin' | 'manager' | 'foreman' | 'viewer'

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  isYou: boolean
  /** Sensitive-info overrides — null = inherit the role default. */
  can_view_costs?: boolean | null
  can_manage_billing?: boolean | null
  can_manage_team?: boolean | null
}
export interface TeamInvite { id: string; email: string | null; role: Role; token: string; expires_at: string }

export interface TeamData {
  members: TeamMember[]
  invites: TeamInvite[]
  myRole: Role
  isAdmin: boolean
}

/** Company roster + pending invites for the Team page. Demo returns a sample. */
export async function getTeam(): Promise<TeamData> {
  if (isMock) {
    return {
      members: [
        { id: 'you', name: 'You (demo)', email: 'you@demo', role: 'admin', isYou: true },
        { id: 'm2', name: 'Sarah Chen', email: 'sarah@demo', role: 'foreman', isYou: false },
        { id: 'm3', name: 'John Martinez', email: 'john@demo', role: 'viewer', isYou: false },
      ],
      invites: [],
      myRole: 'admin',
      isAdmin: true,
    }
  }
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { members: [], invites: [], myRole: 'viewer', isAdmin: false }

    const { data: me } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
    const companyId = me?.company_id ?? user.id
    const myRole = (me?.role as Role) ?? 'admin'
    const isAdmin = myRole === 'admin' || user.id === companyId

    // Migration-tolerant: the override columns arrive with 011; fall back to
    // the narrow select if they don't exist yet.
    let profiles: Record<string, unknown>[] | null = null
    {
      const wide = await supabase.from('profiles')
        .select('id, name, email, role, can_view_costs, can_manage_billing, can_manage_team')
        .eq('company_id', companyId)
      profiles = wide.error
        ? (await supabase.from('profiles').select('id, name, email, role').eq('company_id', companyId)).data
        : wide.data
    }
    const { data: invites } = await supabase.from('invites').select('id, email, role, token, expires_at').eq('company_id', companyId).is('accepted_at', null).order('created_at', { ascending: false })

    const members: TeamMember[] = ((profiles ?? []) as {
      id: string; name: string | null; email: string | null; role: string | null
      can_view_costs?: boolean | null; can_manage_billing?: boolean | null; can_manage_team?: boolean | null
    }[]).map((p) => ({
      id: p.id,
      name: p.name || (p.id === user.id ? 'You' : 'Teammate'),
      email: p.email ?? '',
      role: (p.role as Role) ?? 'viewer',
      isYou: p.id === user.id,
      can_view_costs: p.can_view_costs ?? null,
      can_manage_billing: p.can_manage_billing ?? null,
      can_manage_team: p.can_manage_team ?? null,
    })).sort((a, b) => (a.isYou ? -1 : b.isYou ? 1 : a.name.localeCompare(b.name)))

    return { members, invites: (invites ?? []) as TeamInvite[], myRole, isAdmin }
  } catch {
    return { members: [], invites: [], myRole: 'viewer', isAdmin: false }
  }
}

export { MOCK_COMPANY }
