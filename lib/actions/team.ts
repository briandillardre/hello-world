'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { ROLES, RANK, FEATURE_KEYS, normalizeRole, outranks, rolesEditableBy, type Role, type FeatureKey, type RolePolicy } from '@/lib/permissions'
import { getRealPermissions } from '@/lib/permissions-server'
import { assignableRolesFor } from '@/lib/db/team'

// Demo mode — no Supabase behind these actions; fail shaped, never throw a 500.
const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const DEMO_MSG = 'Demo mode — sign up to invite your crew.'

/**
 * Caller context for team writes — the REAL caller, never a view-as preview.
 * `isAdmin` = may manage people at all (Master, Admin, or the manage-team
 * switch); every write below still checks rank against the specific target.
 */
async function ctx() {
  const me = await getRealPermissions()
  if (!me.userId || !me.companyId) return null
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  const { data: prof } = await createClient().from('profiles').select('name, email').eq('id', me.userId).maybeSingle()
  return {
    userId: me.userId, companyId: me.companyId, me,
    isAdmin: me.isMaster || me.role === 'admin' || me.canManageTeam,
    name: prof?.name ?? '', email: prof?.email ?? user?.email ?? '',
  }
}

/** Load a target member and decide whether the caller outranks them. */
async function target(c: NonNullable<Awaited<ReturnType<typeof ctx>>>, memberId: string) {
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data } = await createServiceClient().from('profiles').select('id, company_id, role').eq('id', memberId).maybeSingle()
  if (!data || data.company_id !== c.companyId) return null
  const isMaster = data.id === c.companyId
  const role = isMaster ? 'admin' as Role : normalizeRole(data.role, 'associate')
  return { id: data.id, role, isMaster, manageable: outranks(c.me, { role, isMaster }) }
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
    return { valid: true, companyName: co?.name ?? 'a company', role: normalizeRole(inv.role, 'associate') }
  } catch {
    return { valid: false, reason: 'Could not read this invite.' }
  }
}

/** Create an invite for a role BELOW the caller's rank (the Master may
 *  invite Admins). With an email + RESEND_API_KEY the invite sends itself;
 *  the link is returned either way so the copy button always works. */
export async function createInviteAction(
  email: string,
  role: Role
): Promise<{ token: string; emailed: boolean; emailError?: string } | { error: string }> {
  if (isMock) return { error: DEMO_MSG }
  const c = await ctx()
  if (!c) return { error: 'Not signed in.' }
  if (!c.isAdmin) return { error: 'Only admins can invite teammates.' }
  const allowed = assignableRolesFor(c.me)
  const safeRole: Role = allowed.includes(role) ? role : 'associate'
  if (!allowed.includes(safeRole)) return { error: 'You can only invite people below your own level.' }
  const token = randomBytes(24).toString('base64url')
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const { error } = await svc.from('invites').insert({
      company_id: c.companyId, email: email.trim() || null, role: safeRole, token, created_by: c.userId,
    })
    if (error) { console.error('invite create failed', error); return { error: 'Could not create the invite. Is migration 010 applied?' } }
    revalidatePath('/team')

    let emailed = false
    let emailError: string | undefined
    const to = email.trim()
    if (to) {
      const { sendEmail, inviteEmailHtml, emailConfigured } = await import('@/lib/email')
      if (!emailConfigured()) {
        emailError = 'not configured'
      } else {
        const { data: co } = await svc.from('companies').select('name').eq('id', c.companyId).single()
        const { BRAND_URL } = await import('@/lib/brand')
        const res = await sendEmail(
          to,
          `You're invited to ${co?.name ?? 'a team'} on HammerTrack`,
          inviteEmailHtml({
            companyName: co?.name ?? 'the team',
            inviterName: c.name || c.email,
            role: safeRole,
            link: `${BRAND_URL}/join?token=${token}`,
          })
        )
        emailed = res.ok
        if (!res.ok) emailError = res.error
      }
    }
    return { token, emailed, emailError }
  } catch { return { error: 'Could not create the invite.' } }
}

/** (Re)send the email for an existing pending invite. */
export async function emailInviteAction(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: DEMO_MSG }
  const c = await ctx()
  if (!c?.isAdmin) return { ok: false, error: 'Only admins can send invites.' }
  const { sendEmail, inviteEmailHtml, emailConfigured } = await import('@/lib/email')
  if (!emailConfigured()) return { ok: false, error: 'Email sending is not set up yet (add RESEND_API_KEY in Vercel).' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: inv } = await svc.from('invites')
    .select('email, token, role, accepted_at, expires_at')
    .eq('id', inviteId).eq('company_id', c.companyId).maybeSingle()
  if (!inv) return { ok: false, error: 'Invite not found.' }
  if (!inv.email) return { ok: false, error: 'This invite has no email — copy the link instead.' }
  if (inv.accepted_at) return { ok: false, error: 'Already accepted.' }
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, error: 'This invite expired — create a new one.' }
  const { data: co } = await svc.from('companies').select('name').eq('id', c.companyId).single()
  const { BRAND_URL } = await import('@/lib/brand')
  const res = await sendEmail(
    inv.email,
    `You're invited to ${co?.name ?? 'a team'} on HammerTrack`,
    inviteEmailHtml({
      companyName: co?.name ?? 'the team',
      inviterName: c.name || c.email,
      role: normalizeRole(inv.role, 'associate'),
      link: `${BRAND_URL}/join?token=${inv.token}`,
    })
  )
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'Send failed.' }
}

