export type AssetType = 'vehicle' | 'equipment' | 'personnel' | 'tool'
export type AlertTrigger = 'enter' | 'exit' | 'idle' | 'after_hours_movement' | 'left_site' | 'speeding'

/** Per-rule tuning (alert_rules.params, migration 043). All optional. */
export interface AlertRuleParams {
  /** 'speeding': fire when moving faster than this (mph) inside the zone. */
  max_mph?: number
  /** 'after_hours_movement': watch WINDOW ("22:00"→"05:00", wraps midnight)
   *  instead of the default "outside company work hours". */
  start?: string
  end?: string
  /** Watch-window days (0=Sun..6=Sat). Absent = every day. */
  days?: number[]
  /** Escalate an info/warning trigger to critical — rides the SMS path. */
  critical?: boolean
}
export type UserRole = 'admin' | 'viewer'
export type MaintenanceIntervalType = 'engine_hours' | 'mileage' | 'days'

export interface Company {
  id: string
  name: string
  api_key: string
  plan: string
  created_at: string
  work_start: string // 'HH:MM' 24h
  work_end: string
  work_days: number[] // 0=Sun .. 6=Sat
}

export interface ToolAssociation {
  id: string
  company_id: string
  tool_asset_id: string
  gateway_asset_id: string
  rssi: number | null
  /** Tag coin-cell charge %, relayed from the beacon's TLM frame (022). */
  tag_battery?: number | null
  last_seen: string
  /** Gateway's fix at the last sighting — the tag's TRUE last-seen spot (033). */
  last_lat?: number | null
  last_lng?: number | null
  /** When this tool started riding its current gateway (033) — dwell clock. */
  attached_since?: string | null
}

export interface MaintenanceSchedule {
  id: string
  company_id: string
  asset_id: string
  interval_type: MaintenanceIntervalType
  interval_value: number
  last_service_value: number
  last_service_date: string | null
  description: string
}

export interface ServiceRecord {
  id: string
  company_id: string
  asset_id: string
  service_date: string
  cost: number
  vendor: string
  notes: string
  odometer_or_hours: number | null
}

export interface AssetUtilization {
  asset_id: string
  asset_name: string
  asset_type: AssetType
  engine_hours: number
  idle_hours: number
  distance_miles: number
  job_site_hours: { geofence_id: string; geofence_name: string; hours: number }[]
}

export interface OemConnection {
  id: string
  company_id: string
  /** komatsu | linkbelt | cat | cnh | bomag | wirtgen | custom */
  provider: string
  label: string | null
  base_url: string
  auth_type: 'basic' | 'bearer' | 'apikey' | 'oauth'
  username: string | null
  /** basic password / bearer token / api key / oauth secret — never send to the browser. */
  secret: string | null
  header_name: string | null
  /** OAuth2 token endpoint (auth_type 'oauth', e.g. KOMTRAX /provider/token). */
  token_url: string | null
  enabled: boolean
  last_sync: string | null
  last_status: string | null
  last_count: number | null
  created_at: string
}

export interface QboConnection {
  company_id: string
  realm_id: string
  connected_at: string
  company_name: string
}

export interface QboInvoiceLine {
  description: string
  quantity: number
  rate: number
  amount: number
}

export interface QboInvoicePreview {
  customer: string
  job_site: string
  lines: QboInvoiceLine[]
  total: number
}

export interface Profile {
  id: string
  company_id: string
  role: UserRole
  name: string
}

export interface Asset {
  id: string
  company_id: string
  name: string
  type: AssetType
  category?: string | null   // free-form group, e.g. "Dozers", "Pickups", "Crew A"
  serial?: string | null     // serial / VIN / asset tag
  photo_url?: string | null
  // Cost structure (optional; which fields apply varies by type — see AssetForm)
  hourly_rate?: number | null    // $/operating-hr (vehicle/equipment) or loaded labor $/hr (personnel)
  mileage_rate?: number | null   // $/mile (vehicles)
  daily_cost?: number | null     // ownership $/day — payment, insurance, depreciation
  purchase_price?: number | null // what you PAID (acquisition cost / cost basis)
  purchase_value?: number | null // current replacement value $
  tracker_id: string | null
  metadata: Record<string, unknown>
  folder_url?: string | null   // link to the asset's document folder (Dropbox/Drive/…)
  active: boolean
  created_at: string
}

/** One of several labeled photos attached to an asset (025). The asset's
 *  `photo_url` remains the hero image; these are the full gallery. */
