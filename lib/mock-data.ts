import type {
  AssetWithLocation, Geofence, AlertEvent, AlertRule, Company,
  ToolAssociation, MaintenanceSchedule, ServiceRecord, AssetUtilization,
  QboConnection,
} from './types'

// Nashville, TN construction site area
export const MOCK_COMPANY: Company = {
  id: 'mock-company-1',
  name: 'Dillard Construction Group',
  api_key: 'tf_demo_key_for_display_only',
  plan: 'pro',
  created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  work_start: '07:00',
  work_end: '17:00',
  work_days: [1, 2, 3, 4, 5, 6], // Mon-Sat
}

export const MOCK_ASSETS: AssetWithLocation[] = [
  {
    id: 'asset-1', company_id: 'mock-company-1', name: 'F-350 Truck #1',
    type: 'vehicle', tracker_id: 'obd-001', active: true,
    metadata: { make: 'Ford', model: 'F-350', year: 2022, license: 'TN-ACM-001' },
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-1', asset_id: 'asset-1', company_id: 'mock-company-1',
      lat: 36.1627, lng: -86.7816, accuracy: 5, battery: 88, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 12 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-2', company_id: 'mock-company-1', name: 'CAT 336 Excavator',
    type: 'equipment', tracker_id: 'gps-002', active: true,
    metadata: { make: 'Caterpillar', model: '336', year: 2020 },
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-2', asset_id: 'asset-2', company_id: 'mock-company-1',
      lat: 36.1650, lng: -86.7800, accuracy: 8, battery: 42, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-3', company_id: 'mock-company-1', name: 'John Martinez',
    type: 'personnel', tracker_id: 'bt-003', active: true,
    metadata: { role: 'Foreman', phone: '615-555-0103' },
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-3', asset_id: 'asset-3', company_id: 'mock-company-1',
      lat: 36.1610, lng: -86.7830, accuracy: 10, battery: 71, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 3 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-4', company_id: 'mock-company-1', name: 'Drill Kit Set A',
    type: 'tool', tracker_id: 'bt-004', active: true,
    metadata: { contents: 'Milwaukee drill set', value: 1200 },
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-4', asset_id: 'asset-4', company_id: 'mock-company-1',
      lat: 36.1640, lng: -86.7790, accuracy: 15, battery: 31, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 47 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-5', company_id: 'mock-company-1', name: 'Concrete Mixer M200',
    type: 'equipment', tracker_id: 'gps-005', active: true,
    metadata: { make: 'Multiquip', model: 'MC94PH', capacity: '9 cu ft' },
    created_at: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-5', asset_id: 'asset-5', company_id: 'mock-company-1',
      lat: 36.1620, lng: -86.7850, accuracy: 6, battery: null, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-6', company_id: 'mock-company-1', name: 'Ram 2500 #2',
    type: 'vehicle', tracker_id: 'obd-006', active: true,
    metadata: { make: 'Ram', model: '2500', year: 2023, license: 'TN-ACM-002' },
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-6', asset_id: 'asset-6', company_id: 'mock-company-1',
      lat: 36.1660, lng: -86.7780, accuracy: 4, battery: 95, speed: 45, heading: 270,
      timestamp: new Date(Date.now() - 2 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-7', company_id: 'mock-company-1', name: 'Sarah Chen',
    type: 'personnel', tracker_id: 'bt-007', active: true,
    metadata: { role: 'Site Engineer', phone: '615-555-0107' },
    created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-7', asset_id: 'asset-7', company_id: 'mock-company-1',
      lat: 36.1635, lng: -86.7820, accuracy: 12, battery: 56, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 8 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-8', company_id: 'mock-company-1', name: 'Level & Survey Kit B',
    type: 'tool', tracker_id: 'bt-008', active: true,
    metadata: { contents: 'Laser level, tripod, measuring tools', value: 850 },
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-8', asset_id: 'asset-8', company_id: 'mock-company-1',
      lat: 36.1655, lng: -86.7810, accuracy: 20, battery: 62, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 90 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-9', company_id: 'mock-company-1', name: 'JD 310L Backhoe',
    type: 'equipment', tracker_id: 'gps-009', active: true,
    metadata: { make: 'John Deere', model: '310L', year: 2021 },
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-9', asset_id: 'asset-9', company_id: 'mock-company-1',
      lat: 36.1615, lng: -86.7770, accuracy: 7, battery: 78, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-10', company_id: 'mock-company-1', name: 'Silverado 1500 #3',
    type: 'vehicle', tracker_id: 'obd-010', active: true,
    metadata: { make: 'Chevrolet', model: 'Silverado 1500', year: 2021, license: 'TN-ACM-003' },
    created_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-10', asset_id: 'asset-10', company_id: 'mock-company-1',
      lat: 36.1645, lng: -86.7840, accuracy: 5, battery: 83, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 18 * 60000).toISOString(), raw: null,
    },
  },
]