export async function revokeInviteAction(id: string): Promise<boolean> {
  if (isMock) return false
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
  if (isMock) return { ok: false, error: DEMO_MSG }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sign in first, then open the invite link again.' }

  const svc = createServiceClient()
  const { data: inv } = await svc.from('invites').select('id, company_id, role, accepted_at, expires_at').eq('token', token).maybeSingle()
  if (!inv) return { ok: false, error: 'Invalid invite.' }
  if (inv.accepted_at) return { ok: false, error: 'This invite was already used.' }
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, error: 'This invite has expired.' }

  // Accepting an invite must NEVER downgrade an existing member of the same
  // company. The owner opened his own test invite while signed in and the
  // blind upsert turned the admin into a Foreman (Jul 16). Keep whichever
  // role is higher; joining a DIFFERENT company still takes the invite role.
  // The Master's row is never touched by an invite at all.
  let role: Role = normalizeRole(inv.role, 'associate')
  const { data: existing } = await svc.from('profiles').select('company_id, role').eq('id', user.id).maybeSingle()
  if (existing && existing.company_id === inv.company_id) {
    if (user.id === inv.company_id) return { ok: true }
    const mine = normalizeRole(existing.role, 'associate')
    if (RANK[mine] >= RANK[role]) role = mine
  }

  const { error: upErr } = await svc.from('profiles').upsert({
    id: user.id,
    company_id: inv.company_id,
    role,
    name: (user.user_metadata?.name as string) || user.email?.split('@')[0] || 'Teammate',
    email: user.email ?? null,
  }, { onConflict: 'id' })
  if (upErr) { console.error('accept upsert failed', upErr); return { ok: false, error: 'Could not join the team.' } }

  await svc.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id)
  revalidatePath('/team')
  return { ok: true }
}

/** Change a member's role. Rank rules: you must outrank the person now, and
 *  the new role must be one you may assign. The Master cannot be changed. */
export async function updateMemberRoleAction(memberId: string, role: Role): Promise<boolean> {
  if (isMock) return false
  const c = await ctx()
  if (!c?.isAdmin) return false
  if (!ROLES.includes(role)) return false
  const t = await target(c, memberId)
  if (!t || !t.manageable) return false
  if (!assignableRolesFor(c.me).includes(role)) return false
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  await svc.from('profiles').update({ role }).eq('id', memberId).eq('company_id', c.companyId)
  revalidatePath('/team')
  return true
}

export async function removeMemberAction(memberId: string): Promise<boolean> {
  if (isMock) return false
  const c = await ctx()
  if (!c?.isAdmin) return false
  if (memberId === c.userId) return false // can't remove yourself here
  const t = await target(c, memberId)
  if (!t || !t.manageable) return false
  const { createServiceClient } = await import('@/lib/supabase-server')
  await createServiceClient().from('profiles').delete().eq('id', memberId).eq('company_id', c.companyId)
  revalidatePath('/team')
  return true
}

/** Set a member's sensitive-info overrides (null = inherit role default).
 *  Admins' rows are left alone — the resolver ignores overrides for admins
 *  anyway, so there's no way to half-demote one here. */
export async function updateMemberOverridesAction(
  memberId: string,
  overrides: { can_view_costs?: boolean | null; can_manage_billing?: boolean | null; can_manage_team?: boolean | null }
): Promise<boolean> {
  if (isMock) return false
  const c = await ctx()
  if (!c?.isAdmin) return false
  const t = await target(c, memberId)
  if (!t || !t.manageable || t.role === 'admin') return false
  const patch: Record<string, boolean | null> = {}
  for (const k of ['can_view_costs', 'can_manage_billing', 'can_manage_team'] as const) {
    if (k in overrides) patch[k] = overrides[k] ?? null
  }
  if (Object.keys(patch).length === 0) return true
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { error } = await createServiceClient()
    .from('profiles')
    .update(patch)
    .eq('id', memberId)
    .eq('company_id', c.companyId)
  if (error) { console.error('override update failed (is migration 011 applied?)', error); return false }
  revalidatePath('/team')
  return true
}

/**
 * The view-levels table (094): flip one feature for one role, company-wide.
 * null = back to the default. The Master may edit every row incl. Admin;
 * Admins (and the manage-team switch) edit the rows below their own rank.
 */
export async function updateRolePolicyAction(role: Role, key: FeatureKey, value: boolean | null): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: DEMO_MSG }
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in.' }
  if (!ROLES.includes(role) || !FEATURE_KEYS.includes(key)) return { ok: false, error: 'Unknown setting.' }
  if (!rolesEditableBy(c.me).includes(role)) return { ok: false, error: 'You can only set view levels for roles below your own.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: co, error: readErr } = await svc.from('companies').select('role_policy').eq('id', c.companyId).maybeSingle()
  if (readErr) return { ok: false, error: 'View levels need migration 094 — try again after the next deploy.' }
  const policy: RolePolicy = { ...((co?.role_policy as RolePolicy | null) ?? {}) }
  const row = { ...(policy[role] ?? {}) }
  if (value === null) delete row[key]
  else row[key] = value
  if (Object.keys(row).length) policy[role] = row
  else delete policy[role]
  const { error } = await svc.from('companies').update({ role_policy: policy }).eq('id', c.companyId)
  if (error) { console.error('role policy update failed', error); return { ok: false, error: 'Could not save.' } }
  revalidatePath('/', 'layout')
  return { ok: true }
}
