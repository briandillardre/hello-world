#!/usr/bin/env node
/**
 * Store screenshots + the Play feature graphic, from the REAL app — never a
 * mock-up (splash truth rule). The captions and which screens come from
 * store-assets/listing.json → "shots" / "featureGraphic".
 *
 *   npm run build && PORT=3313 npm start      # with NO Supabase env = demo mode
 *   node scripts/store-shots.mjs [--base http://localhost:3313] [--only 1-live-map,3-truck] [--reuse]
 *   (--reuse frames the app captures from the last run again — for caption and layout changes)
 *
 * Demo mode only: the run refuses to start unless /reports says "demo data",
 * so a store listing can never show a customer's fleet or anyone's name.
 * Needs Playwright with Chromium (`npx playwright install chromium`, or set
 * PLAYWRIGHT_CHROMIUM to a browser binary). Behind a TLS-intercepting proxy,
 * set STORE_SHOTS_CA to its CA certificate so the map's tiles load.
 *
 * Writes (committed — the listing is code):
 *   store-assets/android-phone/<key>.png   1080×1920  Google Play phone
 *   store-assets/ios-6.9/<key>.png         1320×2868  App Store iPhone 6.9"
 *   store-assets/ios-ipad-13/<key>.png     2064×2752  App Store iPad 13"
 *   store-assets/feature-graphic-1024x500.png        Google Play feature graphic
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://localhost:3313').replace(/\/$/, '')
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean)
const REUSE = process.argv.includes('--reuse')
const RAW = path.join(os.tmpdir(), 'hammertrack-store-raw')
mkdirSync(RAW, { recursive: true })
const listing = JSON.parse(readFileSync(path.join(ROOT, 'store-assets/listing.json'), 'utf8'))

async function loadPlaywright() {
  const require = createRequire(import.meta.url)
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p) } catch { /* next */ }
  }
  throw new Error('Playwright not found — npm i -D playwright && npx playwright install chromium')
}

const PHONE = { width: 393, height: 852, dpr: 3 }   // a modern Android/iPhone screen
const TABLET = { width: 1032, height: 1376, dpr: 2 } // iPad Pro 13"
const TARGETS = [
  { dir: 'android-phone', w: 1080, h: 1920, src: 'phone' },
  { dir: 'ios-6.9', w: 1320, h: 2868, src: 'phone' },
  { dir: 'ios-ipad-13', w: 2064, h: 2752, src: 'tablet' },
]

