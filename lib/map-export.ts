/**
 * Getting a finished file OUT of the app (Brian, Sep 12: "PDF button seems to
 * not be working").
 *
 * It was almost certainly building the PDF fine and then failing to hand it
 * over. Two reasons, and the export swallowed both:
 *
 *  1. Inside the Capacitor shell there is no browser chrome. `navigator.share`
 *     is a browser-UI feature and is usually absent, and an `<a download>`
 *     click is a NO-OP in an Android WebView unless the host app wires a
 *     DownloadListener — which ours does not. So the old path ended in a
 *     click that did nothing at all, with no error anywhere.
 *  2. `makePdfRef` caught every throw into `console.error`, which nobody on a
 *     phone can read.
 *
 * So delivery reports which door it actually used, and the caller SHOWS the
 * result either way. For an image the reliable native door needs no plugin at
 * all: put the picture on screen and let the person press and hold it —
 * Android's WebView gives them Save and Share on a long press. Adding
 * @capacitor/share would be cleaner, but it is a native plugin: it would need
 * a store release to reach a phone that already has the app, and this needs
 * to work on the next web deploy.
 */

export type DeliveryHow = 'shared' | 'downloaded' | 'cancelled' | 'blocked'

/**
 * Try to hand a file to the OS. NEVER throws — the caller decides what to say.
 * `blocked` means neither door was available, which is the native-shell case
 * and the honest answer is "here it is on screen, press and hold it".
 */
export async function deliverFile(blob: Blob, filename: string, mime: string): Promise<DeliveryHow> {
  try {
    const file = new File([blob], filename, { type: mime })
    const nav = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean })
      : null
    if (nav?.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
      try {
        await nav.share({ files: [file], title: filename })
        return 'shared'
      } catch (err) {
        // A closed share sheet is a decision, not a failure.
        if ((err as Error)?.name === 'AbortError') return 'cancelled'
      }
    }
  } catch { /* File or share unsupported — try the anchor */ }

  // The anchor path. It works on every desktop browser and silently does
  // nothing inside the app, so we report what we CAN'T know as blocked when
  // there is no share door and we are in the shell.
  try {
    if (typeof document === 'undefined') return 'blocked'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return 'downloaded'
  } catch {
    return 'blocked'
  }
}

/** `dillard-construction-fleet-map-2026-09-12.png` */
export function exportFilename(company: string | null | undefined, what: string, ext: string, when = new Date()): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const parts = [slug(company ?? ''), slug(what)].filter(Boolean).join('-').slice(0, 60) || 'map'
  return `${parts}-${when.toISOString().slice(0, 10)}.${ext}`
}

export const EXPORT_KINDS = [
  { key: 'pdf', label: 'PDF', note: 'branded sheet for a binder' },
  { key: 'png', label: 'PNG', note: 'a picture you can text' },
  { key: 'gif', label: 'GIF', note: 'the replay, moving' },
] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]['key']
