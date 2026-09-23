/**
 * Shrink a camera photo on the phone before it leaves (client only). A
 * clock-in selfie is evidence for a human to glance at, not a print: 720 px
 * on the long edge at JPEG 0.72 is ~60–120 KB, small enough to ride inside a
 * server action's JSON (Vercel's ~4.5 MB body cap never sees it) and to sit
 * in the offline queue without eating localStorage.
 */
export async function shrinkPhoto(file: Blob, maxEdge = 720, quality = 0.72): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * scale))
    c.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close?.()
    return await new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', quality))
  } catch {
    return null
  }
}

/** The blob as a `data:image/jpeg;base64,…` string (what clockInAction takes). */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    } catch { resolve(null) }
  })
}
