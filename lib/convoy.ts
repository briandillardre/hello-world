import type { AssetWithLocation, AssetType } from './types'

/**
 * Convoy detection — "these devices are riding together" (Brian, Aug 30:
 * "devices obviously in the truck or trailer with me need to be looped in
 * together, visually and in the queryable data").
 *
 * The BLE pairing log already answers this for TOOLS (a tag heard by a
 * gateway is aboard it — radio truth). This covers everything BLE can't:
 * a phone and the truck it's riding in, a trailer's GPS unit behind a
 * pickup, two machines on one lowboy. Those are separate GPS streams that
 * happen to move as one — so the honest signal is MOTION AGREEMENT, not
 * mere proximity. Two parked machines in a yard are neighbors, not a
 * convoy; the yard zone already tells that story. Grouping only engages
 * when things are MOVING together.
 *
 * Pure and dependency-free so the map, the panels, and the AI context all
 * agree about who's riding with whom.
 */

export interface Convoy {
  /** The vehicle (else biggest machine) everyone is judged to be riding in. */
  anchorId: string
  /** Everyone else in the group, anchor excluded. */
  memberIds: string[]
  /** Mean position — where the lasso is drawn. */
  center: { lat: number; lng: number }
  /** Metres from center to the farthest member — lasso radius before padding. */
  radiusM: number
}

const M_PER_DEG = 111_320
/** Riding together = within a truck-and-trailer length or two of each other. */
const NEAR_M = 120
/** Below this everyone's "heading" is GPS noise — motion agreement needs speed. */
const MIN_MPH = 6
/** Fixes older than this say nothing about NOW. */
const FRESH_MS = 6 * 60_000
/** Anchor preference — the thing most likely to be the actual carrier. */
const ANCHOR_RANK: Record<AssetType, number> = { vehicle: 0, equipment: 1, personnel: 2, tool: 3 }

function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Group live, moving assets into convoys.
 *
 * Pair rule: fresh fixes, both at road speed, within NEAR_M, speeds within
 * 15 mph of each other, and — when both report a heading — pointed the same
 * way (≤35°). Union-find merges pairs into groups; singletons are dropped.
 * Tools are excluded on purpose: BLE pairing already binds them to their
 * carrier with radio truth, and their inherited positions would trivially
 * "agree" with the gateway they inherit from.
 */
export function detectConvoys(assets: AssetWithLocation[], now = Date.now()): Convoy[] {
  const live = assets.filter((a) => {
    if (a.type === 'tool' || !a.location) return false
    const age = now - new Date(a.location.timestamp).getTime()
    return age < FRESH_MS && (a.location.speed ?? 0) >= MIN_MPH
  })
  if (live.length < 2) return []

  // Union-find over pairwise "moving together" checks. N is a fleet on the
  // move at one instant — tens, not thousands — so O(n²) is fine.
  const parent = new Map<string, string>(live.map((a) => [a.id, a.id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => parent.set(find(a), find(b))

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i].location!, B = live[j].location!
      const cos = Math.cos((A.lat * Math.PI) / 180)
      const dx = (A.lng - B.lng) * cos * M_PER_DEG
      const dy = (A.lat - B.lat) * M_PER_DEG
      if (dx * dx + dy * dy > NEAR_M * NEAR_M) continue
      if (Math.abs((A.speed ?? 0) - (B.speed ?? 0)) > 15) continue
      if (A.heading != null && B.heading != null && headingDelta(A.heading, B.heading) > 35) continue
      union(live[i].id, live[j].id)
    }
  }

  const groups = new Map<string, AssetWithLocation[]>()
  for (const a of live) {
    const r = find(a.id)
    const g = groups.get(r)
    if (g) g.push(a)
    else groups.set(r, [a])
  }

  const out: Convoy[] = []
  for (const members of Array.from(groups.values())) {
    if (members.length < 2) continue
    members.sort((a, b) =>
      (ANCHOR_RANK[a.type] - ANCHOR_RANK[b.type]) || a.name.localeCompare(b.name))
    const anchor = members[0]
    const lat = members.reduce((s, m) => s + m.location!.lat, 0) / members.length
    const lng = members.reduce((s, m) => s + m.location!.lng, 0) / members.length
    const cos = Math.cos((lat * Math.PI) / 180)
    let radiusM = 0
    for (const mbr of members) {
      const dx = (mbr.location!.lng - lng) * cos * M_PER_DEG
      const dy = (mbr.location!.lat - lat) * M_PER_DEG
      radiusM = Math.max(radiusM, Math.hypot(dx, dy))
    }
    out.push({
      anchorId: anchor.id,
      memberIds: members.slice(1).map((m) => m.id),
      center: { lat, lng },
      radiusM,
    })
  }
  return out
}

/** Lasso ring for the map — a circle polygon around the group with padding,
 *  so the "looped in together" read is literal. */
export function convoyRingGeoJSON(convoys: Convoy[], assets: AssetWithLocation[]): GeoJSON.FeatureCollection {
  const nameOf = new Map(assets.map((a) => [a.id, a.name]))
  return {
    type: 'FeatureCollection',
    features: convoys.map((c) => {
      const pad = Math.max(c.radiusM + 45, 70)
      const cos = Math.max(0.05, Math.cos((c.center.lat * Math.PI) / 180))
      const ring: [number, number][] = []
      for (let k = 0; k <= 36; k++) {
        const th = (k / 36) * Math.PI * 2
        ring.push([
          c.center.lng + (pad * Math.sin(th)) / (M_PER_DEG * cos),
          c.center.lat + (pad * Math.cos(th)) / M_PER_DEG,
        ])
      }
      return {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
        properties: {
          anchorId: c.anchorId,
          label: `${nameOf.get(c.anchorId) ?? 'Convoy'} +${c.memberIds.length}`,
        },
      }
    }),
  }
}
