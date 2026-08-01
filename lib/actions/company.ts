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
    // Accept human formatting — "(864) 915-2351", "864-915-2351" — and store
    // E.164, which is what Twilio dials. A non-empty entry that can't be
    // normalized fails the save rather than storing a number that will bounce
    // with error 21211 on the first real alert.
    const rawPhone = input.alert_phone.trim().slice(0, 32)
    const { normalizeUsPhone } = await import('@/lib/phone')
    const phone = rawPhone ? normalizeUsPhone(rawPhone) : null
    if (rawPhone && !phone) return false
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
 * Upload (or clear) the company logo — shown at the top of the sidebar and on
 * every PDF the app generates. Stored in the public asset-photos bucket under
 * the company id; pass an empty FormData (no `logo` file) to remove it.
 */
/** Weekly digest schedule (Friday recap / Sunday week-ahead) — Settings card. */
export async function saveDigestPrefsAction(prefs: {
  friday: { enabled: boolean; email: boolean; sms: boolean; hour: number }
  sunday: { enabled: boolean; hour: number }
  tz: string
}): Promise<{ ok: boolean; error?: string }> {
  const companyId = await requireAdminCompany()
  if (!companyId) return { ok: false, error: 'Admins only.' }
  const hour = (h: number, fallback: number) => Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback
  const clean = {
    friday: { enabled: !!prefs.friday?.enabled, email: !!prefs.friday?.email, sms: !!prefs.friday?.sms, hour: hour(prefs.friday?.hour, 16) },
    sunday: { enabled: !!prefs.sunday?.enabled, hour: hour(prefs.sunday?.hour, 18) },
    tz: typeof prefs.tz === 'string' && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(prefs.tz) ? prefs.tz : 'America/New_York',
  }
  const { createClient } = await import('@/lib/supabase-server')
  const { error } = await createClient().from('companies').update({ digest_prefs: clean }).eq('id', companyId)
  if (error) return { ok: false, error: 'Save failed — run migration 047 in the Supabase SQL Editor first.' }
  revalidatePath('/settings')
  return { ok: true }
}

export async function saveCompanyLogoAction(form: FormData): Promise<{ ok: boolean; url?: string | null; error?: string }> {
  const companyId = await requireAdminCompany()
  if (!companyId) return { ok: false, error: 'Admins only.' }

  const file = form.get('logo')
  let url: string | null = null
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith('image/')) return { ok: false, error: 'That file is not an image.' }
    if (file.size > 2 * 1024 * 1024) return { ok: false, error: 'Keep the logo under 2 MB.' }
    try {
      const { createServiceClient } = await import('@/lib/supabase-server')
      const supabase = createServiceClient()
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/svg+xml' ? 'svg' : 'jpg'
      const path = `${companyId}/logo-${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from('asset-photos')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (error) return { ok: false, error: error.message }
      url = supabase.storage.from('asset-photos').getPublicUrl(path).data.publicUrl
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' }
    }
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const { error } = await createServiceClient().from('companies').update({ logo_url: url }).eq('id', companyId)
  if (error) {
    // Pre-044 schema — tell the truth instead of pretending it saved.
    return { ok: false, error: 'Database migration 044 has not applied yet — redeploy and try again.' }
  }
  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { ok: true, url }
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
  /** Twilio's own rejection text when a configured send still fails. */
  smsError?: string
}> {
  const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
  const webhookConfigured = !!process.env.NOTIFY_WEBHOOK_URL
  const companyId = await requireAdminCompany()
  if (!companyId) return { ok: false, smsAttempted: false, smsTo: null, twilioConfigured, webhookConfigured, error: 'Admins only.' }

  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data: co } = await createClient()
      .from('companies').select('*').eq('id', companyId).maybeSingle() // star: survives pre-009 DBs

    const { dispatchAlerts, sendTestSms } = await import('@/lib/notify')
    const smsTo = co?.alert_phone || process.env.ALERT_SMS_TO || null
    // Catch the most common self-inflicted failure before spending a message:
    // a number typed without the country code. Twilio answers 21211 for this,
    // which is not obvious from the console.
    // Normalize instead of rejecting — a pre-fix row may hold "8649152351",
    // and the human already told us the number once; don't make them re-learn
    // a phone format to run a test.
    const { normalizeUsPhone } = await import('@/lib/phone')
    const smsToNorm = smsTo ? normalizeUsPhone(smsTo) : null
    if (smsTo && !smsToNorm) {
      return {
        ok: false, smsAttempted: false, smsTo, twilioConfigured, webhookConfigured,
        error: `"${smsTo}" doesn't look like a phone number — re-enter it in Settings as a 10-digit US number.`,
      }
    }
    const sent = await dispatchAlerts(co?.name ?? 'HammerTrack', { phone: co?.alert_phone }, [{
      severity: 'critical',
      reason: `TEST ALERT — this is what an after-hours theft alert looks like. Reply STOP never; reply nothing; it's just ${co?.name ?? 'your'} HammerTrack test. ✅`,
    }])
    // Configured, addressed, and still nothing sent = Twilio rejected it.
    // Ask once more through the same sender to capture WHY — "no SMS sent"
    // with no reason is the state that wastes an evening. Only runs in the
    // failure case, where nothing was delivered anyway.
    let smsError: string | undefined
    if (twilioConfigured && smsTo && sent === 0) {
      smsError = (await sendTestSms(smsTo)).error
    }
    return { ok: true, smsAttempted: sent > 0, smsTo, twilioConfigured, webhookConfigured, smsError }
  } catch (e) {
    return { ok: false, smsAttempted: false, smsTo: null, twilioConfigured, webhookConfigured, error: e instanceof Error ? e.message : 'Failed.' }
  }
}
