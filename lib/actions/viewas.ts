'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getRealPermissions, VIEW_AS_COOKIE } from '@/lib/permissions-server'
import { outranks, normalizeRole } from '@/lib/permissions'

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
  if (!outranks(me, { role: normalizeRole(target.role, 'associate'), isMaster: targetIsMaster })) {
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
