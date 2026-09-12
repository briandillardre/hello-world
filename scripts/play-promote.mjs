#!/usr/bin/env node
/**
 * Start the rollout on a release already sitting in the console as a draft.
 *
 * The release workflow uploads and rolls out in one edit. When a draft is
 * parked instead (because Play was blocking on a declaration — see the
 * `status: draft` input on android-release), there is no way to finish it
 * from CI: re-uploading the same versionCode is refused, and the AAB is
 * already up there. This promotes what Play holds: read the track, flip the
 * draft release to completed, commit.
 *
 * Nothing is uploaded and no version number changes. If Play still refuses
 * (a declaration under review, an unmet requirement), the commit fails and
 * the ENTIRE edit is discarded — the draft is left exactly as it was. A
 * failed run costs nothing.
 *
 *   PLAY_SERVICE_ACCOUNT_JSON=... node scripts/play-promote.mjs [track]
 */
import { createSign } from 'node:crypto'

const PKG = process.env.PLAY_PACKAGE || 'com.hammertrack.app'
const TRACK = process.argv[2] || process.env.PLAY_TRACK || 'production'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

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

const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON
if (!raw) { console.error('PLAY_SERVICE_ACCOUNT_JSON not set'); process.exit(1) }
const token = await accessToken(JSON.parse(raw))

const call = async (path, method = 'GET', body) => {
  const res = await fetch(`${API}/applications/${PKG}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { raw: text } }
  if (!res.ok) {
    const msg = parsed?.error?.message || text.slice(0, 500)
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`)
  }
  return parsed
}

const edit = await call('/edits', 'POST')
let committed = false
try {
  const track = await call(`/edits/${edit.id}/tracks/${TRACK}`)
  const releases = track.releases ?? []
  const draft = releases.find((r) => r.status === 'draft')
  if (!draft) {
    console.log(`No draft release on the ${TRACK} track. Nothing to promote.`)
    for (const r of releases) console.log(`  · ${r.status}  versionCode ${(r.versionCodes ?? []).join(', ')}  ${r.name ?? ''}`)
    process.exit(0)
  }

  console.log(`Promoting ${TRACK}: ${draft.name ?? '(unnamed)'} · versionCode ${(draft.versionCodes ?? []).join(', ')}`)
  // Everything else about the release is preserved — only the status moves.
  // userFraction is invalid on a completed release, so it is dropped.
  const { userFraction: _drop, ...rest } = draft
  void _drop
  // ONLY the promoted release. Sending the outgoing one alongside it is a
  // 400 — "Only one completed release is allowed" — and it is not needed:
  // Play retires the previous release itself (it shows up under Release
  // history as "Replaced on ..."), exactly as the upload path does.
  await call(`/edits/${edit.id}/tracks/${TRACK}`, 'PUT', {
    track: TRACK,
    releases: [{ ...rest, status: 'completed' }],
  })
  const done = await call(`/edits/${edit.id}:commit`, 'POST')
  committed = true
  console.log(`\n✅ Rollout started. Edit ${done.id ?? edit.id} committed — Play is reviewing the release.`)
} catch (err) {
  console.error(`\n❌ ${err.message}`)
  console.error('\nThe edit was NOT committed, so the draft is untouched. If the message')
  console.error('names a declaration, it is still in review — try again once it clears.')
  process.exitCode = 1
} finally {
  if (!committed) { try { await call(`/edits/${edit.id}`, 'DELETE') } catch { /* expires on its own */ } }
}