export const MOCK_GEOFENCES: Geofence[] = [
  {
    id: 'fence-1', company_id: 'mock-company-1', name: 'Main Site',
    color: '#F59E0B',
    created_at: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7865, 36.1600], [-86.7755, 36.1600],
        [-86.7755, 36.1670], [-86.7865, 36.1670],
        [-86.7865, 36.1600],
      ]],
    },
  },
  {
    id: 'fence-2', company_id: 'mock-company-1', name: 'Equipment Yard',
    color: '#3B82F6',
    created_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7810, 36.1640], [-86.7780, 36.1640],
        [-86.7780, 36.1660], [-86.7810, 36.1660],
        [-86.7810, 36.1640],
      ]],
    },
  },
  {
    id: 'fence-3', company_id: 'mock-company-1', name: 'Office Trailer',
    color: '#10B981',
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7835, 36.1608], [-86.7820, 36.1608],
        [-86.7820, 36.1618], [-86.7835, 36.1618],
        [-86.7835, 36.1608],
      ]],
    },
  },
]

export const MOCK_ALERT_RULES: AlertRule[] = [
  {
    id: 'rule-theft', company_id: 'mock-company-1',
    geofence_id: 'fence-1', asset_id: null,
    trigger: 'after_hours_movement', idle_minutes: null, active: true,
  },
  {
    id: 'rule-leftsite', company_id: 'mock-company-1',
    geofence_id: 'fence-1', asset_id: null,
    trigger: 'left_site', idle_minutes: null, active: true,
  },
  {
    id: 'rule-1', company_id: 'mock-company-1',
    geofence_id: 'fence-1', asset_id: null,
    trigger: 'exit', idle_minutes: null, active: true,
  },
  {
    id: 'rule-2', company_id: 'mock-company-1',
    geofence_id: 'fence-2', asset_id: null,
    trigger: 'enter', idle_minutes: null, active: true,
  },
  {
    id: 'rule-3', company_id: 'mock-company-1',
    geofence_id: 'fence-1', asset_id: 'asset-2',
    trigger: 'idle', idle_minutes: 240, active: true,
  },
]

export const MOCK_ALERTS: AlertEvent[] = [
  {
    id: 'evt-theft', company_id: 'mock-company-1',
    rule_id: 'rule-theft', asset_id: 'asset-2',
    triggered_at: new Date(Date.now() - 9 * 60000).toISOString(),
    acknowledged_at: null,
    asset: MOCK_ASSETS.find(a => a.id === 'asset-2'),
    rule: { ...MOCK_ALERT_RULES[0], geofence: MOCK_GEOFENCES[0] },
  },
  {
    id: 'evt-leftsite', company_id: 'mock-company-1',
    rule_id: 'rule-leftsite', asset_id: 'asset-9',
    triggered_at: new Date(Date.now() - 52 * 60000).toISOString(),
    acknowledged_at: null,
    asset: MOCK_ASSETS.find(a => a.id === 'asset-9'),
    rule: { ...MOCK_ALERT_RULES[1], geofence: MOCK_GEOFENCES[0] },
  },
  {
    id: 'evt-1', company_id: 'mock-company-1',
    rule_id: 'rule-1', asset_id: 'asset-6',
    triggered_at: new Date(Date.now() - 25 * 60000).toISOString(),
    acknowledged_at: null,
    asset: MOCK_ASSETS.find(a => a.id === 'asset-6'),
    rule: { ...MOCK_ALERT_RULES[2], geofence: MOCK_GEOFENCES[0] },
  },
  {
    id: 'evt-2', company_id: 'mock-company-1',
    rule_id: 'rule-3', asset_id: 'asset-2',
    triggered_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    asset: MOCK_ASSETS.find(a => a.id === 'asset-2'),
    rule: { ...MOCK_ALERT_RULES[4], geofence: MOCK_GEOFENCES[0] },
  },
  {
    id: 'evt-3', company_id: 'mock-company-1',
    rule_id: 'rule-2', asset_id: 'asset-1',
    triggered_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 5.5 * 60 * 60 * 1000).toISOString(),
    asset: MOCK_ASSETS.find(a => a.id === 'asset-1'),
    rule: { ...MOCK_ALERT_RULES[3], geofence: MOCK_GEOFENCES[1] },
  },
  {
    id: 'evt-4', company_id: 'mock-company-1',
    rule_id: 'rule-1', asset_id: 'asset-10',
    triggered_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: null,
    asset: MOCK_ASSETS.find(a => a.id === 'asset-10'),
    rule: { ...MOCK_ALERT_RULES[2], geofence: MOCK_GEOFENCES[0] },
  },
]

export const DEMO_MAP_CENTER: [number, number] = [-86.7816, 36.1635]
export const DEMO_MAP_ZOOM = 14.5

