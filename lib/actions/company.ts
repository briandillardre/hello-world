'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'

/** Admin-guarded helper: resolve companyId + confirm the caller can write it. */
async function requireAdminCompany(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  const companyId = profile?.company_id ?? user.id
  const isAdmin = profile?.role === 'admin' || user.id === companyId
  return isAdmin ? companyId : null
}

/**
 * Update editable company settings — name and working hours. Work hours drive
 * the after-hours theft alert, so they matter operationally, not just cosmetic.
 * Returns false on failure (e.g. not admin, DB error) so the UI can surface it.
 */
export async function updateCompanySettingsAction(input: {
  name?: string
  work_start?: string
  work_end?: string
  work_days?: number[]
  alert_phone?: string
  alert_email?: string
}): Promise<boolean> {
  const companyId = await requireAdminCompany()
  if (!companyId) return false

  const patch: Record<string, unknown> = {}
  if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim().slice(0, 120)
  if (/^\d{2}:\d{2}$/.test(input.work_start ?? '')) patch.work_start = input.work_start
  if (/^\d{2}:\d{2}$/.test(input.work_end ?? '')) patch.work_end = input.work_end
  if (Array.isArray(input.work_days)) patch.work_days = input.work_days.filter((d) => d >= 0 && d <= 6)
  if (typeof input.alert_phone === 'string') patch.alert_phone = input.alert_phone.trim().slice(0, 32) || null
  if (typeof input.alert_email === 'string') patch.alert_email = input.alert_email.trim().slice(0, 160) || null
  if (Object.keys(patch).length === 0) return false

  const { createServiceClient } = await import('@/lib/supabase-server')
  const { error } = await createServiceClient().from('companies').update(patch).eq('id', companyId)
  if (error) { console.error('company settings update failed', error); return false }
  revalidatePath('/settings')
  revalidatePath('/map')
  revalidatePath('/alerts')
  return true
}

/**
 * Persist the company-wide default weather location (admin only).
 * Verified server-side; written with the service client because 001 gave
 * companies no UPDATE policy for the anon role (008 adds one, but service
 * write keeps this working even before that migration runs).
 */
export async function setWeatherDefaultAction(place: string) {
  const trimmed = place.trim().slice(0, 120)
  if (!trimmed) return

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  const companyId = profile?.company_id ?? user.id
  const isAdmin = profile?.role === 'admin' || user.id === companyId
  if (!isAdmin) return

  const service = createServiceClient()
  const { error } = await service.from('companies').update({ weather_place: trimmed }).eq('id', companyId)
  if (error) {
    // Most likely cause: migration 008 (weather_place column) not applied yet.
    console.error('weather default save failed', error)
    return false
  }
  revalidatePath('/map')
  revalidatePath('/command')
  return true
}

export async function clearWeatherDefaultAction() {
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && user.id !== companyId) return

  const service = createServiceClient()
  await service.from('companies').update({ weather_place: null }).eq('id', companyId)
  revalidatePath('/map')
}
