#!/usr/bin/env node
/**
 * The store promo video — ~75 s of the REAL app (demo mode, the same fictional
 * fleet as the screenshots), each scene introduced by a title card carrying the
 * matching screenshot's caption. Google Play takes a YouTube link only, so the
 * file goes to YouTube and its link into store-assets/listing.json → play.video
 * (then run the play-listing workflow).
 *
 *   npm run build && PORT=3313 npm start      # NO Supabase env = demo mode
 *   node scripts/store-video.mjs [--base http://localhost:3313] [--out /tmp/hammertrack-promo.webm]
 *
 * WebM (VP8) at 1920×1080 — YouTube takes it as is. Not committed: binaries
 * this size don't belong in the repo; the script makes it again on demand.
 * Same proxy knobs as scripts/store-shots.mjs (HTTPS_PROXY, STORE_SHOTS_CA).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://localhost:3313').replace(/\/$/, '')
const OUT = arg('--out', path.join(os.tmpdir(), 'hammertrack-promo.webm'))

const require = createRequire(import.meta.url)
let chromium
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break } catch { /* next */ } }
if (!chromium) throw new Error('Playwright not found — npm i -D playwright && npx playwright install chromium')

// Navy, not white, before the first page paints (the recording starts on an empty tab).
const launch = { args: ['--default-background-color=07111cff'] }
if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM
if (process.env.HTTPS_PROXY) {
  const hp = process.env.HTTPS_PROXY.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const pac = `function FindProxyForURL(url, host) { if (host == "localhost" || host == "127.0.0.1") return "DIRECT"; return "PROXY ${hp}"; }`
  launch.args.push('--proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64'))
}
if (process.env.STORE_SHOTS_CA) {
  const { X509Certificate, createHash } = await import('node:crypto')
  const cert = new X509Certificate(readFileSync(process.env.STORE_SHOTS_CA))
  launch.args.push(`--ignore-certificate-errors-spki-list=${createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')}`)
}
const browser = await chromium.launch(launch)
const W = 1920, H = 1080
const dir = mkdtempSync(path.join(os.tmpdir(), 'ht-video-'))
const ctx = await browser.newContext({ viewport: { width: W, height: H }, timezoneId: 'America/New_York', recordVideo: { dir, size: { width: W, height: H } } })
await ctx.addInitScript(() => {
  try {
    for (const k of ['ht_locprimer_done', 'ht_map_tour_done_v1', 'ht_ble_primer', 'ht_shift_disclosure_done']) localStorage.setItem(k, '1')
    // The replay's caption promises a trail colored by speed — the same switch the 5-replay shot sets.
    localStorage.setItem('ht_trail_speed', '1')
    // Every scene opens fresh — the whole fleet, the default map — never the camera a warm-up left behind.
    for (const k of ['ht_last_state_map', 'ht_last_state_command']) localStorage.removeItem(k)
  } catch { /* fine */ }
})

// The captions are the screenshots' captions (store-assets/listing.json) — one set of words, never two.
const listing = JSON.parse(readFileSync(new URL('../store-assets/listing.json', import.meta.url), 'utf8'))
const shotByKey = Object.fromEntries(listing.shots.map((x) => [x.key, x]))
const cap = (key) => {
  const x = shotByKey[key]
  if (!x) throw new Error(`listing.json has no shot "${key}"`)
  return [x.title, x.sub]
}

// Warm the caches (app shell, satellite tiles) on a page that is thrown away,
// so the recorded page opens on a drawn map instead of a loading one.
const warm = await ctx.newPage()
for (const p of ['/map', '/map?range=yesterday&t=0.05', '/alerts', '/assets', '/reports?range=7d', '/command']) {
  await warm.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await warm.waitForTimeout(p.startsWith('/map') || p === '/command' ? 9000 : 2500)
}
const body = await warm.locator('body').innerText()
await warm.close()

const mark = readFileSync(new URL('../public/brand/hammertrack-mark.png', import.meta.url)).toString('base64')

