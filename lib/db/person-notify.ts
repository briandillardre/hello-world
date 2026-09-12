import { getCurrentCompanyId } from './company'
import {
  defaultPersonNotify, personNotifyMeta, notifyRole, resolvePersonNotify,
  type PersonNotifyPrefs,
} from '../person-notify'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface MyPushPrefs {
  userId: string
  prefs: PersonNotifyPrefs
  /** Set when somebody ELSE last changed these switches (107 `_by`/`_at`). */
  changedBy: { name: string; at: string | null } | null
}

/**
 * My own phone switches, for the card that every role can reach.
 *
 * `profiles` is write-locked for sessions (068) and RLS-filtered for reads,
 * so this goes through the service client after resolving the caller from
 * their session — the row it reads is always the caller's own.
 */
export async function loadMyPushPrefs(): Promise<MyPushPrefs | null> {
  if (isMock) return { userId: 'you', prefs: defaultPersonNotify('admin'), changedBy: null }
  try {
    const companyId = await getCurrentCompanyId()
    if (!companyId) return null
    const { createClient, createServiceClient } = await import('../supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    if (!user) return null
    const db = createServiceClient()
    const { data: row } = await db.from('profiles')
      .select('role, notify_prefs').eq('id', user.id).eq('company_id', companyId).maybeSingle()
    const p = row as { role: string | null; notify_prefs: unknown } | null
    const prefs = resolvePersonNotify(p?.notify_prefs, notifyRole(user.id, companyId, p?.role ?? null))
    const meta = personNotifyMeta(p?.notify_prefs)

    // Somebody above me set this — say so. An admin silencing a subordinate's
    // theft alerts is allowed, but it must never be invisible to them.
    let changedBy: MyPushPrefs['changedBy'] = null
    if (meta.by && meta.by !== user.id) {
      const { data: who } = await db.from('profiles')
        .select('name').eq('id', meta.by).eq('company_id', companyId).maybeSingle()
      const name = ((who as { name: string | null } | null)?.name || 'An admin').split(' ')[0]
      changedBy = { name, at: meta.at }
    }
    return { userId: user.id, prefs, changedBy }
  } catch {
    return null // the card just doesn't render
  }
}
