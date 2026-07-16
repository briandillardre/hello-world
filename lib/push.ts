/**
 * Native push send — theft/critical alerts to the phone's lock screen.
 * Server-only, and OPTIONAL: with no Firebase creds set it no-ops (exactly like
 * the Twilio SMS path), so nothing breaks before Brian sets up Firebase.
 *
 * Set FCM_SERVER_KEY (Firebase → Project Settings → Cloud Messaging → Server
 * key) to enable. iOS tokens are delivered through the same FCM key once APNs
 * is configured in Firebase. HTTP v1 (service-account OAuth) is the modern path
 * if/when the legacy key is unavailable — swap `send()` then; the token
 * plumbing and call sites stay the same.
 */

interface PushMsg { title: string; body: string }

async function fcmSend(serverKey: string, tokens: string[], msg: PushMsg): Promise<number> {
  let ok = 0
  // Legacy FCM accepts up to 1000 registration_ids per multicast call.
  for (let i = 0; i < tokens.length; i += 1000) {
    const batch = tokens.slice(i, i + 1000)
    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: { Authorization: `key=${serverKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          registration_ids: batch,
          notification: { title: msg.title, body: msg.body, sound: 'default' },
          priority: 'high',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) { const j = await res.json().catch(() => null); ok += j?.success ?? batch.length }
    } catch { /* one batch failing must not stop the rest */ }
  }
  return ok
}

/**
 * Push a batch of alerts to every registered device in a company. Critical
 * alerts lead with the THEFT framing. Returns the number of pushes delivered
 * (0 when unconfigured or no devices).
 */
export async function sendPushToCompany(
  companyId: string,
  companyName: string,
  alerts: { reason: string; severity: 'critical' | 'warning' | 'info' }[]
): Promise<number> {
  const serverKey = process.env.FCM_SERVER_KEY
  if (!serverKey || !alerts.length) return 0
  try {
    const { createServiceClient } = await import('./supabase-server')
    const db = createServiceClient()
    const { data: rows } = await db.from('device_tokens').select('token').eq('company_id', companyId)
    const tokens = (rows ?? []).map((r) => r.token as string).filter(Boolean)
    if (!tokens.length) return 0

    let sent = 0
    for (const a of alerts) {
      const critical = a.severity === 'critical'
      sent += await fcmSend(serverKey, tokens, {
        title: critical ? '🚨 THEFT ALERT' : a.severity === 'warning' ? 'HammerTrack Alert' : 'HammerTrack',
        body: a.reason,
      })
    }
    return sent
  } catch {
    return 0 // push is best-effort
  }
}
