import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  resolvePermissions, outranks, normalizeRole,
  type Permissions, type RolePolicy, type FeatureKey, type Role,
} from './permissions'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Cookie an admin sets to preview the app as a teammate (read-only). */
export const VIEW_AS_COOKIE = 'ht_view_as'

const ASSOCIATE: Permissions = resolvePermissions({ role: 'associate' }, false, null)
const MASTER: Permissions = resolvePermissions(null, true, null)

interface ProfileRow {
  id: string
  company_id: string | null
  role: string | null
  name?: string | null
  can_view_costs?: boolean | null
  can_manage_billing?: boolean | null
  can_manage_team?: boolean | null
}

type Db = ReturnType<typeof import('./supabase-server').createClient>

/** Migration-tolerant profile read: if 011's override columns are missing
 *  the wide select errors — fall back to role-only. */
async function readProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const wide = await db.from('profiles')
    .select('id, company_id, role, name, can_view_costs, can_manage_billing, can_manage_team')
    .eq('id', userId).maybeSingle()
  if (!wide.error) return wide.data as ProfileRow | null
  const narrow = await db.from('profiles').select('id, company_id, role, name').eq('id', userId).maybeSingle()
  return narrow.data as ProfileRow | null
}

async function readPolicy(db: Db, companyId: string): Promise<RolePolicy | null> {
  const { data, error } = await db.from('companies').select('role_policy').eq('id', companyId).maybeSingle()
  if (error) return null // pre-094 schema
  return (data?.role_policy as RolePolicy | null) ?? null
}

/**
 * Server-side: the CALLER's resolved permissions. Demo = the Master (nothing
 * persists); logged-out or error = Associate.
 *
 * View-as: when an Admin/Master has set the preview cookie for a teammate
 * they outrank, the result is THAT person's permissions with every write
 * ability switched off — a read-only preview, never a way to act as them.
 * Every gate in the app funnels through here, so the preview is complete.
 */
export async function getMyPermissions(): Promise<Permissions> {
  if (isMock) return MASTER
  try {
    const { createClient } = await import('./supabase-server')
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return ASSOCIATE
    const me = await readProfile(db, user.id)
    const companyId = me?.company_id ?? user.id
    // Company founder (profile.company_id === own id, or no profile yet) = Master.
    const isOwner = !me || user.id === companyId
    const policy = await readPolicy(db, companyId)
    const real = resolvePermissions(me, isOwner, policy)

    const viewAs = cookies().get(VIEW_AS_COOKIE)?.value
    if (!viewAs || viewAs === user.id) return real
    if (!(real.isMaster || real.role === 'admin')) return real
    const target = await readProfile(db, viewAs)
    if (!target || target.company_id !== companyId) return real
    const targetIsMaster = target.id === companyId
    if (!outranks(real, { role: normalizeRole(target.role, 'associate'), isMaster: targetIsMaster })) return real
    const preview = resolvePermissions(target, targetIsMaster, policy)
    return {
      ...preview,
      features: preview.features.filter((k) => k !== 'edit' && k !== 'billing' && k !== 'manage_team'),
      canEdit: false, canManageBilling: false, canManageTeam: false,
      viewingAs: { id: target.id, name: target.name || 'Teammate', role: preview.role },
    }
  } catch {
    return ASSOCIATE
  }
}

/** The caller's REAL permissions, ignoring any view-as preview. For the
 *  actions that manage the preview itself and the team. */
export async function getRealPermissions(): Promise<Permissions & { userId: string | null; companyId: string | null }> {
  if (isMock) return { ...MASTER, userId: null, companyId: null }
  try {
    const { createClient } = await import('./supabase-server')
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    if (!user) return { ...ASSOCIATE, userId: null, companyId: null }
    const me = await readProfile(db, user.id)
    const companyId = me?.company_id ?? user.id
    const isOwner = !me || user.id === companyId
    const policy = await readPolicy(db, companyId)
    return { ...resolvePermissions(me, isOwner, policy), userId: user.id, companyId }
  } catch {
    return { ...ASSOCIATE, userId: null, companyId: null }
  }
}

/** Page gate: 404 (never a hint that the page exists) when the caller's view
 *  levels don't include the feature. Use at the top of a page component. */
export async function requireFeature(key: FeatureKey): Promise<Permissions> {
  const perms = await getMyPermissions()
  if (!perms.features.includes(key)) notFound()
  return perms
}

export type { Role }
