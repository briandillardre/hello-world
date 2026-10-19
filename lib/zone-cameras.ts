/**
 * Site cameras (138): where a zone's camera is watched. Pure — shared by the
 * zone page card, the map's zone sheet and the save action.
 *
 * `ubox` = the UBox phone app (the 4G PTZ cameras sold as Tefrio and many
 * other brands run on it; it is cloud-only, so the app IS the live view).
 * `link` = any https page that shows the camera.
 */

export type CameraKind = 'ubox' | 'link'

export interface ZoneCamera {
  id: string
  name: string
  kind: CameraKind
  url: string | null
}

export const UBOX_ANDROID_ID = 'cn.ubia.ubox'
export const UBOX_IOS_ID = '1436112326'

/** What a tap opens. Android: the Play listing, whose button reads "Open" once
 *  the app is installed (the shell hands Play links to the Play app). iOS: the
 *  App Store page, same idea. A desktop browser has no UBox — null. */
export function cameraOpenUrl(c: Pick<ZoneCamera, 'kind' | 'url'>, platform: string, ua = ''): string | null {
  if (c.kind === 'link') return c.url
  const android = platform === 'android' || /Android/i.test(ua)
  const ios = platform === 'ios' || /iPhone|iPad/i.test(ua)
  if (android) return `https://play.google.com/store/apps/details?id=${UBOX_ANDROID_ID}`
  if (ios) return `https://apps.apple.com/app/id${UBOX_IOS_ID}`
  return null
}

/** Validate a camera from the form. Returns the clean row or the reason. */
export function cleanCamera(input: { name?: unknown; kind?: unknown; url?: unknown }):
  { ok: true; name: string; kind: CameraKind; url: string | null } | { ok: false; error: string } {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : ''
  if (!name) return { ok: false, error: 'Give the camera a name.' }
  const kind = input.kind === 'ubox' ? 'ubox' : input.kind === 'link' ? 'link' : null
  if (!kind) return { ok: false, error: 'Pick how the camera is watched.' }
  if (kind === 'ubox') return { ok: true, name, kind, url: null }
  const raw = typeof input.url === 'string' ? input.url.trim() : ''
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, error: 'Paste the camera’s web link (starts with https://).' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'The link must start with https://.' }
  if (u.href.length > 500) return { ok: false, error: 'That link is too long.' }
  return { ok: true, name, kind, url: u.href }
}
