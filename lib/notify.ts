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

async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) return
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64')
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    })
    if (!res.ok) console.error('Twilio SMS failed', res.status, await res.text().catch(() => ''))
  } catch (err) {
    console.error('Twilio SMS error', err)
  }
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
  const smsTo = recipients.phone || process.env.ALERT_SMS_TO
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
      await sendSms(smsTo, `HammerTrack: ${a.reason}`)
      smsSent++
    }
  }
  return smsSent
}
