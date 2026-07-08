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

async function postWebhook(payload: unknown): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) return
  try {
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
  alerts: AlertMessage[]
): Promise<number> {
  if (!alerts.length) return 0
  const smsTo = recipients.phone || process.env.ALERT_SMS_TO
  let smsSent = 0

  await postWebhook({ company: companyName, alerts, at: new Date().toISOString() })

  if (smsTo) {
    for (const a of alerts) {
      if (a.severity !== 'critical') continue
      await sendSms(smsTo, `HammerTrack: ${a.reason}`)
      smsSent++
    }
  }
  return smsSent
}
