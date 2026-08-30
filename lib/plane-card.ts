/**
 * Popup enrichment for a tapped aircraft — route + spotter photo snippets.
 *
 * Pure client-side glue over /api/plane-info: returns two HTML strings ready
 * to append into the existing MapView aircraft popup (which already wraps
 * content in the dark 12px #e8f0f7 body). Photographer names and airport
 * codes are third-party text headed for innerHTML, so everything interpolated
 * is escaped, and URLs are dropped entirely unless they are https. The photo
 * credit line + link are not decoration — planespotters' terms require
 * attribution and a link back wherever the image is shown.
 */

export interface PlanePhoto {
  url: string
  photographer: string
  link: string
}

export interface PlaneRoute {
  from: string
  to: string
}

export interface PlaneInfo {
  photo: PlanePhoto | null
  route: PlaneRoute | null
}

// In-flight promises cache so double-tapping a plane is one request; a
// failure evicts itself so the next tap retries instead of replaying the
// error for the rest of the session.
const cache = new Map<string, Promise<PlaneInfo>>()

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])

const httpsOnly = (u: string | undefined): string | null =>
  typeof u === 'string' && u.startsWith('https://') ? u : null

/** Raw typed fetch — throws on network/HTTP failure. */
export async function fetchPlaneInfoRaw(
  hex: string,
  callsign: string | null,
  lat: number,
  lon: number
): Promise<PlaneInfo> {
  const cs = (callsign ?? '').trim().toUpperCase()
  // Position is deliberately not in the key — the plane moves, its identity
  // (and therefore its route/photo) doesn't.
  const key = `${hex.trim().toLowerCase()}|${cs}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = (async (): Promise<PlaneInfo> => {
    const qs = new URLSearchParams({ hex: hex.trim(), lat: String(lat), lon: String(lon) })
    if (cs) qs.set('callsign', cs)
    const r = await fetch(`/api/plane-info?${qs}`)
    if (!r.ok) throw new Error(`plane-info ${r.status}`)
    const j: PlaneInfo = await r.json()
    return { photo: j?.photo ?? null, route: j?.route ?? null }
  })()
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  if (cache.size > 300) cache.clear()
  return p
}

/** `route CLT → ATL` line in the popup's grammar, or '' when nothing filed. */
export function buildRouteHtml(route: PlaneRoute | null): string {
  if (!route?.from || !route?.to) return ''
  return `<div style="margin-top:3px">filed route <b style="color:#2dd4bf">${esc(route.from)} → ${esc(route.to)}</b></div>`
}

/** Thumbnail + required credit line, or '' when the airframe has no photo. */
export function buildPhotoHtml(photo: PlanePhoto | null): string {
  const url = httpsOnly(photo?.url)
  const link = httpsOnly(photo?.link)
  // No link = no way to honor the attribution terms = no photo.
  if (!url || !link) return ''
  const who = photo?.photographer?.trim()
  const credit = who ? `© ${esc(who)} · planespotters.net` : 'photo · planespotters.net'
  return (
    `<img src="${esc(url)}" alt="" loading="lazy" style="display:block;max-width:100%;border-radius:8px;margin-top:6px" />` +
    `<a href="${esc(link)}" target="_blank" rel="noopener" style="display:block;margin-top:2px;color:#9fb6cc;font-size:9.5px;text-decoration:none">${credit}</a>`
  )
}

/**
 * The one-call version for the popup: never throws, never returns unsafe
 * markup — empty strings mean "append nothing", so a dead upstream leaves
 * the existing popup exactly as it was.
 */
export async function fetchPlaneInfo(
  hex: string,
  callsign: string | null,
  lat: number,
  lon: number
): Promise<{ photoHtml: string; routeHtml: string }> {
  try {
    const info = await fetchPlaneInfoRaw(hex, callsign, lat, lon)
    return { photoHtml: buildPhotoHtml(info.photo), routeHtml: buildRouteHtml(info.route) }
  } catch {
    return { photoHtml: '', routeHtml: '' }
  }
}
