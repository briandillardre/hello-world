import type { AssetWithLocation, Geofence, AlertEvent, AlertRule, Company } from './types'

// Nashville, TN construction site area
export const MOCK_COMPANY: Company = {
  id: 'mock-company-1',
  name: 'Acme Construction Co.',
  api_key: 'tf_demo_key_for_display_only',
  plan: 'pro',
  created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
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
    id: 'evt-1', company_id: 'mock-company-1',
    rule_id: 'rule-1', asset_id: 'asset-6',
    triggered_at: new Date(Date.now() - 25 * 60000).toISOString(),
    acknowledged_at: null,
    asset: MOCK_ASSETS.find(a => a.id === 'asset-6'),
    rule: { ...MOCK_ALERT_RULES[0], geofence: MOCK_GEOFENCES[0] },
  },
  {
    id: 'evt-2', company_id: 'mock-company-1',
    rule_id: 'rule-3', asset_id: 'asset-2',
    triggered_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    asset: MOCK_ASSETS.find(a => a.id === 'asset-2'),
    rule: { ...MOCK_ALERT_RULES[2], geofence: MOCK_GEOFENCES[0] },
  },
  {
    id: 'evt-3', company_id: 'mock-company-1',
    rule_id: 'rule-2', asset_id: 'asset-1',
    triggered_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 5.5 * 60 * 60 * 1000).toISOString(),
    asset: MOCK_ASSETS.find(a => a.id === 'asset-1'),
    rule: { ...MOCK_ALERT_RULES[1], geofence: MOCK_GEOFENCES[1] },
  },
  {
    id: 'evt-4', company_id: 'mock-company-1',
    rule_id: 'rule-1', asset_id: 'asset-10',
    triggered_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    acknowledged_at: null,
    asset: MOCK_ASSETS.find(a => a.id === 'asset-10'),
    rule: { ...MOCK_ALERT_RULES[0], geofence: MOCK_GEOFENCES[0] },
  },
]

export const DEMO_MAP_CENTER: [number, number] = [-86.7816, 36.1635]
export const DEMO_MAP_ZOOM = 14.5
