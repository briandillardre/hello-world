/**
 * The camera scanner's fallback reader (lib/barcode-camera.ts → zxing) — run
 * after ANY change to it or any zxing-wasm / barcode-detector upgrade.
 *  1. public/zxing/zxing_reader.wasm IS the reader build the package expects
 *     (a stale copy after an upgrade fails at scan time, in the field).
 *  2. It reads what the scanners are for: a Teltonika IMEI label (Code 128,
 *     15 digits) and our QR stickers.
 * Fix for 1: cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm public/zxing/
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const resolveFile = (p) => require.resolve(p)

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.error(`  ✗ ${name}${extra !== '' ? ' — ' + JSON.stringify(extra) : ''}`) }

const shipped = readFileSync(new URL('../public/zxing/zxing_reader.wasm', import.meta.url))
const pkgWasm = readFileSync(resolveFile('zxing-wasm/reader/zxing_reader.wasm'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const reader = await import('zxing-wasm/reader')
ok('public/zxing/zxing_reader.wasm is the installed reader build', sha(shipped) === sha(pkgWasm) && sha(shipped) === reader.ZXING_WASM_SHA256, { shipped: sha(shipped).slice(0, 12), pkg: sha(pkgWasm).slice(0, 12), expected: reader.ZXING_WASM_SHA256.slice(0, 12) })

const full = await import('zxing-wasm/full')
await full.prepareZXingModule({ overrides: { wasmBinary: readFileSync(resolveFile('zxing-wasm/full/zxing_full.wasm')).buffer }, fireImmediately: true })
await reader.prepareZXingModule({ overrides: { wasmBinary: shipped.buffer.slice(shipped.byteOffset, shipped.byteOffset + shipped.byteLength) }, fireImmediately: true })

const imei = '356307042441013' // Luhn-valid test IMEI
const label = await full.writeBarcode(imei, { format: 'Code128', scale: 2 })
ok('writer made the IMEI label', !label.error && !!label.image, label.error)
const read1 = await reader.readBarcodes(new Uint8Array(await label.image.arrayBuffer()), { formats: ['Code128'] })
ok(`reads an IMEI label (Code 128) → ${read1[0]?.text}`, read1.some(r => r.text === imei), read1.map(r => r.text))

const qr = await full.writeBarcode('https://hammertrack.ai/a/3f6c1b2a', { format: 'QRCode', scale: 4 })
const read2 = await reader.readBarcodes(new Uint8Array(await qr.image.arrayBuffer()), { formats: ['QRCode'] })
ok('reads a QR sticker', read2.some(r => r.text === 'https://hammertrack.ai/a/3f6c1b2a'), read2.map(r => r.text))

// With the options a live camera frame needs (the label isn't a clean, square-on print there).
const rgba = await reader.readBarcodes(new Uint8Array(await label.image.arrayBuffer()), { formats: ['Code128'], tryHarder: true, tryRotate: true, isPure: false })
ok('reads the label with the camera settings (tryHarder, not pure)', rgba.some(r => r.text === imei))

console.log(`barcode: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
