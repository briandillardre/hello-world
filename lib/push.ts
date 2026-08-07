/**
 * Native push send — theft/critical alerts to the phone's lock screen.
 * Server-only, and OPTIONAL: with no Firebase creds set it no-ops (exactly like
 * the Twilio SMS path), so nothing breaks before Firebase is configured.
 *
 * FCM HTTP v1 (the only API new Firebase projects get — Google retired the
 * legacy server key in 2024): set FCM_SERVICE_ACCOUNT to the FULL JSON of a
 * Firebase service-account key (Project settings → Service accounts →
 * Generate new private key). We mint the OAuth token ourselves with
 * node:crypto — no google SDK in the bundle. FCM_SERVER_KEY (legacy) still
 * works as a fallback for old projects.
 */

import { createSign } from 'crypto'

interface PushMsg { title: string; body: string }

// ── FCM v1: service-account JWT → OAuth token (cached ~55 min) ─────────────
interface SvcAccount { project_id: string; client_email: string; private_key: string }

let cachedToken: { token: string; exp: number } | null = null

function readServiceAccount(): SvcAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const j = JSON.parse(raw)
    if (j.project_id && j.client_email && j.private_key) return j as SvcAccount
  } catch { /* malformed env — treat as unconfigured */ }
  return null
}

async function getAccessToken(sa: SvcAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token
  try {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const j = await res.json()
    if (!j.access_token) return null
    cachedToken = { token: j.access_token, exp: now + Math.min(3500, j.expires_in ?? 3500) }
    return j.access_token
  } catch {
    return null
  }
}

/** v1 sends are one token per request — fired in parallel batches of 25. */
async function fcmSendV1(sa: SvcAccount, tokens: string[], msg: PushMsg): Promise<number> {
  const access = await getAccessToken(sa)
  if (!access) return 0
  let ok = 0
  for (let i = 0; i < tokens.length; i += 25) {
    const results = await Promise.all(tokens.slice(i, i + 25).map(async (token) => {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${access}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: msg.title, body: msg.body },
              android: { priority: 'HIGH', notification: { sound: 'default' } },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        })
        return res.ok ? 1 : 0
      } catch {
        return 0 // one device failing must not stop the rest
      }
    }))
    ok += results.reduce((s: number, r) => s + r, 0)
  }
  return ok
}

// ── Legacy fallback (pre-2024 projects with a server key) ──────────────────
async function fcmSendLegacy(serverKey: string, tokens: string[], msg: PushMsg): Promise<number> {
  let ok = 0
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

function pushConfigured(): boolean {
  return !!(process.env.FCM_SERVICE_ACCOUNT || process.env.FCM_SERVER_KEY)
}

async function fcmSend(tokens: string[], msg: PushMsg): Promise<number> {
  const sa = readServiceAccount()
  if (sa) return fcmSendV1(sa, tokens, msg)
  const legacy = process.env.FCM_SERVER_KEY
  if (legacy) return fcmSendLegacy(legacy, tokens, msg)
  return 0
}

/**
 * Push to ONE person's devices (receipt chase pings the cardholder, not the
 * whole company). No user mapped — or the user has no registered device —
 * falls back to every company device so the ping still lands somewhere.
 */
export async function sendPushToUser(
  companyId: string,
  userId: string | null,
  msg: PushMsg
): Promise<number> {
  if (!pushConfigured()) return 0
  try {
    const { createServiceClient } = await import('./supabase-server')
    const db = createServiceClient()
    let tokens: string[] = []
    if (userId) {
      const { data } = await db.from('device_tokens').select('token').eq('company_id', companyId).eq('user_id', userId)
      tokens = (data ?? []).map((r) => r.token as string).filter(Boolean)
    }
    if (!tokens.length) {
      const { data } = await db.from('device_tokens').select('token').eq('company_id', companyId)
      tokens = (data ?? []).map((r) => r.token as string).filter(Boolean)
    }
    if (!tokens.length) return 0
    return await fcmSend(tokens, msg)
  } catch {
    return 0
  }
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
  if (!pushConfigured() || !alerts.length) return 0
  try {
    const { createServiceClient } = await import('./supabase-server')
    const db = createServiceClient()
    const { data: rows } = await db.from('device_tokens').select('token').eq('company_id', companyId)
    const tokens = (rows ?? []).map((r) => r.token as string).filter(Boolean)
    if (!tokens.length) return 0

    let sent = 0
    for (const a of alerts) {
      const critical = a.severity === 'critical'
      sent += await fcmSend(tokens, {
        title: critical ? '🚨 THEFT ALERT' : a.severity === 'warning' ? 'HammerTrack Alert' : 'HammerTrack',
        body: a.reason,
      })
    }
    return sent
  } catch {
    return 0 // push is best-effort
  }
}