const mark = readFileSync(path.join(ROOT, 'public/brand/hammertrack-mark.png')).toString('base64')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** One store frame: brand, the caption, the whole real screen below it (fitted, never cropped). */
function frameHtml({ w, h, shot, title, sub, tablet }) {
  const u = w / 1080 // layout unit: 1 at Play's 1080 width
  const pad = 80 * u
  const aspect = tablet ? TABLET.width / TABLET.height : PHONE.width / PHONE.height
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{display:flex;flex-direction:column;font-family:Inter,"Segoe UI",Roboto,system-ui,sans-serif;
    background:radial-gradient(120% 70% at 15% 0%,#0f3b3a 0%,rgba(10,20,32,0) 55%),radial-gradient(90% 60% at 100% 10%,#2a2410 0%,rgba(10,20,32,0) 50%),linear-gradient(180deg,#07111c 0%,#0a1726 100%);color:#e8f0f7}
  header{padding:${(tablet ? 70 : 120) * u}px ${pad}px ${(tablet ? 44 : 56) * u}px}
  .brand{display:flex;align-items:center;gap:${18 * u}px;margin-bottom:${(tablet ? 26 : 38) * u}px}
  .brand img{height:${(tablet ? 44 : 56) * u}px;filter:brightness(0) invert(1)}
  .brand span{font-weight:800;letter-spacing:.09em;font-size:${(tablet ? 32 : 40) * u}px}
  .brand b{color:#2dd4bf}
  h1{font-size:${(tablet ? 60 : 72) * u}px;line-height:1.08;font-weight:800;letter-spacing:-.01em}
  p{margin-top:${(tablet ? 16 : 24) * u}px;font-size:${(tablet ? 30 : 36) * u}px;line-height:1.3;color:#9fb6cc}
  .stage{flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start;padding-bottom:${(tablet ? 60 : 70) * u}px}
  .screen{height:100%;aspect-ratio:${aspect};max-width:${tablet ? 88 : 86}%;border-radius:${(tablet ? 28 : 40) * u}px;overflow:hidden;
    border:${3 * u}px solid #1f3b5c;box-shadow:0 ${30 * u}px ${80 * u}px rgba(0,0,0,.55),0 0 0 ${10 * u}px rgba(15,30,48,.9)}
  .screen img{width:100%;height:100%;display:block;object-fit:cover;object-position:top}
  </style></head><body>
  <header><div class="brand"><img src="data:image/png;base64,${mark}"><span>HAMMER<b>TRACK</b></span></div>
  <h1>${esc(title)}</h1><p>${esc(sub)}</p></header>
  <div class="stage"><div class="screen"><img src="data:image/png;base64,${shot.toString('base64')}"></div></div>
  </body></html>`
}

function featureHtml(shot, fg) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1024px;height:500px;overflow:hidden;font-family:Inter,"Segoe UI",Roboto,system-ui,sans-serif;
    background:radial-gradient(80% 120% at 0% 0%,#0f3b3a 0%,rgba(7,17,28,0) 60%),linear-gradient(90deg,#07111c 0%,#0a1726 100%);color:#e8f0f7}
  .l{position:absolute;left:64px;top:150px;width:470px}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:30px}
  .brand img{height:52px;filter:brightness(0) invert(1)}
  .brand span{font-weight:800;letter-spacing:.09em;font-size:44px}
  .brand b{color:#2dd4bf}
  h1{font-size:30px;line-height:1.2;font-weight:800}
  h1 em{font-style:normal;color:#ff9e16}
  p{margin-top:18px;font-size:17px;line-height:1.35;color:#9fb6cc}
  .shot{position:absolute;left:590px;top:40px;width:640px;height:520px;border-radius:22px;overflow:hidden;border:3px solid #1f3b5c;
    transform:rotate(-6deg);box-shadow:0 30px 70px rgba(0,0,0,.6)}
  .shot img{width:100%;height:100%;object-fit:cover}
  </style></head><body>
  <div class="l"><div class="brand"><img src="data:image/png;base64,${mark}"><span>HAMMER<b>TRACK</b></span></div>
  <h1>${esc(fg.title)} <em>${esc(fg.accent)}</em></h1><p>${esc(fg.sub)}</p></div>
  <div class="shot"><img src="data:image/png;base64,${shot.toString('base64')}"></div>
  </body></html>`
}

const { chromium } = await loadPlaywright()
const launch = { args: [] }
if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM
// Behind a proxy (CI, sandboxes) the map's satellite tiles need it; the app on localhost must
// not go through it (a CONNECT-only proxy refuses plain http) — a PAC rule says exactly that.
if (process.env.HTTPS_PROXY) {
  const hp = process.env.HTTPS_PROXY.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const pac = `function FindProxyForURL(url, host) { if (host == "localhost" || host == "127.0.0.1") return "DIRECT"; return "PROXY ${hp}"; }`
  launch.args.push('--proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64'))
}
// A TLS-intercepting proxy's CA (STORE_SHOTS_CA=path/to/ca.crt): trust exactly that CA, by its key.
if (process.env.STORE_SHOTS_CA) {
  const { X509Certificate, createHash } = await import('node:crypto')
  const cert = new X509Certificate(readFileSync(process.env.STORE_SHOTS_CA))
  launch.args.push(`--ignore-certificate-errors-spki-list=${createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')}`)
}
const browser = await chromium.launch(launch)

async function appPage(size, storage = {}) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr, isMobile: size === PHONE, hasTouch: true,
    // One clock across the set: the map's timeline reads the company zone, the Command
    // Center's header clock reads the device's — a UTC sandbox put them 4 h apart.
    timezoneId: 'America/New_York',
    userAgent: size === PHONE
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
      : 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  // First-run explainers stay out of the pictures (they are real, but not the point of a screenshot).
  await ctx.addInitScript((extra) => {
    try {
      for (const k of ['ht_locprimer_done', 'ht_map_tour_done_v1', 'ht_ble_primer', 'ht_shift_disclosure_done']) localStorage.setItem(k, '1')
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v) // a shot's own view settings (listing.json "storage")
    } catch { /* fine */ }
  }, storage)
  return { ctx, page: await ctx.newPage() }
}

// Demo mode or nothing.
{
  const { ctx, page } = await appPage(PHONE)
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  await ctx.close()
  if (!/demo data/i.test(body)) {
    console.error(`Refusing: ${BASE} is not in demo mode (/reports doesn't say "demo data"). Run the build with no Supabase env.`)
    await browser.close(); process.exit(1)
  }
}

async function capture(size, shot) {
  const { ctx, page } = await appPage(size, shot.storage ?? {})
  await page.goto(BASE + shot.path, { waitUntil: 'domcontentloaded', timeout: 120000 })
  // Maps need their satellite tiles — a tablet screen is twice the tiles of a phone.
  const map = shot.path.startsWith('/map') || shot.path.startsWith('/command')
  await page.waitForTimeout(map ? (size === TABLET ? 18000 : 11000) : 3500)
  if (shot.pick) {
    // The map's own search: open it, type the name, Enter takes the first match.
    // (phone and tablet put the trigger in different places — the event both use opens it)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('ht:open-search')))
    const input = page.locator('input[placeholder^="Find asset"]').first()
    await input.fill(shot.pick)
    await page.waitForTimeout(1200)
    await input.press('Enter')
    await page.waitForTimeout(5000)
  }
  if (shot.scrollTo) {
    // Start the picture at a section (listing.json "scrollTo" = its exact heading), clear of the
    // page's sticky header — the part of the page the caption is about.
    await page.getByText(shot.scrollTo, { exact: true }).first().evaluate((n) => {
      n.style.scrollMarginTop = '76px'
      n.scrollIntoView({ block: 'start' })
    })
    await page.waitForTimeout(800)
  }
  const png = await page.screenshot()
  await ctx.close()
  return png
}

const outDir = (d) => { const p = path.join(ROOT, 'store-assets', d); mkdirSync(p, { recursive: true }); return p }
const render = async (html, w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(150)
  const png = await page.screenshot()
  await page.close()
  return png
}

for (const shot of listing.shots) {
  if (ONLY.length && !ONLY.includes(shot.key)) continue
  const cached = (kind, size) => {
    const f = path.join(RAW, `${shot.key}-${kind}.png`)
    if (REUSE && existsSync(f)) return Promise.resolve(readFileSync(f))
    return capture(size, shot).then((png) => { writeFileSync(f, png); return png })
  }
  const raw = { phone: await cached('phone', PHONE), tablet: await cached('tablet', TABLET) }
  for (const t of TARGETS) {
    // App Store images may say less than Play's (listing.json "ios" — e.g. no lock-screen push on iPhone yet).
    const words = t.dir.startsWith('ios') && shot.ios ? shot.ios : shot
    const png = await render(frameHtml({ w: t.w, h: t.h, shot: raw[t.src], title: words.title, sub: words.sub, tablet: t.src === 'tablet' }), t.w, t.h)
    writeFileSync(path.join(outDir(t.dir), `${shot.key}.png`), png)
  }
  console.log('✓', shot.key)
}

if (!ONLY.length || ONLY.includes('feature-graphic')) {
  const f = path.join(RAW, 'feature-map.png')
  let shot
  if (REUSE && existsSync(f)) shot = readFileSync(f)
  else {
    const { ctx, page } = await appPage({ width: 1280, height: 1040, dpr: 1 })
    await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForTimeout(11000)
    shot = await page.screenshot()
    await ctx.close()
    writeFileSync(f, shot)
  }
  writeFileSync(path.join(ROOT, 'store-assets/feature-graphic-1024x500.png'), await render(featureHtml(shot, listing.featureGraphic), 1024, 500))
  console.log('✓ feature graphic')
}
await browser.close()
