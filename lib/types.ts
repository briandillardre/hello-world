export type AssetType = 'vehicle' | 'equipment' | 'personnel' | 'tool'
export type AlertTrigger = 'enter' | 'exit' | 'idle'
export type UserRole = 'admin' | 'viewer'

export interface Company {
  id: string
  name: string
  api_key: string
  plan: string
  created_at: string
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
