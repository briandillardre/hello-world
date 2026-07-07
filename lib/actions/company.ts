'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'

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
  await service.from('companies').update({ weather_place: trimmed }).eq('id', companyId)
  revalidatePath('/map')
  revalidatePath('/command')
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
