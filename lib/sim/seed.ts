/**
 * Showroom seed — the fleet + zones a fresh showroom company starts with.
 * Greenville, SC area; every name is fictional. Brian reshapes everything
 * in the app afterward (drag zones, rename assets) and the simulator
 * follows: it reads the company's CURRENT zones on every run.
 */

/** Irregular, freehand-looking ring around a centroid (never a rectangle). */
export function irregularRing(cLng: number, cLat: number, radiusM: number, seed: number): [number, number][] {
  let h = seed >>> 0
  const rnd = () => {
    h = (Math.imul(h ^ (h >>> 15), h | 1) ^ (h + Math.imul(h ^ (h >>> 7), h | 61))) >>> 0
    return (h >>> 8) / 16_777_216
  }
  const n = 8 + Math.floor(rnd() * 3)
  const pts: [number, number][] = []
  const mPerLng = 111_320 * Math.cos((cLat * Math.PI) / 180)
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI + rnd() * 0.25
    const r = radiusM * (0.7 + rnd() * 0.55)
    pts.push([cLng + (Math.cos(ang) * r) / mPerLng, cLat + (Math.sin(ang) * r) / 111_320])
  }
  pts.push(pts[0])
  return pts
}

export const SEED_ZONES: { name: string; kind: string | null; color: string; c: [number, number]; radiusM: number }[] = [
  { name: 'Blue Ridge Equipment Yard', kind: 'yard', color: '#60a5fa', c: [-82.4160, 34.8375], radiusM: 140 },
  { name: 'Riverview Apartments — Phase 1', kind: 'site', color: '#ff9e16', c: [-82.3510, 34.8720], radiusM: 260 },
  { name: 'Hartwell Ridge Subdivision', kind: 'site', color: '#2dd4bf', c: [-82.3170, 34.7950], radiusM: 320 },
  { name: 'Palmetto Aggregates — Pit 4', kind: 'vendor', color: '#a78bfa', c: [-82.4450, 34.7880], radiusM: 220 },
]

export const SEED_ASSETS: {
  tracker_id: string
  name: string
  type: 'vehicle' | 'equipment' | 'personnel' | 'tool'
  metadata: Record<string, unknown>
  daily_cost?: number
  hourly_rate?: number
}[] = [
  { tracker_id: 'sim-truck-1', name: 'F-350 — Superintendent', type: 'vehicle', metadata: { make: 'Ford', model: 'F-350', year: 2022, sim: { role: 'rounds' } }, hourly_rate: 68 },
  { tracker_id: 'sim-truck-2', name: 'Kenworth T370 Dump', type: 'vehicle', metadata: { make: 'Kenworth', model: 'T370', year: 2019, sim: { role: 'hauler' } }, hourly_rate: 95 },
  { tracker_id: 'sim-truck-3', name: 'RAM 2500 — Crew', type: 'vehicle', metadata: { make: 'Ram', model: '2500', year: 2021, sim: { role: 'rounds' } }, hourly_rate: 62 },
  { tracker_id: 'sim-exc-1', name: 'CAT 315 Excavator', type: 'equipment', metadata: { make: 'Caterpillar', model: '315', year: 2020, sim: { zoneIdx: 0 } }, daily_cost: 410, hourly_rate: 130 },
  { tracker_id: 'sim-roll-1', name: 'HAMM HD12 Roller', type: 'equipment', metadata: { make: 'HAMM', model: 'HD12', year: 2018, sim: { zoneIdx: 1 } }, daily_cost: 210, hourly_rate: 85 },
  { tracker_id: 'sim-mini-1', name: 'Kubota KX057 Mini-Ex', type: 'equipment', metadata: { make: 'Kubota', model: 'KX057-5', year: 2021, sim: { zoneIdx: 1 } }, daily_cost: 175, hourly_rate: 90 },
  { tracker_id: 'sim-person-1', name: 'Foreman — Riverview', type: 'personnel', metadata: { role: 'Foreman', sim: { zoneIdx: 0 } }, hourly_rate: 52 },
  { tracker_id: 'sim-person-2', name: 'Crew Lead — Hartwell', type: 'personnel', metadata: { role: 'Crew Lead', sim: { zoneIdx: 1 } }, hourly_rate: 46 },
  { tracker_id: 'sim-tag-1', name: 'Trimble Laser Level', type: 'tool', metadata: { contents: 'Laser level + tripod', value: 2400, sim: { carrier: 'sim-truck-1' } } },
  { tracker_id: 'sim-tag-2', name: 'Milwaukee Pack-Out Kit', type: 'tool', metadata: { contents: 'Drills, drivers, batteries', value: 1400, sim: { carrier: 'sim-truck-2' } } },
]
