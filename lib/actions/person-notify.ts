'use server'

import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { outranks } from '@/lib/permissions'
import { notifyRole, resolvePersonNotify, sparsePersonNotify, PUSH_KINDS, type PersonNotifyPrefs, type PushKind } from '@/lib/person-notify'

/**
 * Who gets a push, set per person (Brian, Sep 12: "the push need to be per
 * person and admins can go in to change this for people").
 *
 * Two doors, one write:
 *   • Yourself — always. Nobody needs permission to quiet their own phone,
 *     including an Associate whose role has no other settings at all.
 *   • Somebody else — only if you outrank them (docs/ROLES.md) AND hold the
 *     team ability. Strictly DOWN the ladder, like every other rule here.
 *
 * `profiles` is write-locked for sessions (068), so the write itself goes
 * through the service role after those checks. View-as is read-only, so a
 * previewing admin cannot change anyone's phone.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface PersonNotifyResult {
  ok: boolean
  error?: string
  prefs?: PersonNotifyPrefs
}

export async function savePersonNotifyAction(
  targetUserId: string,
  patch: Partial<Record<PushKind, boolean>>,
): Promise<PersonNotifyResult> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }

  const me = await getMyPermissions()
  if (me.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  const companyId = await getCurrentCompanyId()
  if (!companyId) return { ok: false, error: 'No company.' }

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return { ok: false, error: 'Sign in first.' }

  const db = createServiceClient()
  const { data: target } = await db.from('profiles')
    .select('id, role, notify_prefs').eq('id', targetUserId).eq('company_id', companyId).maybeSingle()
  if (!target) return { ok: false, error: 'That person is not on this team.' }

  const role = notifyRole(targetUserId, companyId, (target as { role: string | null }).role)
  const isSelf = targetUserId === user.id
  if (!isSelf) {
    if (!me.canManageTeam || !outranks(me, { role, isMaster: targetUserId === companyId })) {
      return { ok: false, error: 'Only someone above them on the team can change this.' }
    }
  }

  // SPARSE on disk: only the switches somebody actually set, so an untouched
  // key keeps following the role default (a promoted Foreman starts getting
  // the nag without anyone editing their phone). `_by` / `_at` say who last
  // touched it — an admin may silence a subordinate's theft alerts, but the
  // person sees on their own card that it happened.
  const stored = sparsePersonNotify((target as { notify_prefs: unknown }).notify_prefs, patch)
  const blob = { ...stored, _by: user.id, _at: new Date().toISOString() }
  const next = resolvePersonNotify(stored, role)

  const { error } = await db.from('profiles').update({ notify_prefs: blob }).eq('id', targetUserId).eq('company_id', companyId)
  if (error) {
    console.error('person notify save failed', error.message)
    return { ok: false, error: 'Could not save that. Try again in a minute.' }
  }
  revalidatePath('/settings')
  revalidatePath('/settings/phone')
  revalidatePath('/team')
  return { ok: true, prefs: next }
}

/** Mute this phone entirely — every kind off, one tap. */
export async function mutePersonPushAction(targetUserId: string): Promise<PersonNotifyResult> {
  const off = Object.fromEntries(PUSH_KINDS.map((k) => [k, false])) as Record<PushKind, boolean>
  return savePersonNotifyAction(targetUserId, off)
}
