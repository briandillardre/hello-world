/**
 * Site Devices layer — cameras + cheap IoT sensors as clickable map pins.
 *
 * Everything on site is "a pin with a live value": cameras, diesel tanks,
 * generators, dewatering pumps, weather stations. Same shape so the map renders
 * them uniformly and a click opens a themed popover. Camera feed is a snapshot
 * MVP (periodic image) — live video is a later upgrade.
 */

export type DeviceType = 'camera' | 'fuel' | 'generator' | 'pump' | 'weather_station'

export interface SiteDevice {
  id: string
  type: DeviceType
  name: string
  lng: number
  lat: number
  status: string
  value?: number // e.g. fuel %, fuel level
  online: boolean
}

export const DEVICE_META: Record<DeviceType, { emoji: string; color: string; label: string }> = {
  camera: { emoji: '📷', color: '#2dd4bf', label: 'Camera' },
  fuel: { emoji: '⛽', color: '#ff9e16', label: 'Fuel tank' },
  generator: { emoji: '🔌', color: '#60a5fa', label: 'Generator' },
  pump: { emoji: '💧', color: '#34d399', label: 'Pump' },
  weather_station: { emoji: '🌦️', color: '#a78bfa', label: 'Weather station' },
}

// Positioned around the two active project geofences (Nashville site)
export const MOCK_SITE_DEVICES: SiteDevice[] = [
  { id: 'cam-1', type: 'camera', name: 'Gate A · Riverfront', lng: -86.7838, lat: 36.1612, status: 'Live · 1080p', online: true },
  { id: 'cam-2', type: 'camera', name: 'Maple St · East', lng: -86.7782, lat: 36.1652, status: 'Live · 1080p', online: true },
  { id: 'fuel-1', type: 'fuel', name: 'Diesel Tank · Yard', lng: -86.7805, lat: 36.1648, status: '64% · 320 gal', value: 64, online: true },
  { id: 'gen-1', type: 'generator', name: 'Genset #2', lng: -86.7848, lat: 36.1618, status: 'Running · 38% fuel', value: 38, online: true },
  { id: 'pump-1', type: 'pump', name: 'Dewatering Pump', lng: -86.7822, lat: 36.1605, status: 'Running · 12 gpm', online: true },
  { id: 'wx-1', type: 'weather_station', name: 'Site Weather', lng: -86.7812, lat: 36.1638, status: '78°F · 6mph · 0.00"', online: true },
]

// Popup markup is injected via maplibre's setHTML (innerHTML) — every
// data-derived string must pass through here before interpolation.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function bar(pct: number, color: string): string {
  const safe = Math.max(0, Math.min(100, pct))
  const fill = safe < 20 ? '#fb5d5d' : color
  return `<div style="height:7px;border-radius:4px;background:#073a5a;overflow:hidden;margin-top:6px">
    <div style="height:100%;width:${safe}%;background:${fill};border-radius:4px"></div></div>`
}

/** Themed popover HTML for a device (rendered via maplibre Popup). */
export function devicePopupHTML(d: SiteDevice): string {
  const meta = DEVICE_META[d.type]
  const head = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #14506f">
      <span style="font-size:15px">${meta.emoji}</span>
      <span style="font-family:Archivo,sans-serif;font-weight:800;font-size:13px;color:#e8f0f7">${esc(d.name)}</span>
    </div>`

  let body = ''
  if (d.type === 'camera') {
    body = `<div style="position:relative;aspect-ratio:16/9;background:repeating-linear-gradient(120deg,#0a2236,#0a2236 9px,#0c2740 9px,#0c2740 18px)">
        <span style="position:absolute;top:6px;right:8px;font-family:monospace;font-size:9px;color:#fb5d5d;display:flex;align-items:center;gap:4px">
          <span style="width:6px;height:6px;border-radius:50%;background:#fb5d5d;display:inline-block"></span>LIVE</span>
        <span style="position:absolute;bottom:6px;left:8px;font-family:monospace;font-size:9px;color:#cfe;background:rgba(0,0,0,.45);padding:1px 5px;border-radius:4px">snapshot · updated 12s ago</span>
      </div>
      <div style="padding:8px 12px;font-size:11px;color:#9fb6cc">Tap to open full feed →</div>`
  } else if (d.type === 'fuel' || d.type === 'generator') {
    body = `<div style="padding:10px 12px">
        <div style="font-family:Archivo;font-weight:900;font-size:22px;color:#e8f0f7">${Number(d.value ?? 0)}%</div>
        ${bar(d.value ?? 0, meta.color)}
        <div style="font-family:monospace;font-size:11px;color:#9fb6cc;margin-top:7px">${esc(d.status)}</div>
      </div>`
  } else {
    body = `<div style="padding:10px 12px">
        <div style="font-family:monospace;font-size:12px;color:#e8f0f7">${esc(d.status)}</div>
        <div style="font-family:monospace;font-size:10px;color:#6f88a0;margin-top:4px">${d.online ? '● online' : '○ offline'}</div>
      </div>`
  }
  return `<div style="width:215px;background:#001a2e;color:#e8f0f7;border-radius:12px;overflow:hidden">${head}${body}</div>`
}
