'use server'

import { revalidatePath } from 'next/cache'
import { getMyPermissions, getRealPermissions } from '@/lib/permissions-server'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const MAX_SHIFT_MS = 24 * 3_600_000

/**
 * A manager corrects a time entry (forgot to clock out, wrong break, a shift
 * that ran past midnight). The ORIGINAL times are kept beside the corrected
 * ones with who / when / why (migration 103) — payroll can always see what
 * the phone recorded versus what the office decided. Managers = the Team or
 * Billing ability (payroll runs from here); crew cannot edit their own card.
 */
export async function adjustTimeEntryAction(input: {
  id: string
  clockInAt: string
  clockOutAt: string | null
  breakMinutes: number
  note: string
}): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  // Abilities from the EFFECTIVE permissions (a view-as preview is read-only,
  // 096); ids from the real session.
  const [eff, perms] = await Promise.all([getMyPermissions(), getRealPermissions()])
  if (!perms.userId || !perms.companyId) return { ok: false, error: 'Not signed in' }
  if (eff.viewingAs) return { ok: false, error: 'Read-only preview — exit View as to make changes.' }
  if (!(eff.canManageTeam || eff.canManageBilling)) return { ok: false, error: 'You need the Team or Billing ability to edit time cards.' }
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, error: 'Bad entry' }

  const inMs = Date.parse(input.clockInAt)
  const outMs = input.clockOutAt ? Date.parse(input.clockOutAt) : null
  if (!Number.isFinite(inMs)) return { ok: false, error: 'Clock-in time is not valid.' }
  if (outMs != null && !Number.isFinite(outMs)) return { ok: false, error: 'Clock-out time is not valid.' }
  if (outMs != null && outMs <= inMs) return { ok: false, error: 'Clock-out has to be after clock-in.' }
  if (outMs != null && outMs - inMs > MAX_SHIFT_MS) return { ok: false, error: 'A shift longer than 24 hours needs to be two entries.' }
  if (inMs > Date.now() + 5 * 60_000 || (outMs != null && outMs > Date.now() + 5 * 60_000)) return { ok: false, error: 'Times cannot be in the future.' }
  const breakMinutes = Math.round(Number(input.breakMinutes) || 0)
  if (breakMinutes < 0 || breakMinutes > 720) return { ok: false, error: 'Break is in minutes, 0–720.' }
  const note = String(input.note ?? '').trim().slice(0, 500)
  if (note.length < 3) return { ok: false, error: 'Say why in a few words — it stays on the record.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: cur, error: readErr } = await db.from('time_entries')
    .select('id, company_id, user_id, clock_in_at, clock_out_at, original_in_at, original_out_at')
    .eq('id', input.id).eq('company_id', perms.companyId).maybeSingle()
  if (readErr) return { ok: false, error: /column/i.test(readErr.message) ? 'Deploy the latest build first (migration 103).' : readErr.message }
  if (!cur) return { ok: false, error: 'Entry not found' }
  // Reopening a closed entry restarts the phone's recording for it — refuse
  // when the person already has another open shift (two open entries would
  // both count hours; clock-out closes only the newest).
  if (outMs == null && cur.clock_out_at) {
    const { count } = await db.from('time_entries').select('id', { count: 'exact', head: true })
      .eq('company_id', perms.companyId).eq('user_id', cur.user_id).is('clock_out_at', null)
    if ((count ?? 0) > 0) return { ok: false, error: 'This person already has an open shift — close that one before reopening this entry.' }
  }

  const patch: Record<string, unknown> = {
    clock_in_at: new Date(inMs).toISOString(),
    clock_out_at: outMs != null ? new Date(outMs).toISOString() : null,
    break_minutes: breakMinutes,
    edited_by: perms.userId,
    edited_at: new Date().toISOString(),
    edit_note: note,
    // The FIRST edit freezes what the phone recorded — both times together,
    // so an entry that was still open keeps original_out_at = null instead
    // of adopting the first correction as "recorded" (sec-check, Sep 9).
    ...(cur.original_in_at ? {} : { original_in_at: cur.clock_in_at, original_out_at: cur.clock_out_at }),
  }
  const { error } = await db.from('time_entries').update(patch).eq('id', input.id).eq('company_id', perms.companyId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/timecards'); revalidatePath('/logs'); revalidatePath('/clock')
  return { ok: true }
}
