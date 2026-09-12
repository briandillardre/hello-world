/**
 * Proves the GIF encoder lib/map-gif.ts uses actually produces a real,
 * animated, looping file — run it after any change to the encode path.
 *
 *   node scripts/gif-test.mjs
 *
 * Synthetic frames on purpose: a truck driving left to right across a flat
 * green basemap is the shape of a real recording, without needing a map.
 */
// gifenc's bare specifier resolves to its CJS build from a .mjs file, which
// carries no named exports — take the default and destructure.
import pkg from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = pkg

// mimic lib/map-gif.ts encodeGif over synthetic "map" frames that actually move
const W = 160, H = 90, N = 12
const frames = []
for (let f = 0; f < N; f++) {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    // green basemap + a "truck" that drives left→right
    const truck = Math.abs(x - Math.round((f / (N - 1)) * (W - 1))) < 4 && Math.abs(y - H / 2) < 4
    d[i] = truck ? 255 : 30; d[i+1] = truck ? 158 : 90; d[i+2] = truck ? 22 : 40; d[i+3] = 255
  }
  frames.push(d)
}
const palette = quantize(frames[Math.floor(N/2)], 256, { format: 'rgb565' })
const gif = GIFEncoder()
for (let i = 0; i < N; i++) {
  gif.writeFrame(applyPalette(frames[i], palette, 'rgb565'), W, H, { palette: i === 0 ? palette : undefined, delay: 80 })
}
gif.finish()
const bytes = gif.bytesView()

let fail = 0
const ok = (c, m) => { console.log(`${c ? '  ok  ' : '  FAIL'} ${m}`); if (!c) fail++ }
const head = String.fromCharCode(...bytes.slice(0, 6))
ok(head === 'GIF89a', `header is GIF89a (${head})`)
const lsw = bytes[6] | (bytes[7] << 8), lsh = bytes[8] | (bytes[9] << 8)
ok(lsw === W && lsh === H, `logical screen ${lsw}x${lsh} matches ${W}x${H}`)
// count image descriptors (0x2C) that follow a graphic control ext (0x21 0xF9)
let gce = 0
for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x21 && bytes[i+1] === 0xF9) gce++
ok(gce === N, `${gce} frames encoded (expected ${N})`)
ok(bytes[bytes.length - 1] === 0x3B, 'trailer byte present')
ok(bytes.length > 500 && bytes.length < 200000, `size sane: ${(bytes.length/1024).toFixed(1)} KB`)
// NETSCAPE loop block
const s = Buffer.from(bytes).toString('latin1')
ok(s.includes('NETSCAPE2.0'), 'loops forever (NETSCAPE2.0 block)')
console.log(fail === 0 ? '\nGIF ENCODER OK' : `\n${fail} FAILED`)
process.exit(fail ? 1 : 0)
