#!/usr/bin/env node
/**
 * The Google Play store listing, pushed from the repo (Oct 4 — Brian: "make
 * sure our Google Play listing and apple listing in the future has accurate
 * descriptions and screenshots videos"). The listing is code:
 *   words   store-assets/listing.json → play (title, short + full description, video)
 *   images  store-assets/android-phone/*.png       → phone screenshots (≤ 8, filename order)
 *           store-assets/ios-ipad-13/*.png         → 10-inch tablet screenshots (same app)
 *           store-assets/feature-graphic-1024x500.png → feature graphic
 *
 * One Play edit: the listing text is replaced, each image set is cleared and
 * re-uploaded, the edit is validated — and committed only with --commit
 * (the workflow's `commit` input). Without it nothing changes in the store:
 * the edit is deleted after validation. Releases and tracks are never
 * touched, so a parked draft release stays exactly as it is.
 *
 * Needs PLAY_SERVICE_ACCOUNT_JSON. No dependencies — node:crypto signs the JWT.
 */
import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = process.env.PLAY_PACKAGE || 'com.hammertrack.app'
const LANG = 'en-US'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3'
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3'
const COMMIT = process.argv.includes('--commit')

// ── The words, checked against Play's limits before anything is sent ──
const listing = JSON.parse(readFileSync(path.join(ROOT, 'store-assets/listing.json'), 'utf8')).play
const words = {
  title: listing.title,
  shortDescription: listing.shortDescription,
  fullDescription: Array.isArray(listing.fullDescription) ? listing.fullDescription.join('\n') : listing.fullDescription,
  video: listing.video || '',
}
const limits = { title: 30, shortDescription: 80, fullDescription: 4000 }
for (const [k, max] of Object.entries(limits)) {
  if (!words[k] || words[k].length > max) { console.error(`✗ ${k} is ${words[k]?.length ?? 0} characters — Play allows 1–${max}.`); process.exit(1) }
}
if (words.video && !/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(words.video)) {
  console.error('✗ video must be a YouTube watch link (Play takes nothing else).'); process.exit(1)
}

// Exactly the shots listing.json names, in its order — a stray file in the folder never ships.
const keys = JSON.parse(readFileSync(path.join(ROOT, 'store-assets/listing.json'), 'utf8')).shots.map((x) => x.key)
const pngs = (dir) => keys.map((k) => path.join(ROOT, 'store-assets', dir, `${k}.png`)).filter(existsSync)
const images = {
  phoneScreenshots: pngs('android-phone').slice(0, 8),
  tenInchScreenshots: pngs('ios-ipad-13').slice(0, 8),
  featureGraphic: [path.join(ROOT, 'store-assets/feature-graphic-1024x500.png')].filter(existsSync),
}
if (images.phoneScreenshots.length < 2) { console.error('✗ Play needs at least 2 phone screenshots.'); process.exit(1) }

// ── Play API ──
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(j)}`)
  return j.access_token
}

const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON
if (!raw) { console.error('PLAY_SERVICE_ACCOUNT_JSON not set'); process.exit(1) }
const token = await accessToken(JSON.parse(raw))
async function call(p, method = 'GET', body, base = API, headers = {}) {
  const res = await fetch(`${base}/applications/${PKG}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { raw: text } }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${parsed?.error?.message || text.slice(0, 500)}`)
  return parsed
}

const edit = await call('/edits', 'POST')
let committed = false
try {
  const before = await call(`/edits/${edit.id}/listings/${LANG}`).catch(() => null)
  console.log(`Listing ${LANG} now: "${before?.title ?? '—'}" · short: ${before?.shortDescription ? `"${before.shortDescription}"` : '(empty)'}`)
  await call(`/edits/${edit.id}/listings/${LANG}`, 'PUT', { language: LANG, ...words })
  console.log(`→ title "${words.title}" · short ${words.shortDescription.length}/80 · full ${words.fullDescription.length}/4000${words.video ? ' · video' : ''}`)
  for (const [type, files] of Object.entries(images)) {
    if (!files.length) continue
    await call(`/edits/${edit.id}/listings/${LANG}/${type}`, 'DELETE')
    for (const f of files) {
      await call(`/edits/${edit.id}/listings/${LANG}/${type}?uploadType=media`, 'POST', new Uint8Array(readFileSync(f)), UPLOAD, { 'content-type': 'image/png' })
    }
    console.log(`→ ${type}: ${files.length} (${files.map((f) => path.basename(f)).join(', ')})`)
  }
  await call(`/edits/${edit.id}:validate`, 'POST')
  console.log('✓ Play validated the edit.')
  if (!COMMIT) {
    console.log('\nDry run — nothing changed in the store. Run with commit: true to publish.')
  } else {
    const done = await call(`/edits/${edit.id}:commit`, 'POST')
    committed = true
    console.log(`\n✅ Listing committed (edit ${done.id ?? edit.id}). Play reviews listing changes before they show — usually hours.`)
  }
} catch (err) {
  console.error(`\n❌ ${err.message}`)
  if (/→ 403/.test(err.message)) {
    // Oct 4: the release workflow's service account could upload every word and image into the
    // edit, then validate refused it — a store-listing change needs its own Play permission.
    console.error('Play refused the listing change: the service account can publish releases but not the store listing.')
    console.error('Fix (once): Play Console → Users and permissions → the service account → App permissions → HammerTrack →')
    console.error('tick "Edit store listing, pricing and distribution" (Store presence) → Apply. Then run this again.')
  }
  console.error('Nothing was committed — the store is unchanged.')
  process.exitCode = 1
} finally {
  if (!committed) { try { await call(`/edits/${edit.id}`, 'DELETE') } catch { /* expires on its own */ } }
}
