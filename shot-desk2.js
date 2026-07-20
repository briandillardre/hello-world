const { chromium } = require('playwright-core')
const SCRATCH = '/tmp/claude-0/-home-user-hello-world/ecc698b8-e7cd-5ff5-a84a-fb74d0dcab8f/scratchpad'
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await desk.goto('http://localhost:3000/map', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {})
  await desk.waitForTimeout(9000)
  const skip = desk.locator('text=Skip').first()
  if (await skip.isVisible().catch(() => false)) await skip.click({ force: true }).catch(() => {})
  await desk.waitForTimeout(600)
  await desk.locator('button:has(svg.lucide-chevron-down)').first().click({ force: true }).catch(() => {})
  await desk.waitForTimeout(900)
  const bm = desk.locator('text=Basemap').first()
  if (await bm.isVisible().catch(() => false)) await bm.click({ force: true }).catch(() => {})
  await desk.waitForTimeout(2500)
  await desk.screenshot({ path: `${SCRATCH}/desk-basemap-grid2.png` })
  const terr = desk.locator('button:has-text("Terrain")').last()
  if (await terr.isVisible().catch(() => false)) { await terr.click({ force: true }).catch(() => {}); await desk.waitForTimeout(3500); await desk.screenshot({ path: `${SCRATCH}/desk-terrain.png` }) }
  const aub = desk.locator('button:has-text("Aubergine")').last()
  if (await aub.isVisible().catch(() => false)) { await aub.click({ force: true }).catch(() => {}); await desk.waitForTimeout(3500); await desk.screenshot({ path: `${SCRATCH}/desk-aubergine.png` }) }
  await browser.close()
  console.log('done')
})().catch((e) => { console.error(e); process.exit(1) })
