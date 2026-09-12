/**
 * The gallery door that keeps a photo's own GPS (Brian, Sep 12: "I want the
 * gps coordinates of photos").
 *
 * A browser file input physically cannot deliver them on Android — the system
 * strips the GPS tags out of every image it hands an app, and only a native
 * `MediaStore.setRequireOriginal()` read gets the unredacted original back.
 * `OriginalPhotosPlugin` (android/app/src/main/java/.../OriginalPhotosPlugin.java)
 * does that read; this is the thin typed side of it.
 *
 * Everything here is optional by design: a browser, an old Android, a refused
 * permission and an OEM that ignores the original request all end at
 * `isAvailable() === false` or `hasGps: false`, and the sheet keeps its
 * existing web path. Nothing in this file ever invents a coordinate.
 */

export interface NativePhoto {
  id: string
  name: string
  mimeType: string
  size: number
  hasGps: boolean
  lat?: number
  lng?: number
  /** Epoch ms from EXIF DateTimeOriginal, when the photo carries one. */
  takenAt?: number
  /** Whether the OS actually honoured the request for the unredacted file.
   *  False means the coordinates were never ours to read on this device. */
  original?: boolean
}

interface PluginShape {
  available(): Promise<{ available: boolean; granted: boolean }>
  pick(): Promise<{ photos: NativePhoto[]; denied?: boolean; cancelled?: boolean }>
  read(opts: { id: string }): Promise<{ data: string }>
  clear(): Promise<void>
}

function plugin(): PluginShape | null {
  if (typeof window === 'undefined') return null
  const cap = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> }
  }).Capacitor
  if (!cap?.isNativePlatform?.()) return null
  return (cap.Plugins?.OriginalPhotos as PluginShape | undefined) ?? null
}

/** Can this device hand us originals? Asked before the button changes. */
export async function nativePhotosAvailable(): Promise<boolean> {
  const p = plugin()
  if (!p) return false
  try { return (await p.available()).available } catch { return false }
}

export async function pickOriginalPhotos(): Promise<{ photos: NativePhoto[]; denied: boolean; cancelled: boolean }> {
  const p = plugin()
  if (!p) return { photos: [], denied: false, cancelled: true }
  try {
    const r = await p.pick()
    return { photos: r.photos ?? [], denied: !!r.denied, cancelled: !!r.cancelled }
  } catch {
    return { photos: [], denied: false, cancelled: true }
  }
}

/**
 * The bytes for one photo, as a File the rest of the sheet already knows how
 * to thumbnail and upload. One at a time: the batch never sits in memory at
 * once, and the app loads from a remote origin so a local file:// URL is not
 * fetchable here.
 */
export async function readNativePhoto(meta: NativePhoto): Promise<File | null> {
  const p = plugin()
  if (!p) return null
  try {
    const { data } = await p.read({ id: meta.id })
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new File([bytes], meta.name, { type: meta.mimeType || 'image/jpeg' })
  } catch { return null }
}

/** Drop the cached originals once the sheet is done with them. */
export async function clearNativePhotos(): Promise<void> {
  try { await plugin()?.clear() } catch { /* best effort */ }
}
