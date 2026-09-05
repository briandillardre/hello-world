import { MOCK_COMPANY } from '../mock-data'
import {
  ROLES, RANK, normalizeRole, outranks, rankOf, rolesEditableBy,
  type Role, type RolePolicy, type Permissions,
} from '../permissions'
import { getRealPermissions } from '../permissions-server'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export type { Role }

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  /** The company's one owner login. Shown as Admin to everyone else. */
  isMaster: boolean
  isYou: boolean
  /** Sensitive-info overrides — null = inherit the role default. */
  can_view_costs?: boolean | null
  can_manage_billing?: boolean | null
  can_manage_team?: boolean | null
  /** Can the CALLER change this person's role/switches, preview as them, read their AI chats? */
  manageable: boolean
}
export interface TeamInvite { id: string; email: string | null; role: Role; token: string; expires_at: string }

export interface TeamData {
  members: TeamMember[]
  invites: TeamInvite[]
  myRole: Role
  /** The caller may invite / change roles (Master, Admin, or the manage-team switch). */
  isAdmin: boolean
  /** The caller IS the Master. Only they see the crown. */
  isMaster: boolean
  /** Roles the caller may assign to others (below their own rank; the Master may assign Admin). */
  assignableRoles: Role[]
  /** View-levels rows the caller may edit. */
  editableRoles: Role[]
  /** The company's view-levels overrides (sparse). */
  policy: RolePolicy
}

/** Company roster + pending invites + the view-levels table for /team. */
export async function getTeam(): Promise<TeamData> {
  if (isMock) {
    return {
      members: [
        { id: 'you', name: 'You (demo)', email: 'you@demo', role: 'admin', isMaster: true, isYou: true, manageable: false },
        { id: 'm4', name: 'Office admin (demo)', email: 'admin@demo', role: 'admin', isMaster: false, isYou: false, manageable: true },
        { id: 'm2', name: 'Foreman (demo)', email: 'foreman@demo', role: 'foreman', isMaster: false, isYou: false, manageable: true },
        { id: 'm3', name: 'Crew member (demo)', email: 'crew@demo', role: 'associate', isMaster: false, isYou: false, manageable: true },
      ],
      invites: [],
      myRole: 'admin', isAdmin: true, isMaster: true,
      assignableRoles: ROLES, editableRoles: ROLES, policy: {},
    }
  }
  const empty: TeamData = { members: [], invites: [], myRole: 'associate', isAdmin: false, isMaster: false, assignableRoles: [], editableRoles: [], policy: {} }
  try {
    const me = await getRealPermissions()
    if (!me.userId || !me.companyId) return empty
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const companyId = me.companyId

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
    const [{ data: invites }, { data: co }] = await Promise.all([
      supabase.from('invites').select('id, email, role, token, expires_at, created_at').eq('company_id', companyId).is('accepted_at', null).order('created_at', { ascending: false }),
      supabase.from('companies').select('role_policy').eq('id', companyId).maybeSingle(),
    ])

    const isAdmin = me.isMaster || me.role === 'admin' || me.canManageTeam
    const members: TeamMember[] = ((profiles ?? []) as {
      id: string; name: string | null; email: string | null; role: string | null
      can_view_costs?: boolean | null; can_manage_billing?: boolean | null; can_manage_team?: boolean | null
    }[]).map((p) => {
      const isMaster = p.id === companyId
      const role = isMaster ? 'admin' : normalizeRole(p.role, 'associate')
      return {
        id: p.id,
        name: p.name || (p.id === me.userId ? 'You' : 'Teammate'),
        email: p.email ?? '',
        role, isMaster,
        isYou: p.id === me.userId,
        can_view_costs: p.can_view_costs ?? null,
        can_manage_billing: p.can_manage_billing ?? null,
        can_manage_team: p.can_manage_team ?? null,
        manageable: isAdmin && p.id !== me.userId && outranks(me, { role, isMaster }),
      }
    }).sort((a, b) => (a.isYou ? -1 : b.isYou ? 1 : RANK[b.role] - RANK[a.role] || a.name.localeCompare(b.name)))

    return {
      members,
      invites: ((invites ?? []) as TeamInvite[]).map((i) => ({ ...i, role: normalizeRole(i.role, 'associate') })),
      myRole: me.role, isAdmin, isMaster: me.isMaster,
      assignableRoles: assignableRolesFor(me),
      editableRoles: rolesEditableBy(me),
      policy: ((co?.role_policy as RolePolicy | null) ?? {}),
    }
  } catch {
    return empty
  }
}

/** Roles a manager-of-people may hand out: strictly below their own rank,
 *  except the Master, who may make Admins. */
export function assignableRolesFor(me: Pick<Permissions, 'role' | 'isMaster' | 'canManageTeam'>): Role[] {
  if (me.isMaster) return ROLES
  if (me.role === 'admin' || me.canManageTeam) return ROLES.filter((r) => RANK[r] < rankOf(me))
  return []
}

export { MOCK_COMPANY }