// A title card over the app: it says what comes next while the next screen loads underneath,
// then fades to show the scene — no loading ever reaches the video. Every scene is a FULL page
// load (a software-rendered map — no GPU, as in CI and sandboxes — keeps the main thread so busy
// that a client-side link never finishes), so the card lives in an init script: a pending card
// (sessionStorage) is up before the new page paints. It hangs off <html>, which hydration leaves alone.
await ctx.addInitScript((m) => {
  window.__htCard = (t, s, instant) => {
    let d = document.getElementById('ht-card')
    if (!d) {
      d = document.createElement('div')
      d.id = 'ht-card'
      d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;justify-content:center;padding:0 160px;font-family:Inter,Segoe UI,Roboto,system-ui,sans-serif;color:#e8f0f7;background:radial-gradient(90% 90% at 10% 0%,#0f3b3a 0%,rgba(7,17,28,0) 60%),linear-gradient(135deg,#07111c,#0a1726)'
      document.documentElement.appendChild(d)
    }
    d.style.transition = instant ? 'none' : 'opacity .6s'
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    d.innerHTML = `<div style="display:flex;align-items:center;gap:18px;margin-bottom:40px"><img src="data:image/png;base64,${m}" style="height:64px;filter:brightness(0) invert(1)"><span style="font-weight:800;letter-spacing:.09em;font-size:46px">HAMMER<b style="color:#2dd4bf">TRACK</b></span></div><div style="font-size:96px;font-weight:800;line-height:1.05;max-width:1500px">${esc(t)}</div>${s ? `<div style="margin-top:28px;font-size:40px;color:#9fb6cc;max-width:1500px">${esc(s)}</div>` : ''}`
    d.style.opacity = '1'
  }
  try {
    const pending = sessionStorage.getItem('ht_card')
    if (pending) {
      const [t, s] = JSON.parse(pending)
      // This runs before the parser has made <html>: mount the moment it exists.
      if (document.documentElement) window.__htCard(t, s, true)
      else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); window.__htCard(t, s, true) } }).observe(document, { childList: true })
    }
  } catch { /* no card */ }
}, mark)

const page = await ctx.newPage()
const card = (title, sub) => page.evaluate(([t, s]) => {
  sessionStorage.setItem('ht_card', JSON.stringify([t, s]))
  window.__htCard(t, s)
}, [title, sub])
const reveal = () => page.evaluate(() => {
  sessionStorage.removeItem('ht_card')
  const d = document.getElementById('ht-card'); if (d) d.style.opacity = '0'
})
const go = (href) => page.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 120000 })

// Open on the card's own navy (a stub page on the app's origin, so the first card can ride
// sessionStorage like the rest), then the map loads underneath the first card.
await page.route('**/__store-video-start', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;background:#07111c"></body></html>' }))
await go('/__store-video-start')
await card(...cap('1-live-map'))
await go('/map')
await page.waitForTimeout(12000) // the fleet fit + the satellite tiles, behind the card
await reveal(); await page.waitForTimeout(5000)

await card(...cap('5-replay'))
// By accessible name: the chip carries a short label for phones and the full one for wider screens.
// dispatchEvent, not click(): a pointer click waits on hit-testing and scrolling, which a
// software-rendered map starves; the button's own handler is all a scene needs.
const press = (loc, what) => loc.first().dispatchEvent('click', undefined, { timeout: 20000 }).catch(() => console.warn(`⚠ no ${what} button`))
await press(page.getByRole('button', { name: 'Yesterday', exact: true }), 'Yesterday')
await page.waitForTimeout(4500)
await reveal(); await page.waitForTimeout(900)
await press(page.locator('button[aria-label="Play"]'), 'Play')
await page.waitForTimeout(6000)

await card(...cap('2-theft-alerts'))
// Stop the replay under the card before leaving the map (a playing replay is the busiest the
// page gets — the next load starts sooner without it).
await press(page.locator('button[aria-label="Pause"]'), 'Pause')
await go('/alerts'); await page.waitForTimeout(3000)
await reveal(); await page.waitForTimeout(3500)

await card(...cap('4-assets-tools'))
await go('/assets'); await page.waitForTimeout(3000)
await reveal(); await page.waitForTimeout(3500)

await card(...cap('6-reports'))
await go('/reports?range=7d'); await page.waitForTimeout(4000) // a week reads like a business, a single day doesn't
await reveal(); await page.waitForTimeout(3500)

await card(...cap('8-command'))
await go('/command'); await page.waitForTimeout(7000)
await reveal(); await page.waitForTimeout(5000)

await card('hammertrack.ai', listing.featureGraphic.sub)
await page.waitForTimeout(3500)

const v = page.video()
await page.close()
await ctx.close()
await browser.close()
if (!/demo data/i.test(body) && !/\(DEMO\)/.test(body)) console.warn('⚠ the app did not look like demo mode — check the video before using it')
const src = v ? await v.path() : readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.endsWith('.webm'))

// The recording starts on an empty tab — a few white frames before the first paint. Cut them with
// an ffmpeg that can (FFMPEG=…, one on the PATH, or the one Playwright ships to record with).
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG
  const onPath = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  if (onPath.status === 0) return 'ffmpeg'
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright')
  try {
    for (const d of readdirSync(root).filter((x) => x.startsWith('ffmpeg-')).sort().reverse()) {
      const f = path.join(root, d, process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux')
      if (existsSync(f)) return f
    }
  } catch { /* none */ }
  return null
}
const ffmpeg = findFfmpeg()
const cut = ffmpeg && spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.6', '-i', src, '-c:v', 'libvpx', '-b:v', '8M', '-crf', '10', '-an', OUT], { stdio: 'inherit' })
if (!cut || cut.status !== 0) {
  console.warn('⚠ no ffmpeg to trim the first white frames — kept as recorded')
  renameSync(src, OUT)
}
console.log(`✓ ${OUT}`)
