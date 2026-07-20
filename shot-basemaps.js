const { chromium } = require('playwright-core')
const SCRATCH = '/tmp/claude-0/-home-user-hello-world/ecc698b8-e7cd-5ff5-a84a-fb74d0dcab8f/scratchpad'

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  // ── Desktop: layers panel → Basemap group → thumbnail grid ──
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await desk.goto('http://localhost:3000/map', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await desk.waitForTimeout(4500)
  // dismiss demo tour if present
  const skip = desk.locator('text=Skip').first()
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true }).catch(() => {})
  await desk.waitForTimeout(500)
  // open the layers panel (Layers icon chevron button in weather pill)
  await desk.locator('button:has(svg.lucide-layers), button:has(svg.lucide-chevron-down)').first().click({ force: true }).catch(() => {})
  await desk.waitForTimeout(800)
  // expand Basemap group
  const bm = desk.locator('text=Basemap').first()
  if (await bm.isVisible().catch(() => false)) await bm.click({ force: true }).catch(() => {})
  await desk.waitForTimeout(1500)
  await desk.screenshot({ path: `${SCRATCH}/desk-basemap-grid.png` })
  // pick Terrain, screenshot map
  const terr = desk.locator('button:has-text("Terrain")').last()
  if (await terr.isVisible().catch(() => false)) { await terr.click({ force: true }).catch(() => {}); await desk.waitForTimeout(2500); await desk.screenshot({ path: `${SCRATCH}/desk-terrain.png` }) }
  // pick Aubergine
  const aub = desk.locator('button:has-text("Aubergine")').last()
  if (await aub.isVisible().catch(() => false)) { await aub.click({ force: true }).catch(() => {}); await desk.waitForTimeout(2500); await desk.screenshot({ path: `${SCRATCH}/desk-aubergine.png` }) }
  await desk.close()

  // ── Phone: measure strip ──
  const phone = await browser.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true })
  await phone.goto('http://localhost:3000/map', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await phone.waitForTimeout(4500)
  const skip2 = phone.locator('text=Skip').first()
  if (await skip2.isVisible().catch(() => false)) await skip2.click({ force: true }).catch(() => {})
  await phone.waitForTimeout(500)
  // open measure via the ruler button (aria/label unknown — it's the Ruler icon button)
  await phone.locator('button:has(svg.lucide-ruler)').first().click({ force: true }).catch(() => {})
  await phone.waitForTimeout(800)
  // tap 3 corners on the map to form an area
  for (const [x, y] of [[120, 400], [280, 420], [230, 560]]) {
    await phone.mouse.click(x, y)
    await phone.waitForTimeout(400)
  }
  await phone.waitForTimeout(800)
  await phone.screenshot({ path: `${SCRATCH}/phone-measure-strip.png` })
  // open save sheet
  const next = phone.locator('button:has-text("Next")').first()
  if (await next.isVisible().catch(() => false)) { await next.click({ force: true }).catch(() => {}); await phone.waitForTimeout(600); await phone.screenshot({ path: `${SCRATCH}/phone-measure-sheet.png` }) }
  await phone.close()

  await browser.close()
  console.log('done')
})().catch((e) => { console.error(e); process.exit(1) })
