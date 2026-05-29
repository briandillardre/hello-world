export type AssetType = 'vehicle' | 'equipment' | 'personnel' | 'tool'
export type AlertTrigger = 'enter' | 'exit' | 'idle' | 'after_hours_movement' | 'left_site'
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
  last_seen: string
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
  tracker_id: string | null
  metadata: Record<string, unknown>
  active: boolean
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
}

export interface Geofence {
  id: string
  company_id: string
  name: string
  geometry: GeoJSON.Polygon
  color: string
  created_at: string
}

export interface AlertRule {
  id: string
  company_id: string
  geofence_id: string
  asset_id: string | null
  trigger: AlertTrigger
  idle_minutes: number | null
  active: boolean
}

export interface AlertEvent {
  id: string
  company_id: string
  rule_id: string
  asset_id: string
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
