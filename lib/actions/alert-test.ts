'use server'

import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'

export interface AlertTestResult {
  ok: boolean
  /** What to show the owner — success confirmation or the actual failure. */
  message: string
  /** Twilio message SID on success, for tracing in the Twilio console. */
  sid?: string
  /** Where we tried to send. */
  to?: string
}

/**
 * Prove the theft-alert delivery path end to end, on demand.
 *
 * Without this, the only way to know SMS works is to move a truck after hours
 * and hope — and if nothing arrives you can't tell whether the rule didn't
 * fire, the env vars are missing, or Twilio rejected the number. This runs the
 * SAME sender the real alert uses and reports Twilio's own error text.
 */
export async function sendTestAlertAction(): Promise<AlertTestResult> {
  // Same gate as editing company settings — this spends money and texts a
  // real phone, so it isn't a viewer-level button.
  const perms = await getMyPermissions()
  if (!perms.canManageTeam) {
    return { ok: false, message: 'You need admin rights to send a test alert.' }
  }

  const { notifyChannels, sendTestSms } = await import('@/lib/notify')
  const channels = notifyChannels()

  // Recipient: the company's alert phone, falling back to the env default —
  // exactly how dispatchAlerts picks it, so the test can't pass while the real
  // alert would go nowhere.
  let phone: string | null = null
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const { data } = await createClient()
      .from('companies').select('alert_phone').eq('id', companyId).single()
    phone = (data?.alert_phone as string | null) ?? null
  } catch { /* fall through to the env default */ }
  const to = phone || process.env.ALERT_SMS_TO || null

  if (!channels.sms) {
    return {
      ok: false,
      message: 'Twilio is not configured yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in Vercel, then redeploy.',
    }
  }
  if (!to) {
    return {
      ok: false,
      message: 'No recipient. Set "Alert phone" above (E.164, like +18645551234) or ALERT_SMS_TO in Vercel.',
    }
  }
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    return {
      ok: false,
      to,
      message: `"${to}" isn't in E.164 format — Twilio needs the country code, e.g. +18645551234.`,
    }
  }

  const r = await sendTestSms(to)
  return r.ok
    ? { ok: true, to, sid: r.sid, message: `Sent to ${to} from ${channels.from}. It should arrive within a few seconds.` }
    : { ok: false, to, message: r.error ?? 'Twilio rejected the message.' }
}
