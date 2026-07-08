'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import type { Role } from '@/lib/db/team'

const ROLES: Role[] = ['admin', 'foreman', 'viewer']

/** Resolve caller → { userId, companyId, isAdmin } using the anon client. */
async function ctx() {
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('profiles').select('company_id, role, name, email').eq('id', user.id).single()
  const companyId = me?.company_id ?? user.id
  const isAdmin = me?.role === 'admin' || user.id === companyId
  return { userId: user.id, companyId, isAdmin, name: me?.name ?? '', email: me?.email ?? user.email ?? '' }
}

export interface InviteInfo { valid: boolean; companyName?: string; role?: Role; reason?: string }

/** Public: describe an invite token for the join screen (service role read). */
export async function getInviteInfoAction(token: string): Promise<InviteInfo> {
  if (!token) return { valid: false, reason: 'Missing invite link.' }
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { data: inv } = await svc.from('invites').select('company_id, role, accepted_at, expires_at').eq('token', token).maybeSingle()
    if (!inv) return { valid: false, reason: 'This invite link is invalid.' }
    if (inv.accepted_at) return { valid: false, reason: 'This invite has already been used.' }
    if (new Date(inv.expires_at).getTime() < Date.now()) return { valid: false, reason: 'This invite has expired.' }
    const { data: co } = await svc.from('companies').select('name').eq('id', inv.company_id).single()
    return { valid: true, companyName: co?.name ?? 'a company', role: inv.role as Role }
  } catch {
    return { valid: false, reason: 'Could not read this invite.' }
  }
}

/** Admin: create an invite, return its token so the client can build a link. */
export async function createInviteAction(email: string, role: Role): Promise<{ token: string } | { error: string }> {
  const c = await ctx()
  if (!c) return { error: 'Not signed in.' }
  if (!c.isAdmin) return { error: 'Only admins can invite teammates.' }
  const safeRole: Role = ROLES.includes(role) ? role : 'viewer'
  const token = randomBytes(24).toString('base64url')
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { error } = await createServiceClient().from('invites').insert({
      company_id: c.companyId, email: email.trim() || null, role: safeRole, token, created_by: c.userId,
    })
    if (error) { console.error('invite create failed', error); return { error: 'Could not create the invite. Is migration 010 applied?' } }
    revalidatePath('/team')
    return { token }
  } catch { return { error: 'Could not create the invite.' } }
}

export async function revokeInviteAction(id: string): Promise<boolean> {
  const c = await ctx()
  if (!c?.isAdmin) return false
  const { createServiceClient } = await import('@/lib/supabase-server')
  await createServiceClient().from('invites').delete().eq('id', id).eq('company_id', c.companyId)
  revalidatePath('/team')
  return true
}

/** The joining user (already authenticated) accepts an invite: their profile is
 *  (re)written to the invited company + role via the service role, after the
 *  token is validated — so company membership can't be self-assigned. */
export async function acceptInviteAction(token: string): Promise<{ ok: boolean; error?: string }> {
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sign in first, then open the invite link again.' }

  const svc = createServiceClient()
  const { data: inv } = await svc.from('invites').select('id, company_id, role, accepted_at, expires_at').eq('token', token).maybeSingle()
  if (!inv) return { ok: false, error: 'Invalid invite.' }
  if (inv.accepted_at) return { ok: false, error: 'This invite was already used.' }
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, error: 'This invite has expired.' }

  const { error: upErr } = await svc.from('profiles').upsert({
    id: user.id,
    company_id: inv.company_id,
    role: inv.role,
    name: (user.user_metadata?.name as string) || user.email?.split('@')[0] || 'Teammate',
    email: user.email ?? null,
  }, { onConflict: 'id' })
  if (upErr) { console.error('accept upsert failed', upErr); return { ok: false, error: 'Could not join the team.' } }

  await svc.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id)
  revalidatePath('/team')
  return { ok: true }
}

export async function updateMemberRoleAction(memberId: string, role: Role): Promise<boolean> {
  const c = await ctx()
  if (!c?.isAdmin) return false
  if (!ROLES.includes(role)) return false
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  // Don't strip the last admin.
  if (role !== 'admin') {
    const { count } = await svc.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', c.companyId).eq('role', 'admin')
    const { data: target } = await svc.from('profiles').select('role').eq('id', memberId).single()
    if ((count ?? 0) <= 1 && target?.role === 'admin') return false
  }
  await svc.from('profiles').update({ role }).eq('id', memberId).eq('company_id', c.companyId)
  revalidatePath('/team')
  return true
}

export async function removeMemberAction(memberId: string): Promise<boolean> {
  const c = await ctx()
  if (!c?.isAdmin) return false
  if (memberId === c.userId) return false // can't remove yourself here
  const { createServiceClient } = await import('@/lib/supabase-server')
  await createServiceClient().from('profiles').delete().eq('id', memberId).eq('company_id', c.companyId)
  revalidatePath('/team')
  return true
}
