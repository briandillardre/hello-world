import type { ToolAssociation, AssetWithLocation } from './types'

// A BLE gateway re-reports a tag within range every few minutes. Past this,
// the tag is NOT confirmed to still be with that gateway — it may have been
// left behind, moved to another vehicle (a no-tracker truck), or lost. Stale
// detections must never claim the tool is "on board / live right now".
export const TOOL_FRESH_MS = 25 * 60_000

// A tag must ride a gateway this long before the map badge counts it —
// a drive-by ping at a stoplight shouldn't instantly re-tag the truck.
export const TOOL_DWELL_MS = 10 * 60_000

export function toolIsFresh(lastSeen: string, nowMs = Date.now()): boolean {
  const t = Date.parse(lastSeen)
  return Number.isFinite(t) && nowMs - t <= TOOL_FRESH_MS
}

export interface AboardTool {
  id: string
  name: string
  color: string | null
  rssi: number | null
  /** Tag coin-cell % when the beacon reports it (TLM); null otherwise. */
  battery: number | null
  lastSeen: string
  /** False = last BLE sighting is older than TOOL_FRESH_MS: shown as "last
   *  seen with", not "on board". */
  fresh: boolean
  /** Fresh AND riding this gateway ≥ TOOL_DWELL_MS — what the map badge
   *  counts. (No attached_since yet → settled once fresh, pre-033 data.) */
  settled: boolean
}

/** Reverse index of tool_associations: gateway (truck/equipment) asset id →
 *  the tools last detected by it. `fresh` distinguishes "aboard now" from a
 *  stale sighting that shouldn't imply the tool is still in the truck. */
export function toolsAboard(
  assets: AssetWithLocation[],
  associations: ToolAssociation[],
  nowMs: number = Date.now()
): Record<string, AboardTool[]> {
  const out: Record<string, AboardTool[]> = {}
  for (const assoc of associations) {
    const tool = assets.find(a => a.id === assoc.tool_asset_id)
    if (!tool || !tool.active) continue
    const color = typeof tool.metadata?.color === 'string' ? tool.metadata.color : null
    const fresh = toolIsFresh(assoc.last_seen, nowMs)
    const attachedMs = assoc.attached_since ? Date.parse(assoc.attached_since) : NaN
    ;(out[assoc.gateway_asset_id] ??= []).push({
      id: tool.id,
      name: tool.name,
      color,
      rssi: assoc.rssi,
      battery: assoc.tag_battery ?? null,
      lastSeen: assoc.last_seen,
      fresh,
      settled: fresh && (!Number.isFinite(attachedMs) || nowMs - attachedMs >= TOOL_DWELL_MS),
    })
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * Given the full asset list and the current tool→gateway associations, returns
 * the gateway (truck/equipment) a given tool is currently detected by, if any.
 */
export function findGatewayForTool(
  toolId: string,
  associations: ToolAssociation[],
  assets: AssetWithLocation[]
): { gateway: AssetWithLocation; assoc: ToolAssociation } | null {
  const assoc = associations.find(a => a.tool_asset_id === toolId)
  if (!assoc) return null
  const gateway = assets.find(a => a.id === assoc.gateway_asset_id)
  if (!gateway) return null
  return { gateway, assoc }
}

/**
 * Tools usually have no GPS of their own — they inherit the location of the
 * gateway (truck/equipment) that currently detects them over Bluetooth.
 */
export function resolveToolLocations(
  assets: AssetWithLocation[],
  associations: ToolAssociation[],
  nowMs: number = Date.now()
): AssetWithLocation[] {
  return assets.map(asset => {
    if (asset.type !== 'tool') return asset
    const match = findGatewayForTool(asset.id, associations, assets)
    if (!match?.gateway.location) return asset
    // A tool can carry a location row of its own (seeded demo fixes; possibly
    // GPS tags someday). Whichever signal is FRESHER wins — a live Bluetooth
    // sighting must beat a stale stored fix, or a repurposed demo asset stays
    // pinned to the old demo site forever (Tool A/B rendered at Nashville
    // while physically riding the Chevy in SC, Jul 14).
    const ownMs = asset.location ? new Date(asset.location.timestamp).getTime() : -Infinity
    const seenMs = new Date(match.assoc.last_seen).getTime()
    if (Number.isFinite(ownMs) && ownMs >= seenMs) return asset

    // FRESH sighting → the tool is with the truck right now; ride its live
    // position. STALE → freeze at the tag's TRUE last-seen spot (the
    // gateway's fix at sighting time, snapshotted by ingest since 033) — the
    // old carrier may have driven off without it (tags in the untracked
    // Chevy at the dealership were painted onto the Ram's live position,
    // Jul 16). Pre-033 rows have no snapshot; carrier position is the only
    // (wrong-ish) signal we have until the next real sighting writes one.
    const fresh = toolIsFresh(match.assoc.last_seen, nowMs)
    const snapLat = match.assoc.last_lat
    const snapLng = match.assoc.last_lng
    const useSnapshot = !fresh && typeof snapLat === 'number' && typeof snapLng === 'number'
    return {
      ...asset,
      location: {
        ...match.gateway.location,
        ...(useSnapshot ? { lat: snapLat, lng: snapLng, speed: 0, heading: null } : {}),
        id: `inherited-${asset.id}`,
        asset_id: asset.id,
        timestamp: match.assoc.last_seen,
        // The truck's 12V state is NOT the tag's coin cell — show the tag's
        // own battery when the beacon reports it, never the carrier's.
        battery: match.assoc.tag_battery ?? null,
      },
    }
  })
}