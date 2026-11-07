/**
 * Cropped plan pictures for the map (the border and title block off), made
 * on the device. Kept for the life of the app — a map opened again draws
 * them at once — and made ONE AT A TIME, only for sheets actually on screen:
 * cropping is a full download plus a canvas the size of the sheet (~20 MB
 * for a 3000 px picture), and doing every version in parallel on every map
 * open cost phones megabytes of data and memory with Scaled plans off.
 */
import type { Crop } from '@/lib/plans/crop'

const MAX = 40
const made = new Map<string, string>()  // key → blob URL (insertion order = age)
const failed = new Set<string>()

/** Which picture and which box — the corners do not change the pixels. */
export function cropKey(url: string, c: Pick<Crop, 'x0' | 'y0' | 'x1' | 'y1'>): string {
  return `${url}|${c.x0},${c.y0},${c.x1},${c.y1}`
}

export function cropMade(key: string): string | undefined {
  return made.get(key)
}

/** True when this crop is neither made nor known to fail. */
export function cropWanted(key: string): boolean {
  return !made.has(key) && !failed.has(key)
}

/** Make one crop; resolves when it is in the cache (or known to fail). */
export function makeCrop(url: string, c: Pick<Crop, 'x0' | 'y0' | 'x1' | 'y1'>): Promise<void> {
  const key = cropKey(url, c)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => { failed.add(key); resolve() }
    img.onload = () => {
      if (!img.naturalWidth) { failed.add(key); resolve(); return }
      const sx = Math.round(c.x0 * img.naturalWidth), sy = Math.round(c.y0 * img.naturalHeight)
      const sw = Math.max(1, Math.round((c.x1 - c.x0) * img.naturalWidth)), sh = Math.max(1, Math.round((c.y1 - c.y0) * img.naturalHeight))
      const cv = document.createElement('canvas')
      cv.width = sw; cv.height = sh
      const ctx = cv.getContext('2d')
      if (!ctx) { failed.add(key); resolve(); return }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      cv.toBlob((b) => {
        cv.width = 0; cv.height = 0
        if (!b) { failed.add(key); resolve(); return }
        made.set(key, URL.createObjectURL(b))
        // Oldest out past the cap. Only sheets on screen are ever cropped, so
        // nobody draws 40 at once; a source already drawn keeps its texture.
        while (made.size > MAX) {
          const oldest = made.keys().next().value as string
          URL.revokeObjectURL(made.get(oldest)!)
          made.delete(oldest)
        }
        resolve()
      }, 'image/png')
    }
    img.src = url
  })
}
