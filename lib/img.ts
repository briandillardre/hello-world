/**
 * Downscaled delivery URL for a Supabase-stored public image (the Pro-plan
 * render endpoint). The zone page was shipping FULL files into tiny slots —
 * each plan "thumbnail" was the whole 3000 px sheet and the hero carousel
 * decoded 48 MP drone shots, which froze iPads ("zone page is freezing",
 * Aug 7). Non-Supabase URLs pass through untouched.
 *
 * Callers should keep an onError fallback to the raw URL — if image
 * transforms are ever disabled on the project, the render endpoint errors
 * and the <img> quietly swaps back to the original file.
 */
const MARKER = '/storage/v1/object/public/'

/** ⚠ resize=contain is LOAD-BEARING. A width-only transform center-CROPS on
 *  this service — zone heroes showed a vertical "middle slice" of full drone
 *  shots while the map overlay (raw file) showed the whole photo (Aug 9).
 *  Contain fits the image inside a width×width box, aspect preserved, never
 *  cropped — and bounding both sides also keeps extreme-aspect panos at
 *  dimensions phone GPUs will actually paint. */
export function thumbUrl(url: string, width: number, quality = 75): string {
  if (!url.includes(MARKER)) return url
  return (
    url.replace(MARKER, '/storage/v1/render/image/public/') +
    (url.includes('?') ? '&' : '?') +
    `width=${width}&height=${width}&resize=contain&quality=${quality}`
  )
}

/** onError handler: swap a failed transform URL back to the original file. */
export function fallbackToRaw(e: { currentTarget: HTMLImageElement }, raw: string) {
  if (e.currentTarget.src !== raw) e.currentTarget.src = raw
}
