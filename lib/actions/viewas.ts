'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getRealPermissions, VIEW_AS_COOKIE } from '@/lib/permissions-server'
import { outranks, normalizeRole, canSeeMember, ROLE_LABEL, ROLE_BLURB, RANK, MASTER_ONLY_ROLES, type Role } from '@/lib/permissions'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * "View app as" — Master and Admins preview the app exactly as a teammate
 * they outrank sees it. Read-only by construction (getMyPermissions strips
 * every write ability under the cookie). The cookie is httpOnly and lives
 * for the browser session; Exit clears it.
 */
export async function viewAsAction(memberId: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode.' }
  const me = await getRealPermissions()
  if (!me.userId || !me.companyId) return { ok: false, error: 'Not signed in.' }
  if (!(me.isMaster || me.role === 'admin')) return { ok: false, error: 'Only admins can view the app as someone else.' }
  if (memberId === me.userId) return { ok: false, error: 'That is you.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data: target } = await createServiceClient().from('profiles')
    .select('id, company_id, role, name').eq('id', memberId).maybeSingle()
  if (!target || target.company_id !== me.companyId) return { ok: false, error: 'That person is not on your team.' }
  const targetIsMaster = target.id === me.companyId
  const targetRole = normalizeRole(target.role, 'associate')
  // A Prospective Client exists for the Master alone (118) — to anyone else
  // the answer is the same as for a stranger, so the role leaks nothing.
  if (!canSeeMember({ ...me, id: me.userId }, { id: target.id, role: targetRole })) return { ok: false, error: 'That person is not on your team.' }
  if (!outranks(me, { role: targetRole, isMaster: targetIsMaster })) {
    return { ok: false, error: 'You can only view the app as someone below your level.' }
  }

  cookies().set(VIEW_AS_COOKIE, target.id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function exitViewAsAction(): Promise<{ ok: boolean }> {
  cookies().set(VIEW_AS_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
  revalidatePath('/', 'layout')
  return { ok: true }
}

export interface ViewAsTarget {
  id: string
  name: string
  role: Role
  roleLabel: string
  /** One line under the name in the picker — what this role is. */
  note: string
  /** Only the Master may see or preview this person (a Prospective Client). */
  masterOnly: boolean
}

/**
 * Who the caller may preview — for the "View as…" picker at the top of the
 * app. People strictly below the caller on the ladder; a Prospective Client
 * only for the Master. Read under the caller's own RLS, so a row the
 * database hides from them (118) never reaches the list either.
 */
export async function listViewAsTargetsAction(): Promise<{ ok: true; targets: ViewAsTarget[] } | { ok: false; error: string }> {
  if (isMock) {
    return { ok: true, targets: [
      { id: 'm4', name: 'Office admin (demo)', role: 'admin', roleLabel: ROLE_LABEL.admin, note: ROLE_BLURB.admin, masterOnly: false },
      { id: 'm2', name: 'Foreman (demo)', role: 'foreman', roleLabel: ROLE_LABEL.foreman, note: ROLE_BLURB.foreman, masterOnly: false },
      { id: 'm3', name: 'Crew member (demo)', role: 'associate', roleLabel: ROLE_LABEL.associate, note: ROLE_BLURB.associate, masterOnly: false },
    ] }
  }
  const me = await getRealPermissions()
  if (!me.userId || !me.companyId) return { ok: false, error: 'Not signed in.' }
  if (!(me.isMaster || me.role === 'admin')) return { ok: false, error: 'Only admins can view the app as someone else.' }
  const { createClient } = await import('@/lib/supabase-server')
  const { data, error } = await createClient().from('profiles').select('id, name, email, role').eq('company_id', me.companyId)
  if (error) return { ok: false, error: 'Could not read the team.' }
  const actor = { ...me, id: me.userId }
  const targets: ViewAsTarget[] = []
  for (const p of (data ?? []) as { id: string; name: string | null; email: string | null; role: string | null }[]) {
    if (p.id === me.userId || p.id === me.companyId) continue
    const role = normalizeRole(p.role, 'associate')
    if (!canSeeMember(actor, { id: p.id, role })) continue
    if (!outranks(me, { role, isMaster: false })) continue
    targets.push({ id: p.id, name: p.name || p.email || 'Teammate', role, roleLabel: ROLE_LABEL[role], note: ROLE_BLURB[role], masterOnly: MASTER_ONLY_ROLES.includes(role) })
  }
  targets.sort((a, b) => (RANK[b.role] - RANK[a.role]) || a.name.localeCompare(b.name))
  return { ok: true, targets }
}
