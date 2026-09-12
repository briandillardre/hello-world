#!/usr/bin/env node
/**
 * Read-only probe of the app's state in the Play Console (Sep 12).
 *
 * Brian should not have to be my eyes in the console. This signs a JWT with
 * the same service account the release workflow uses, opens a throwaway edit,
 * and prints what Play actually holds: every track, its releases, their
 * version codes and status — plus the bundles Play has finished processing.
 *
 * Strictly read-only: the edit is never committed (it is deleted at the end,
 * and an uncommitted edit changes nothing either way).
 *
 * Needs PLAY_SERVICE_ACCOUNT_JSON in the environment. No dependencies —
 * node:crypto signs the assertion.
 */
import { createSign } from 'node:crypto'

const PKG = process.env.PLAY_PACKAGE || 'com.hammertrack.app'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3'

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(j)}`)
  return j.access_token
}

const api = (token) => async (path, method = 'GET') => {
  const res = await fetch(`${API}/applications/${PKG}${path}`, {
    method, headers: { authorization: `Bearer ${token}` },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`)
  return body
}

const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON
if (!raw) { console.error('PLAY_SERVICE_ACCOUNT_JSON not set'); process.exit(1) }

const sa = JSON.parse(raw)
const call = api(await accessToken(sa))
const edit = await call('/edits', 'POST')
console.log(`package ${PKG} · edit ${edit.id}\n`)

try {
  const { tracks = [] } = await call(`/edits/${edit.id}/tracks`)
  if (!tracks.length) console.log('no tracks')
  for (const t of tracks) {
    const rels = t.releases ?? []
    console.log(`TRACK ${t.track}${rels.length ? '' : '  (no releases)'}`)
    for (const r of rels) {
      const codes = (r.versionCodes ?? []).join(', ') || '—'
      const pct = r.userFraction != null ? ` ${Math.round(r.userFraction * 100)}%` : ''
      console.log(`  · ${r.status}${pct}  versionCode ${codes}  ${r.name ?? ''}`)
    }
  }

  const { bundles = [] } = await call(`/edits/${edit.id}/bundles`)
  const codes = bundles.map((b) => b.versionCode).sort((a, b) => a - b)
  console.log(`\nBUNDLES Play has processed: ${codes.length ? codes.join(', ') : 'none'}`)
  console.log(codes.includes(10)
    ? '\n✅ versionCode 10 is in the console — the Foreground service permissions form has a build to attach to.'
    : '\n⚠️  versionCode 10 is NOT in the console yet.')
} finally {
  // Never commit: an abandoned edit leaves Play exactly as it was.
  try { await call(`/edits/${edit.id}`, 'DELETE') } catch { /* expires on its own */ }
}
