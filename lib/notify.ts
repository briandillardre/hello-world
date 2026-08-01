/**
 * Outbound alert delivery — SMS (Twilio) + generic webhook. Everything is
 * gated on env vars, so with nothing configured this is a silent no-op and the
 * app behaves exactly as before. Adding the Twilio vars turns the after-hours
 * theft alert into a real text — no code change.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM   — SMS sender
 *   ALERT_SMS_TO                                          — fallback recipient
 *   NOTIFY_WEBHOOK_URL                                    — POST alerts anywhere
 */

interface AlertMessage {
  reason: string
  severity: 'critical' | 'warning' | 'info'
}

interface Recipients {
  phone?: string | null
  email?: string | null
}

export interface SmsResult {
  ok: boolean
  /** Human-readable reason a send didn't happen or failed. */
  error?: string
  /** Twilio message SID on success — paste it into the Twilio console to trace. */
  sid?: string
}

/**
 * Send one SMS and SAY WHAT HAPPENED. The old version returned void and only
 * console.error'd, so a misconfigured Twilio account looked identical to a
 * quiet night — you'd sit waiting for a theft text that was never going to
 * arrive. The caller decides whether anyone sees the reason.
 */
async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  const missing = [
    !sid && 'TWILIO_ACCOUNT_SID',
    !token && 'TWILIO_AUTH_TOKEN',
    !from && 'TWILIO_FROM',
  ].filter(Boolean)
  if (missing.length) return { ok: false, error: `Not configured — missing ${missing.join(', ')} in the hosting env.` }
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64')
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from as string, Body: body }).toString(),
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      console.error('Twilio SMS failed', res.status, text)
      // Twilio returns {code, message, more_info} — the code is the whole
      // diagnosis (21608 = unverified number on a trial, 21606 = bad From,
      // 30034 = unregistered A2P). Surface it verbatim rather than "failed".
      let detail = text.slice(0, 300)
      try {
        const j = JSON.parse(text) as { code?: number; message?: string }
        if (j.message) detail = j.code ? `${j.message} (Twilio code ${j.code})` : j.message
      } catch { /* keep the raw body */ }
      return { ok: false, error: `Twilio ${res.status}: ${detail}` }
    }
    let msgSid: string | undefined
    try { msgSid = (JSON.parse(text) as { sid?: string }).sid } catch { /* optional */ }
    return { ok: true, sid: msgSid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error'
    console.error('Twilio SMS error', err)
    return { ok: false, error: `Could not reach Twilio: ${msg}` }
  }
}

/** Which delivery channels are actually wired up right now. */
export function notifyChannels(): { sms: boolean; webhook: boolean; from: string | null } {
  return {
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
    webhook: !!process.env.NOTIFY_WEBHOOK_URL,
    from: process.env.TWILIO_FROM ?? null,
  }
}

/**
 * Fire one deliberately-obvious alert down the real delivery path so the owner
 * can prove SMS works without waiting for a 2 AM theft. Same code as a genuine
 * critical alert — if this lands, the real one will too.
 */
export async function sendTestSms(to: string): Promise<SmsResult> {
  return sendSms(to, 'HammerTrack test alert — if you got this, theft alerts will reach you. No action needed.')
}

/** One arbitrary SMS down the same gated Twilio path (receipt-chase pings). */
export async function sendAlertSms(to: string, body: string): Promise<SmsResult> {
  return sendSms(to, body.slice(0, 320))
}

async function postWebhook(payload: { company: string; alerts: AlertMessage[]; at: string }): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) return
  try {
    // ntfy topics get real push notifications (title, priority, tap-through
    // to the live map) instead of a raw JSON blob. Anything else gets JSON.
    if (/(^|\/\/|\.)ntfy\./.test(url) || url.includes('ntfy.sh/')) {
      const { BRAND_URL } = await import('./brand')
      for (const a of payload.alerts) {
        const critical = a.severity === 'critical'
        // Header values must be ASCII — an emoji in Title makes fetch THROW
        // and the push silently never sends. ntfy renders the emoji from
        // Tags instead (rotating_light → 🚨 on the notification).
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Title: critical ? 'THEFT ALERT' : a.severity === 'warning' ? 'Alert' : 'Update',
            Priority: critical ? 'urgent' : 'default',
            Tags: critical ? 'rotating_light' : 'construction',
            Click: `${BRAND_URL}/map`,
          },
          body: `${a.reason}\n${payload.company}`,
        })
        if (!res.ok) console.error('ntfy push failed', res.status, await res.text().catch(() => ''))
      }
      return
    }
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  } catch (err) {
    console.error('Notify webhook error', err)
  }
}

/**
 * Deliver freshly-fired alerts. Only 'critical' events text a human (theft /
 * left-site) to avoid noise; everything is mirrored to the webhook if set.
 * Returns how many SMS were attempted.
 */
export async function dispatchAlerts(
  companyName: string,
  recipients: Recipients,
  alerts: AlertMessage[],
  companyId?: string
): Promise<number> {
  if (!alerts.length) return 0
  // Normalize at the point of dialing too — protects numbers stored before
  // the settings form normalized on save (e.g. a bare "8649152351").
  const { normalizeUsPhone } = await import('./phone')
  const smsTo = normalizeUsPhone(recipients.phone) || normalizeUsPhone(process.env.ALERT_SMS_TO)
  let smsSent = 0

  await postWebhook({ company: companyName, alerts, at: new Date().toISOString() })

  // Native push to the lock screen (no-op without Firebase creds / devices).
  if (companyId) {
    try {
      const { sendPushToCompany } = await import('./push')
      await sendPushToCompany(companyId, companyName, alerts)
    } catch { /* push is best-effort */ }
  }

  if (smsTo) {
    for (const a of alerts) {
      if (a.severity !== 'critical') continue
      // Count what actually SENT, not what we attempted — the return value is
      // reported by the ingest route, and an inflated count hid failures.
      const r = await sendSms(smsTo, `HammerTrack: ${a.reason}`)
      if (r.ok) smsSent++
    }
  }
  return smsSent
}
