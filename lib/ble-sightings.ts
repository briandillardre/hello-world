import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * BLE tag sightings → tool custody. ONE matcher for every gateway kind — the
 * Teltonika box in a truck (flespi webhook) and, since Sep 9 (Brian: "phone
 * as ble gateway is a must"), a crew phone running the app.
 *
 *  • Identity tolerance: a tool's tracker_id may be the tag's MAC, its
 *    iBeacon identity with HEX major/minor (how Teltonika reports it), the
 *    same with DECIMAL major/minor (what every beacon app and our own Tag
 *    scanner show), or the owner shorthand UUID:minor (decimal only — a raw
 *    hex shorthand collided across pucks, ship-check Aug 12).
 *  • Strongest-signal arbitration: two trucks parked side by side BOTH hear
 *    every tag; the one that hears it LOUDEST is holding it. A challenger
 *    takes a tool only by out-shouting the current holder by 6 dB, or once
 *    the holder's sighting is 3 h stale.
 *  • tool_associations = the current ride; pairing_log = the history.
 */
export interface BeaconSighting { id: string; rssi: number | null; battery?: number | null }
export interface GatewayRef { id: string; company_id: string }
export interface GatewayFix { lat: number; lng: number; timestamp: string }

const strip = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase()
const likeEsc = (s: string) => s.replace(/[\\%_]/g, '\\$&')
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/** Every form a registered tracker_id might take for this reported id. */
export function beaconCandidates(id: string): string[] {
  const out = [id]
  // Teltonika EYE Beacons straight out of the box (Eddystone/factory mode)
  // are reported by a gateway as a zero UUID with the tag's MAC as the last
  // segment: "00000000-0000-0000-0000-7CD9F408B572". The MAC is printed on
  // the tag, so a tool registered with just that 12-hex MAC must match — no
  // EYE-app reconfiguration needed (Sep 9, five beacons zip-tied on in the
  // field and heard within the hour; PR #80). A phone gateway on Android
  // reports the same tag by its MAC directly ("7C:D9:F4:08:B5:72") — the
  // separator-insensitive fallback in recordBeaconSightings covers that form.
  const zeroMac = id.match(/^0{8}-0{4}-0{4}-0{4}-([0-9a-fA-F]{12})$/)
  if (zeroMac) out.push(zeroMac[1])
  // iBeacon identity = <uuid>:<major>:<minor>. A MAC ("DC:0D:04:BB:00:3A")
  // also ends in two colon-separated pairs — only a UUID-length prefix counts.
  const parts = id.match(/^(.{20,}):([0-9a-zA-Z]{1,5}):([0-9a-zA-Z]{1,5})$/)
  if (parts) {
    const [, uuid, a, b] = parts
    const isHex = (v: string) => /^[0-9a-fA-F]{1,4}$/.test(v)
    const isDec = (v: string) => /^\d{1,5}$/.test(v) && Number(v) <= 65535
    // Reported as hex (Teltonika): add the decimal twin + the UUID:minor shorthand.
    if (isHex(a) && isHex(b)) {
      out.push(`${uuid}:${parseInt(a, 16)}:${parseInt(b, 16)}`)
      out.push(`${uuid}:${parseInt(b, 16)}`)
    }
    // Reported as decimal (a phone, or an owner typing what their app shows):
    // add the hex twin; the shorthand stays decimal.
    if (isDec(a) && isDec(b)) {
      out.push(`${uuid}:${hex4(Number(a))}:${hex4(Number(b))}`)
      out.push(`${uuid}:${Number(b)}`)
    }
  }
  return Array.from(new Set(out))
}

/**
 * Record what `gateway` heard at `fix`. Returns how many tags matched a tool
 * and how many of those the gateway now holds. Never throws — custody is
 * additive and must not break the caller's ingest.
 */
export async function recordBeaconSightings(
  db: SupabaseClient,
  gateway: GatewayRef,
  fix: GatewayFix,
  beacons: BeaconSighting[],
): Promise<{ matched: number; holding: number }> {
  let matched = 0
  let holding = 0
  const seenMs = Date.parse(fix.timestamp)
  for (const beacon of beacons) {
    if (!beacon?.id) continue
    const candidates = beaconCandidates(beacon.id)

    let toolId: string | null = null
    for (const cand of candidates) {
      const { data: tool } = await db
        .from('assets').select('id')
        .eq('company_id', gateway.company_id)
        .ilike('tracker_id', likeEsc(cand))
        .limit(1).maybeSingle()
      if (tool) { toolId = tool.id; break }
    }
    if (!toolId) {
      const bare = candidates.map(strip).filter((s) => s.length >= 8)
      if (bare.length) {
        const { data: tools } = await db
          .from('assets').select('id, tracker_id')
          .eq('company_id', gateway.company_id).eq('type', 'tool').not('tracker_id', 'is', null)
        const hit = (tools ?? []).find((t) => bare.includes(strip(String(t.tracker_id))))
        toolId = hit?.id ?? null
      }
    }
    if (!toolId) continue
    matched++

    // ── Strongest-signal arbitration ────────────────────────────────────────
    const { data: cur } = await db
      .from('tool_associations').select('gateway_asset_id, rssi, last_seen')
      .eq('tool_asset_id', toolId).maybeSingle()
    if (cur && cur.gateway_asset_id !== gateway.id) {
      const holderFresh = seenMs - new Date(cur.last_seen).getTime() < 3 * 3_600_000
      const HYSTERESIS_DB = 6
      const outshouts = typeof beacon.rssi === 'number' && typeof cur.rssi === 'number' && beacon.rssi > cur.rssi + HYSTERESIS_DB
      if (holderFresh && !outshouts) continue // current holder keeps it
    }
    holding++

    // Newer columns (tag_battery 022; last_lat/lng + attached_since 033)
    // degrade gracefully — retry with the legacy row on a not-yet-migrated DB.
    const legacyRow: Record<string, unknown> = {
      company_id: gateway.company_id, tool_asset_id: toolId, gateway_asset_id: gateway.id,
      rssi: beacon.rssi, last_seen: fix.timestamp,
    }
    const assocRow: Record<string, unknown> = {
      ...legacyRow,
      // The gateway's fix at THIS sighting = the tag's true last-seen spot.
      last_lat: fix.lat, last_lng: fix.lng,
      // A new ride starts the dwell clock; the same holder keeps its attach time.
      ...(!cur || cur.gateway_asset_id !== gateway.id ? { attached_since: fix.timestamp } : {}),
      ...(beacon.battery != null ? { tag_battery: beacon.battery } : {}),
    }
    const { error: assocErr } = await db.from('tool_associations').upsert(assocRow, { onConflict: 'tool_asset_id' })
    if (assocErr) await db.from('tool_associations').upsert(legacyRow, { onConflict: 'tool_asset_id' })

    // Pairing history (021): open/extend/close episodes as the tag moves.
    try {
      const { data: open } = await db
        .from('pairing_log').select('id, carrier_asset_id, last_seen')
        .eq('member_asset_id', toolId).is('ended_at', null)
        .order('started_at', { ascending: false }).limit(1).maybeSingle()
      const GAP_MS = 6 * 3_600_000 // unseen for 6 h+ = that ride ended
      const stale = open ? seenMs - new Date(open.last_seen).getTime() > GAP_MS : false
      if (open && open.carrier_asset_id === gateway.id && !stale) {
        await db.from('pairing_log').update({ last_seen: fix.timestamp }).eq('id', open.id)
      } else {
        if (open) await db.from('pairing_log').update({ ended_at: open.last_seen }).eq('id', open.id)
        await db.from('pairing_log').insert({
          company_id: gateway.company_id, kind: 'tool', member_asset_id: toolId, carrier_asset_id: gateway.id,
          started_at: fix.timestamp, last_seen: fix.timestamp,
        })
      }
    } catch { /* additive */ }
  }
  return { matched, holding }
}
