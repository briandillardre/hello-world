/**
 * Tracker types shared by server code (lib/db/trackers.ts) and client
 * components. No imports from the server side: a client file that pulls a
 * VALUE from lib/db/trackers drags next/headers into the browser bundle.
 */
import type { AssetType } from './types'
import type { DeviceModel } from './devices'

export const RETENTION_DAYS = 30

/** Ids that are not boxes: a person's phone share, a SIM placeholder. */
export const RESERVED_TRACKER_PREFIXES = ['sim-', 'phone-']

export interface TrackerLastSeen {
  timestamp: string
  lat: number | null
  lng: number | null
  speed: number | null
  battery: number | null
}

export interface TrackerRow {
  imei: string
  /** From the registry; null when the asset carries an id nobody logged. */
  model: DeviceModel | null
  label: string | null
  registered: boolean
  /** The active asset wearing it, or null = in the drawer. */
  asset: { id: string; name: string; type: AssetType } | null
  lastSeen: TrackerLastSeen | null
  unassignedSince: string | null
  /** Drawer pings buffered and waiting to land on an asset. */
  buffered: number
}

export interface DeletedAssetRow {
  id: string
  name: string
  type: AssetType
  tracker_id: string | null
  deleted_at: string
  /** When the 30 days run out. */
  purge_at: string
}

export interface MoveRow {
  id: string
  kind: 'attach' | 'detach' | 'move' | 'split_history'
  tracker_id: string
  from_asset: { id: string; name: string } | null
  to_asset: { id: string; name: string } | null
  swap_at: string
  moved_locations: number
  moved_buffered: number
  replacement_tracker_id: string | null
  note: string | null
  created_at: string
  undone_at: string | null
  /** Undo window still open (30 days, not already undone). */
  undoable: boolean
}

export interface TrackersOverview {
  installed: TrackerRow[]
  unassigned: TrackerRow[]
  deletedAssets: DeletedAssetRow[]
  moves: MoveRow[]
}


export type Destination =
  | { mode: 'drawer' }
  | { mode: 'asset'; assetId: string }
  | { mode: 'new'; name: string; type: AssetType }

export type TrackerChange =
  /** This asset has no tracker; put one on. From the drawer, taken off another
   *  asset, or a brand-new id typed in. */
  | { kind: 'attach'; imei: string; sinceIso: string }
  /** Pull the tracker out; it goes in the drawer. */
  | { kind: 'detach'; sinceIso: string }
  /** A different box went in as this one came out. Say where the old one went. */
  | { kind: 'swap'; imei: string; sinceIso: string; oldTo: Destination }
  /** The tracker left this asset for another one (no replacement). */
  | { kind: 'move'; sinceIso: string; to: Exclude<Destination, { mode: 'drawer' }> }
  /** This record was renamed onto a new machine; the tracker stays, the OLD
   *  machine's history (before sinceIso) splits off to its own record. */
  | { kind: 'split_history'; sinceIso: string; other: Exclude<Destination, { mode: 'drawer' }> }

export interface ChangeResult {
  ok: boolean
  error?: string
  /** Where to send the user afterwards (the asset that now wears the tracker). */
  goTo?: string
  moved?: number
  buffered?: number
}