export interface AssetPhoto {
  id: string
  company_id: string
  asset_id: string
  url: string
  /** 'truck' | 'gvwr' | 'vin' | 'engine' | 'issue' | free text | null */
  label: string | null
  sort: number
  created_at: string
}

export interface AssetLocation {
  id: string
  asset_id: string
  company_id: string
  lat: number
  lng: number
  accuracy: number | null
  battery: number | null
  speed: number | null
  heading: number | null
  timestamp: string
  raw: Record<string, unknown> | null
}

export interface AssetWithLocation extends Asset {
  location: AssetLocation | null
  /** Map-marker enrichment (additive, from /api/map-data — Aug 12 wow-pack):
   *  overdue maintenance count, open work orders, whole days parked. */
  maintOverdue?: number
  openWorkOrders?: number
  idleDays?: number | null
}

/** Pin categories for saved Places — drives glyph + colour on the map. */
export type PlaceKind = 'supplier' | 'fuel' | 'dump' | 'shop' | 'customer' | 'rental' | 'other'

/**
 * A saved destination crews navigate to (migration 085). A POINT, not an
 * area — zones own areas (alerts + hours); places own "drive here".
 */
export interface Place {
  id: string
  name: string
  kind: PlaceKind
  lat: number
  lng: number
  address: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export interface Geofence {
  id: string
  company_id: string
  /** Personal zone: visible only to this user. NULL = global (company-wide). */
  owner_id?: string | null
  name: string
  geometry: GeoJSON.Polygon
  color: string
  parent_id?: string | null   // nest a sub-zone under a parent site
  /** 'site' = job site (usage, invoicing, site log); 'boundary' = perimeter
   *  (outline-only, exit/after-hours alerts, excluded from usage metrics). */
  kind?: 'site' | 'boundary' | 'yard' | 'vendor'
  /** Owner-written free text ("gate code 4188") — shown on the zone, read by the AI. */
  notes?: string | null
  /** Link to the zone's document folder (Dropbox/Drive/…). */
  folder_url?: string | null
  /** Job completed (the DCG "Z flip") — name carries the Z prefix while set. */
  completed_at?: string | null
  /** Paired QuickBooks customer id — complete/reopen renames both systems. */
  qbo_customer_id?: string | null
  /** Project budget ($). Tracked costs + job-coded receipts burn against it. */
  budget?: number | null
  /** Optional job-site window. NULL = perpetual. Scopes cost totals + archive. */
  active_from?: string | null
  active_until?: string | null
  created_at: string
}

/**
 * Everything a zone form can set beyond name/geometry/color/kind. ONE shape
 * shared by the map's draw dialog and the zone-detail editor so the two can't
 * drift apart again ("the edit screen has more functionality than the add
 * screen" — owner, Jul 30). Adding a field here surfaces it in both.
 */
export interface ZoneFormOpts {
  personal?: boolean
  /** Nest under a parent site. undefined = leave as-is. */
  parentId?: string | null
  /** Project window, ISO. null clears. */
  active_from?: string | null
  active_until?: string | null
  /** Document folder (Dropbox/Drive/OneDrive) URL. */
  folderUrl?: string
  /** Owner notes — the same field the zone page and the AI read. */
  notes?: string
}

export interface ZoneEvent {
  id: string
  company_id: string
  geofence_id: string
  user_id: string | null
  action: 'created' | 'edited' | 'reshaped' | 'archived' | 'reactivated'
  detail: { changed?: string[]; from?: Record<string, unknown>; to?: Record<string, unknown>; by?: string } | null
  created_at: string
}

export interface AlertRule {
  id: string
  company_id: string
  geofence_id: string
  asset_id: string | null
  trigger: AlertTrigger
  idle_minutes: number | null
  /** Optional tuning (043) — undefined on pre-migration rows. */
  params?: AlertRuleParams | null
  active: boolean
}

export interface AlertEvent {
  id: string
  company_id: string
  /** Null for system (vehicle-health) alerts — those carry `kind` instead. */
  rule_id: string | null
  asset_id: string
  /** 'fuel_low' | 'battery_low' for telemetry-driven alerts; null when the
   *  event came from a geofence rule. */
  kind?: string | null
  triggered_at: string
  acknowledged_at: string | null
  asset?: Asset
  rule?: AlertRule & { geofence?: Geofence }
}

export interface IngestLocationPayload {
  tracker_id: string
  lat: number
  lng: number
  accuracy?: number
  battery?: number
  timestamp?: string
}

export interface IngestObd2Payload extends IngestLocationPayload {
  speed?: number
  odometer?: number
  engine_on?: boolean
}