// ── v2: Bluetooth tool associations ──────────────────────────────────────────
// The two tool assets (asset-4 Drill Kit, asset-8 Level & Survey Kit) are
// detected by truck/equipment gateways via BLE.
export const MOCK_TOOL_ASSOCIATIONS: ToolAssociation[] = [
  {
    id: 'assoc-1', company_id: 'mock-company-1',
    tool_asset_id: 'asset-4', gateway_asset_id: 'asset-1', // Drill Kit in F-350 Truck #1
    rssi: -62, last_seen: new Date(Date.now() - 6 * 60000).toISOString(),
  },
  {
    id: 'assoc-2', company_id: 'mock-company-1',
    tool_asset_id: 'asset-8', gateway_asset_id: 'asset-9', // Survey Kit on JD Backhoe
    rssi: -74, last_seen: new Date(Date.now() - 14 * 60000).toISOString(),
  },
]

// ── v2: Maintenance ───────────────────────────────────────────────────────────
export const MOCK_MAINTENANCE_SCHEDULES: MaintenanceSchedule[] = [
  {
    id: 'maint-1', company_id: 'mock-company-1', asset_id: 'asset-2',
    interval_type: 'engine_hours', interval_value: 250, last_service_value: 1180,
    last_service_date: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Hydraulic fluid & filter service',
  },
  {
    id: 'maint-2', company_id: 'mock-company-1', asset_id: 'asset-1',
    interval_type: 'mileage', interval_value: 5000, last_service_value: 38000,
    last_service_date: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Oil change & tire rotation',
  },
  {
    id: 'maint-3', company_id: 'mock-company-1', asset_id: 'asset-9',
    interval_type: 'engine_hours', interval_value: 500, last_service_value: 2100,
    last_service_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Annual inspection & greasing',
  },
]

// Current readings used to compute due/overdue (engine hours or odometer)
export const MOCK_CURRENT_READINGS: Record<string, number> = {
  'asset-1': 42600, // miles — 4600 since last service (due soon at 5000)
  'asset-2': 1455,  // engine hours — 275 since last service (OVERDUE, interval 250)
  'asset-9': 2380,  // engine hours — 280 since last service (due at 500, ok)
}

export const MOCK_SERVICE_RECORDS: ServiceRecord[] = [
  {
    id: 'svc-1', company_id: 'mock-company-1', asset_id: 'asset-2',
    service_date: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    cost: 845.5, vendor: 'Music City Equipment Repair',
    notes: 'Replaced hydraulic filter, topped fluid.', odometer_or_hours: 1180,
  },
  {
    id: 'svc-2', company_id: 'mock-company-1', asset_id: 'asset-1',
    service_date: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    cost: 189.99, vendor: 'Quick Lube Plus',
    notes: 'Synthetic oil change, rotated tires.', odometer_or_hours: 38000,
  },
  {
    id: 'svc-3', company_id: 'mock-company-1', asset_id: 'asset-9',
    service_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    cost: 1240.0, vendor: 'Deere Authorized Service',
    notes: 'Annual inspection, replaced worn hoses.', odometer_or_hours: 2100,
  },
]

// ── v2: Utilization ────────────────────────────────────────────────────────────
export const MOCK_UTILIZATION: AssetUtilization[] = [
  {
    asset_id: 'asset-1', asset_name: 'F-350 Truck #1', asset_type: 'vehicle',
    engine_hours: 168, idle_hours: 31, distance_miles: 2240,
    job_site_hours: [
      { geofence_id: 'fence-1', geofence_name: 'Main Site', hours: 96 },
      { geofence_id: 'fence-2', geofence_name: 'Equipment Yard', hours: 41 },
    ],
  },
  {
    asset_id: 'asset-2', asset_name: 'CAT 336 Excavator', asset_type: 'equipment',
    engine_hours: 212, idle_hours: 58, distance_miles: 0,
    job_site_hours: [{ geofence_id: 'fence-1', geofence_name: 'Main Site', hours: 198 }],
  },
  {
    asset_id: 'asset-9', asset_name: 'JD 310L Backhoe', asset_type: 'equipment',
    engine_hours: 143, idle_hours: 22, distance_miles: 0,
    job_site_hours: [{ geofence_id: 'fence-1', geofence_name: 'Main Site', hours: 131 }],
  },
  {
    asset_id: 'asset-6', asset_name: 'Ram 2500 #2', asset_type: 'vehicle',
    engine_hours: 201, idle_hours: 47, distance_miles: 3110,
    job_site_hours: [
      { geofence_id: 'fence-1', geofence_name: 'Main Site', hours: 74 },
      { geofence_id: 'fence-2', geofence_name: 'Equipment Yard', hours: 88 },
    ],
  },
]

// ── v2: QuickBooks (demo connection) ────────────────────────────────────────────
export const MOCK_QBO_CONNECTION: QboConnection = {
  company_id: 'mock-company-1',
  realm_id: 'demo-realm-4620816365',
  connected_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
  company_name: 'Dillard Construction Group (Sandbox)',
}

// Equipment billing rates ($/engine-hour) used for usage-invoice generation
export const MOCK_EQUIPMENT_RATES: Record<string, number> = {
  'asset-2': 145, // CAT 336 Excavator
  'asset-9': 95,  // JD 310L Backhoe
  'asset-1': 45,  // F-350 Truck
  'asset-6': 45,  // Ram 2500
}
