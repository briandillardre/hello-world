/**
 * The map as an animated GIF (Brian, Sep 12: "need a gif creator within this
 * as an option also").
 *
 * The PDF button hands someone a dated still of where the fleet WAS. This
 * hands them the day itself — a truck leaving the yard, working a site and
 * coming back — in a file that plays by itself inside a text message, an
 * email or an insurance claim, with no app to open and nothing to log into.
 * That autoplay-anywhere property is the whole reason it is a GIF and not an
 * MP4.
 *
 * Pure helpers only: sizing, frame planning and encoding. The component drives
 * the replay and hands the frames in — which keeps the part with the arithmetic
 * testable without a map.
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

/** Long edge of the output. A GIF is 8-bit and uncompressed between frames —
 *  full-resolution phone frames make a file too big to text. */
export const GIF_SIZES = [
  { key: 'small', label: 'Small', px: 480, note: 'texts anywhere' },
  { key: 'medium', label: 'Medium', px: 720, note: 'email, most texts' },
  { key: 'large', label: 'Large', px: 1080, note: 'desktop, big file' },
] as const
export type GifSizeKey = (typeof GIF_SIZES)[number]['key']

/** More frames = smoother and heavier, in a straight line. */
export const GIF_FRAMES = [30, 45, 60, 90] as const

/** Roughly how many megabytes that plan lands on, to warn BEFORE the wait.
 *  Empirical: ~0.9 bytes per pixel per frame after palette + LZW on map
 *  imagery (a lot of flat green, which compresses well). */
export function estimateMb(px: number, frames: number, aspect: number): number {
  const w = px
  const h = Math.round(px / aspect)
  return (w * h * frames * 0.9) / (1024 * 1024)
}

/** Carriers choke well before this; warn rather than fail after a long wait. */
export const MMS_LIMIT_MB = 3.5

/**
 * Fit a capture into the size budget, keeping its aspect. Never upscales — a
 * phone screenshot enlarged to 1080 is a blurrier file, not a better one.
 */
export function fitSize(srcW: number, srcH: number, longEdge: number): { w: number; h: number } {
  const scale = Math.min(1, longEdge / Math.max(srcW, srcH))
  // Even numbers keep the quantizer's math tidy and avoid a 1px seam.
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(srcW * scale), h: even(srcH * scale) }
}

/**
 * Where each frame sits in the window, as a 0..1 fraction of the replay.
 *
 * The LAST frame lands exactly on 1: a recording of a truck's day that stops
 * short of the end looks like the tracker died. With one frame there is only
 * the end to show.
 */
export function framePlan(frames: number): number[] {
  const n = Math.max(2, Math.floor(frames))
  return Array.from({ length: n }, (_, i) => i / (n - 1))
}

/** Milliseconds per frame for a whole-animation runtime. GIF stores delay in
 *  hundredths of a second, so the value is snapped to what will actually play
 *  — and floored at 20 ms, under which browsers substitute their own delay. */
export function frameDelayMs(totalSec: number, frames: number): number {
  const raw = (totalSec * 1000) / Math.max(1, frames)
  return Math.max(20, Math.round(raw / 10) * 10)
}

export interface GifFrame { data: Uint8ClampedArray; width: number; height: number }

/**
 * Encode RGBA frames into an animated GIF.
 *
 * ONE palette for the whole animation, built from the middle frame: a
 * per-frame palette makes the basemap's greens shimmer between frames, which
 * reads as a video artifact rather than movement. The middle frame is the
 * fairest sample — the first is often mid-fly-in.
 *
 * `onProgress` runs between frames; the caller yields to the event loop there
 * so a 90-frame encode does not freeze the phone.
 */
export async function encodeGif(
  frames: GifFrame[],
  delayMs: number,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<Blob> {
  if (!frames.length) throw new Error('nothing to encode')
  const { width, height } = frames[0]
  const sample = frames[Math.floor(frames.length / 2)]
  const palette = quantize(sample.data, 256, { format: 'rgb565' })

  const gif = GIFEncoder()
  for (let i = 0; i < frames.length; i++) {
    const indexed = applyPalette(frames[i].data, palette, 'rgb565')
    gif.writeFrame(indexed, width, height, { palette: i === 0 ? palette : undefined, delay: delayMs })
    await onProgress?.(i + 1, frames.length)
  }
  gif.finish()
  return new Blob([gif.bytesView() as unknown as BlobPart], { type: 'image/gif' })
}

/** `fleet-map-2026-09-12.gif` — a name that means something in a downloads folder. */
export function gifFilename(label: string, when = new Date()): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map'
  return `${slug}-${when.toISOString().slice(0, 10)}.gif`
}
