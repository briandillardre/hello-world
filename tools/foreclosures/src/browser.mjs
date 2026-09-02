// One persistent Chromium profile for every site that fights scripts (SC Public
// Index, qPublic/Cloudflare, the Greenville Journal MIE site). First run with
// --headed: accept the disclaimers / solve any captcha once; the profile keeps
// the cookies, so later runs are headless.
import path from 'node:path'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { UA } from './config.mjs'
import { log, ensureDir } from './util.mjs'

let ctx = null
export async function browser({ headed = false } = {}) {
  if (ctx) return ctx
  const profile = process.env.FORECLOSURES_PROFILE || path.resolve(process.cwd(), 'profile')
  ensureDir(profile)
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  ctx = await chromium.launchPersistentContext(profile, {
    headless: !headed,
    userAgent: UA,
    viewport: { width: 1280, height: 960 },
    locale: 'en-US',
    ignoreHTTPSErrors: !!proxy,
    proxy: proxy ? { server: proxy } : undefined,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  ctx.setDefaultTimeout(45000)
  return ctx
}
export async function closeBrowser() { if (ctx) { await ctx.close().catch(() => {}); ctx = null } }

/** Navigate, then let a bot-wall (Cloudflare "Just a moment", SiteGround captcha, Incapsula) settle. */
export async function goto(page, url, { waitFor = null, settleMs = 1500 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 40; i++) {
    const title = (await page.title().catch(() => '')) || ''
    const html = await page.content().catch(() => '')
    const walled = /just a moment|attention required|sgcaptcha|_Incapsula_Resource|access denied/i.test(title + html.slice(0, 3000))
    if (!walled) break
    if (i === 0) log(`  bot wall on ${new URL(url).host} – waiting (use --headed to solve a captcha by hand)`)
    await page.waitForTimeout(1500)
  }
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(settleMs)
}

/** Click an "I accept / agree / continue" style disclaimer button when one is on the page. */
export async function acceptDisclaimer(page) {
  const sel = 'input[type=submit][value*="ccept" i], input[type=submit][value*="gree" i], input[type=button][value*="ccept" i], button:has-text("Accept"), button:has-text("Agree"), a:has-text("I Agree"), a:has-text("Accept")'
  const btn = page.locator(sel).first()
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForLoadState('domcontentloaded').catch(() => {}); await page.waitForTimeout(1000); return true }
  return false
}

/** Save page HTML + screenshot for selector debugging (--dump). */
export async function dump(page, dir, name) {
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, `${name}.html`), await page.content().catch(() => ''))
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => {})
}

/** Download a URL with the browser's cookies (PDF/TIFF images behind the index). */
export async function download(page, url) {
  const r = await page.context().request.get(url, { headers: { referer: page.url() } })
  if (!r.ok()) throw new Error(`download ${url} → ${r.status()}`)
  return { buf: Buffer.from(await r.body()), type: r.headers()['content-type'] || '' }
}
