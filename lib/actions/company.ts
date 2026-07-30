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
  /** Admin actively ticked the SMS consent box for this exact number. */
  sms_consent?: boolean
}): Promise<boolean> {
  const companyId = await requireAdminCompany()
  if (!companyId) return false

  const patch: Record<string, unknown> = {}
  if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim().slice(0, 120)
  if (/^\d{2}:\d{2}$/.test(input.work_start ?? '')) patch.work_start = input.work_start
  if (/^\d{2}:\d{2}$/.test(input.work_end ?? '')) patch.work_end = input.work_end
  if (Array.isArray(input.work_days)) patch.work_days = input.work_days.filter((d) => d >= 0 && d <= 6)
  if (typeof input.alert_phone === 'string') {
    const phone = input.alert_phone.trim().slice(0, 32) || null
    patch.alert_phone = phone
    // Consent is a RECORD, not just a UI gate — carriers can ask who agreed,
    // for which number, and when. It's tied to the specific number, so a new
    // number needs a new tick and clearing the phone clears the record.
    if (!phone) {
      patch.sms_consent_at = null
      patch.sms_consent_by = null
      patch.sms_consent_phone = null
    } else if (input.sms_consent) {
      const { createClient } = await import('@/lib/supabase-server')
      const { data: { user } } = await createClient().auth.getUser()
      patch.sms_consent_at = new Date().toISOString()
      patch.sms_consent_by = user?.id ?? null
      patch.sms_consent_phone = phone
    }
  }
  if (typeof input.alert_email === 'string') patch.alert_email = input.alert_email.trim().slice(0, 160) || null
  if (Object.keys(patch).length === 0) return false

  const { createServiceClient } = await import('@/lib/supabase-server')
  let { error } = await createServiceClient().from('companies').update(patch).eq('id', companyId)
  // 42703 = consent columns missing (migration 041 not applied yet). Retry
  // without them so saving settings never breaks on a lagging database.
  if (error?.code === '42703') {
    for (const k of ['sms_consent_at', 'sms_consent_by', 'sms_consent_phone']) delete patch[k]
    ;({ error } = await createServiceClient().from('companies').update(patch).eq('id', companyId))
  }
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
export async function setWeatherDefaultAction(place: string, lat?: number, lng?: number) {
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

  // Store exact coords alongside the name (JSON in the same TEXT column) so
  // every device resolves the SAME point — re-geocoding just the name picked
  // the wrong Greenville (NC outranks SC by population).
  const value = typeof lat === 'number' && typeof lng === 'number'
    ? JSON.stringify({ name: trimmed, lat, lng })
    : trimmed

  const service = createServiceClient()
  const { error } = await service.from('companies').update({ weather_place: value }).eq('id', companyId)
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

/**
 * Fire a TEST theft alert through the REAL delivery pipeline (Twilio SMS +
 * webhook) so the wiring can be proven any time — not at 2 AM when a truck
 * actually moves. Returns an honest report of what was and wasn't configured.
 */
export async function sendTestAlertAction(): Promise<{
  ok: boolean
  smsAttempted: boolean
  smsTo: string | null
  twilioConfigured: boolean
  webhookConfigured: boolean
  error?: string
}> {
  const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
  const webhookConfigured = !!process.env.NOTIFY_WEBHOOK_URL
  const companyId = await requireAdminCompany()
  if (!companyId) return { ok: false, smsAttempted: false, smsTo: null, twilioConfigured, webhookConfigured, error: 'Admins only.' }

  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: co } = await createClient()
      .from('companies').select('*').eq('id', companyId).maybeSingle() // star: survives pre-009 DBs

    const { dispatchAlerts } = await import('@/lib/notify')
    const smsTo = co?.alert_phone || process.env.ALERT_SMS_TO || null
    const sent = await dispatchAlerts(co?.name ?? 'HammerTrack', { phone: co?.alert_phone }, [{
      severity: 'critical',
      reason: `TEST ALERT — this is what an after-hours theft alert looks like. Reply STOP never; reply nothing; it's just ${co?.name ?? 'your'} HammerTrack test. ✅`,
    }])
    return { ok: true, smsAttempted: sent > 0, smsTo, twilioConfigured, webhookConfigured }
  } catch (e) {
    return { ok: false, smsAttempted: false, smsTo: null, twilioConfigured, webhookConfigured, error: e instanceof Error ? e.message : 'Failed.' }
  }
}
