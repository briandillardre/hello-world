'use server'

import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { normalizeRole, outranks, type Role } from '@/lib/permissions'
import { isDriverClass, type DriverClass } from '@/lib/short-haul'

/**
 * Who drives a commercial vehicle (migration 126) — the switch that puts a
 * person on the DOT short-haul records. A company record, so it takes the
 * team ability, and strictly DOWN the ladder (docs/ROLES.md): you can set
 * yourself or someone you outrank. `profiles` is write-locked for sessions
 * (068), so the write goes through the service role after those checks.
 * View-as is read-only.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function setDriverClassAction(
  targetUserId: string,
  driverClass: DriverClass | null,
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  if (driverClass !== null && !isDriverClass(driverClass)) return { ok: false, error: 'Unknown driver type.' }

  const me = await getMyPermissions()
  if (me.viewingAs) return { ok: false, error: 'You are previewing as someone else. Exit the preview to change this.' }
  if (!me.canManageTeam) return { ok: false, error: 'Only someone who manages the team can set this.' }
  const companyId = await getCurrentCompanyId()
  if (!companyId) return { ok: false, error: 'No company.' }

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return { ok: false, error: 'Sign in first.' }

  const db = createServiceClient()
  const { data: target } = await db.from('profiles')
    .select('id, role').eq('id', targetUserId).eq('company_id', companyId).maybeSingle()
  if (!target) return { ok: false, error: 'That person is not on this team.' }
  const isMaster = targetUserId === companyId
  const role: Role = isMaster ? 'admin' : normalizeRole((target as { role: string | null }).role, 'associate')
  if (role === 'prospect') return { ok: false, error: 'A Prospective Client is not a driver.' }
  if (targetUserId !== user.id && !outranks(me, { role, isMaster })) {
    return { ok: false, error: 'Only someone above them on the team can change this.' }
  }

  const { error } = await db.from('profiles').update({ driver_class: driverClass }).eq('id', targetUserId).eq('company_id', companyId)
  if (error) {
    console.error('driver class save failed', error.message)
    return { ok: false, error: error.code === '42703' ? 'The database is still updating — try again in a few minutes.' : 'Could not save that. Try again in a minute.' }
  }
  revalidatePath('/timecards/short-haul')
  return { ok: true }
}
