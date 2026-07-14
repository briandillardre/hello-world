/**
 * Named, saveable map views — a snapshot of every layer/style toggle, so
 * "how I like the map" is one tap instead of eight. One view can be marked
 * as the default and applies on open. Ships with four presets that double
 * as a tour of what the map can do.
 */

import type { TrailMode } from './trails'

export interface MapViewCfg {
  base: 'dark' | 'streets' | 'satellite' | 'hybrid'
  threeD: boolean
  radar: boolean
  /** GOES satellite clouds overlay. */
  clouds?: boolean
  precip: boolean
  precipPeriod: string
  /** Overlay keys → on (topo / wetlands / streams). */
  overlays: Record<string, boolean>
  parcels: boolean
  trailMode: TrailMode
  zones: boolean
}

export interface SavedMapView {
  id: string
  name: string
  cfg: MapViewCfg
  /** Presets ship with the app and can't be deleted. */
  preset?: boolean
}

const cfg = (partial: Partial<MapViewCfg>): MapViewCfg => ({
  base: 'dark',
  threeD: false,
  radar: false,
  precip: false,
  precipPeriod: '24h',
  overlays: {},
  parcels: false,
  trailMode: 'off',
  zones: true,
  ...partial,
})

// Preset names describe the JOB each look does (owner ask, Jul 14) — ids are
// persisted in saved defaults and must never change.
export const PRESET_VIEWS: SavedMapView[] = [
  {
    id: 'preset-simple',
    name: 'Dispatch — clean map',
    preset: true,
    // Just the fleet on a clean dark map. Dispatch at a glance.
    cfg: cfg({}),
  },
  {
    id: 'preset-sexy',
    name: 'Showcase — 3D + weather',
    preset: true,
    // The demo look: 3D imagery, live weather, movement trails.
    cfg: cfg({ base: 'hybrid', threeD: true, radar: true, trailMode: 'trails' }),
  },
  {
    id: 'preset-detailed',
    name: 'Field ops — streets + terrain',
    preset: true,
    // Working superintendent: streets you can read, terrain + water context.
    cfg: cfg({ base: 'streets', trailMode: 'trails', overlays: { topo: true, streams: true } }),
  },
  {
    id: 'preset-insane',
    name: 'Site planning — everything on',
    preset: true,
    // Everything on. Site-walk planning, drainage arguments, parcel lines.
    cfg: cfg({
      base: 'hybrid', threeD: true, radar: true, precip: true, trailMode: 'trails',
      overlays: { topo: true, wetlands: true, streams: true }, parcels: true,
    }),
  },
]

export interface MapViewsState {
  views: SavedMapView[]
  defaultId: string | null
}

const LS_KEY = 'ht_map_views'

/** Device-local copy (works logged-out + instant). The DB copy, when present,
 *  wins — it follows the user across devices. */
export function loadLocalViews(): MapViewsState {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
    if (raw) {
      const p = JSON.parse(raw)
      if (Array.isArray(p?.views)) return { views: p.views, defaultId: p.defaultId ?? null }
    }
  } catch { /* corrupt / private mode */ }
  return { views: [], defaultId: null }
}

export function saveLocalViews(state: MapViewsState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)) } catch { /* private mode */ }
}

/** All selectable views: user saves first, then the presets. */
export function allViews(state: MapViewsState): SavedMapView[] {
  return [...state.views, ...PRESET_VIEWS]
}
