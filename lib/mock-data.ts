import type {
  AssetWithLocation, Geofence, AlertEvent, AlertRule, Company,
  ToolAssociation, MaintenanceSchedule, ServiceRecord, AssetUtilization,
  QboConnection,
} from './types'
import type { DayRhythm, StopMix, VehicleScore } from './scorecard'

// Nashville, TN construction site area
export const MOCK_COMPANY: Company = {
  id: 'mock-company-1',
  name: 'Blue Ridge Sitework Co.',
  api_key: 'tf_demo_key_for_display_only',
  plan: 'pro',
  created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  work_start: '07:00',
  work_end: '17:00',
  work_days: [1, 2, 3, 4, 5, 6], // Mon-Sat
}

export const MOCK_ASSETS: AssetWithLocation[] = [
  {
    id: 'asset-1', company_id: 'mock-company-1', name: 'Chevy 1500 — Owner',
    type: 'vehicle', tracker_id: 'obd-001', active: true, hourly_rate: 68,
    metadata: { make: 'Chevrolet', model: 'Silverado 1500', year: 2021, license: 'SC-DCG-001' },
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-1', asset_id: 'asset-1', company_id: 'mock-company-1',
      lat: 36.1629, lng: -86.7833, accuracy: 5, battery: 88, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 12 * 60000).toISOString(),
      raw: {
        source: 'flespi',
        'engine.ignition.status': true,
        'movement.status': false,
        'external.powersource.voltage': 13980,
        'battery.voltage': 4021,
        'battery.level': 88,
        'obd.engine.rpm': 780,
        'engine.coolant.temperature': 91,
        'obd.fuel.level': 64,
        'obd.vehicle.mileage': 135538, // km, as flespi reports (≈84,220 mi)
        'obd.dtc.number': 0,
        'gsm.signal.level': 4,
        'position.altitude': 187,
        'position.satellites': 11,
        'position.hdop': 0.8,
        'position.direction': 145,
        'gnss.status': 3,
        'din.1': 1,
        'sleep.mode': 0,
      },
    },
  },
  {
    id: 'asset-2', company_id: 'mock-company-1', name: 'Link-Belt 130X2 Excavator',
    type: 'equipment', tracker_id: 'gps-002', active: true, hourly_rate: 130, daily_cost: 410,
    metadata: { make: 'Link-Belt', model: '130X2', year: 2019 },
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-2', asset_id: 'asset-2', company_id: 'mock-company-1',
      lat: 36.1636, lng: -86.7828, accuracy: 8, battery: 42, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      raw: {
        source: 'flespi',
        'engine.ignition.status': false,
        'movement.status': false,
        'can.engine.hours': 4187.5,
        'can.engine.temperature': 38,
        'can.fuel.level': 47,
        'external.powersource.voltage': 24120,
        'battery.level': 42,
        'battery.voltage': 3680,
        'gsm.signal.level': 3,
        'position.satellites': 9,
        'position.hdop': 1.1,
        'position.altitude': 192,
        'gnss.status': 3,
        'sleep.mode': 1,
        'movement.idle.time': 0,
      },
    },
  },
  {
    id: 'asset-3', company_id: 'mock-company-1', name: 'John Martinez',
    type: 'personnel', tracker_id: 'bt-003', active: true, hourly_rate: 52,
    metadata: { role: 'Foreman', phone: '615-555-0103' },
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-3', asset_id: 'asset-3', company_id: 'mock-company-1',
      lat: 36.1633, lng: -86.7825, accuracy: 10, battery: 71, speed: 0, heading: 0,
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
      lat: 36.1629, lng: -86.7834, accuracy: 15, battery: 31, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 47 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-5', company_id: 'mock-company-1', name: 'Sakai SW990 Roller',
    type: 'equipment', tracker_id: 'gps-005', active: true, hourly_rate: 85, daily_cost: 210,
    metadata: { make: 'Sakai', model: 'SW990', year: 2012, icon: 'roller' },
    created_at: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-5', asset_id: 'asset-5', company_id: 'mock-company-1',
      lat: 36.1610, lng: -86.7920, accuracy: 6, battery: null, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-6', company_id: 'mock-company-1', name: 'RAM 3500 Dump',
    type: 'vehicle', tracker_id: 'obd-006', active: true, hourly_rate: 95,
    metadata: { make: 'Ram', model: '3500', year: 2022, license: 'SC-DCG-002', icon: 'dump-truck' },
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-6', asset_id: 'asset-6', company_id: 'mock-company-1',
      lat: 36.1615, lng: -86.7885, accuracy: 4, battery: 95, speed: 36, heading: 218,
      timestamp: new Date(Date.now() - 2 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-7', company_id: 'mock-company-1', name: 'Sarah Chen',
    type: 'personnel', tracker_id: 'bt-007', active: true, hourly_rate: 48,
    metadata: { role: 'Site Engineer', phone: '615-555-0107' },
    created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-7', asset_id: 'asset-7', company_id: 'mock-company-1',
      lat: 36.1608, lng: -86.7898, accuracy: 12, battery: 56, speed: 0, heading: 0,
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
      lat: 36.1595, lng: -86.7889, accuracy: 20, battery: 62, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 90 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-9', company_id: 'mock-company-1', name: 'Takeuchi TB235 Mini-Ex',
    type: 'equipment', tracker_id: 'gps-009', active: true, hourly_rate: 90, daily_cost: 175,
    metadata: { make: 'Takeuchi', model: 'TB235', year: 2014 },
    created_at: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-9', asset_id: 'asset-9', company_id: 'mock-company-1',
      lat: 36.1594, lng: -86.7890, accuracy: 7, battery: 78, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(), raw: null,
    },
  },
  {
    id: 'asset-10', company_id: 'mock-company-1', name: 'Peterbilt 567 Tri-Axle',
    type: 'vehicle', tracker_id: 'obd-010', active: true, hourly_rate: 105,
    metadata: { make: 'Peterbilt', model: '567', year: 2015, license: 'SC-DCG-003', icon: 'dump-truck' },
    created_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    location: {
      id: 'loc-10', asset_id: 'asset-10', company_id: 'mock-company-1',
      lat: 36.1663, lng: -86.7895, accuracy: 5, battery: 83, speed: 0, heading: 0,
      timestamp: new Date(Date.now() - 18 * 60000).toISOString(), raw: null,
    },
  },
]

// Demo zones are IRREGULAR polygons on purpose (Brian, Aug 23: "do better
// zones" — the old axis-aligned rectangles read as fake). Real customers
// trace geofences around parcels and pads freehand; these shapes match that.
export const MOCK_GEOFENCES: Geofence[] = [
  {
    id: 'fence-1', company_id: 'mock-company-1', name: 'Riverfront Tower',
    color: '#ff9e16',
    created_at: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7862, 36.1607], [-86.7838, 36.1601], [-86.7815, 36.1606],
        [-86.7808, 36.1622], [-86.7812, 36.1641], [-86.7827, 36.1651],
        [-86.7849, 36.1653], [-86.7861, 36.1643], [-86.7866, 36.1625],
        [-86.7862, 36.1607],
      ]],
    },
  },
  {
    // Staged WEST of the Cumberland (old ring straddled the river, so demo
    // trails "drove across water" — Brian, Aug 5).
    id: 'fence-2', company_id: 'mock-company-1', name: 'Maple St Grading',
    color: '#2dd4bf',
    created_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7934, 36.1587], [-86.7906, 36.1581], [-86.7879, 36.1586],
        [-86.7872, 36.1600], [-86.7877, 36.1621], [-86.7892, 36.1637],
        [-86.7912, 36.1640], [-86.7928, 36.1630], [-86.7936, 36.1610],
        [-86.7934, 36.1587],
      ]],
    },
  },
  {
    id: 'fence-3', company_id: 'mock-company-1', name: 'Equipment Yard',
    color: '#60a5fa', kind: 'yard',
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7908, 36.1652], [-86.7884, 36.1649], [-86.7878, 36.1668],
        [-86.7902, 36.1672], [-86.7908, 36.1652],
      ]],
    },
  },
  {
    // Black outline around the whole demo stage (Brian, Aug 5) — shows the
    // boundary zone kind: perimeter alerts, no job-time accrual.
    id: 'fence-4', company_id: 'mock-company-1', name: 'Property Boundary',
    color: '#0a0a0a', kind: 'boundary',
    created_at: new Date(Date.now() - 85 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7978, 36.1552], [-86.7900, 36.1545], [-86.7800, 36.1558],
        [-86.7778, 36.1590], [-86.7782, 36.1650], [-86.7815, 36.1690],
        [-86.7910, 36.1695], [-86.7965, 36.1665], [-86.7982, 36.1600],
        [-86.7978, 36.1552],
      ]],
    },
  },
  {
    // Vendor zone: where the dump trucks actually GO — deterministic stop
    // names + the supply-run story on the demo stage.
    id: 'fence-5', company_id: 'mock-company-1', name: 'Palmetto Aggregates — Pit 4',
    color: '#a78bfa', kind: 'vendor',
    created_at: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString(),
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-86.7964, 36.1559], [-86.7938, 36.1556], [-86.7930, 36.1572],
        [-86.7944, 36.1584], [-86.7962, 36.1580], [-86.7964, 36.1559],
      ]],
    },
  },
]

// Hand-authored waypoint loops the demo vehicles/equipment FOLLOW instead of
// random-walking. Paths are closed loops; index 0 must equal the asset's
// live position. Each waypoint may carry a third value: the mph AFTER that
// point, which feeds the HUD + speed-colored trails. generateTracks rounds
// the corners (Chaikin) and adds GPS jitter, so these coarse routes render
// as recorded-looking traces, not CAD linework (Brian, Aug 23).
//
// The trucks share ONE road spine (the "artery" points below) — overlapping
// trails on a common corridor is what makes a fleet map read as roads.
export type MockPathPoint = [number, number] | [number, number, number]

// Diagonal artery, NE corner down to the quarry gate in the SW — every
// truck route rides some stretch of these exact points.
const A2: MockPathPoint = [-86.7845, 36.1640, 34]
const A3: MockPathPoint = [-86.7862, 36.1629, 34]
const A4: MockPathPoint = [-86.7885, 36.1615, 36]
const A5: MockPathPoint = [-86.7898, 36.1606, 30]
const A6: MockPathPoint = [-86.7912, 36.1594, 30]
const A7: MockPathPoint = [-86.7930, 36.1585, 22]
const Q_GATE: MockPathPoint = [-86.7941, 36.1578, 8]
const Q_PAD: MockPathPoint = [-86.7951, 36.1569, 4]
// Yard spur off the artery
const Y1: MockPathPoint = [-86.7856, 36.1644, 24]
const Y2: MockPathPoint = [-86.7876, 36.1652, 14]
const Y_GATE: MockPathPoint = [-86.7888, 36.1657, 8]
const Y_PAD: MockPathPoint = [-86.7895, 36.1663, 4]
// Site gates/pads
const RF_GATE: MockPathPoint = [-86.7841, 36.1636, 10]
const RF_PAD: MockPathPoint = [-86.7833, 36.1629, 4]
const MG_GATE: MockPathPoint = [-86.7903, 36.1613, 10]
const MG_PAD: MockPathPoint = [-86.7908, 36.1621, 4]
const MG_LOAD: MockPathPoint = [-86.7904, 36.1596, 4]

export const MOCK_PATHS: Record<string, MockPathPoint[]> = {
  // Chevy 1500 (owner) — supervisor rounds: Riverfront → Maple St → yard →
  // home. Out-and-back on the same artery, like a real workday.
  'asset-1': [
    RF_PAD, RF_GATE, A2, A3, A4, A5, MG_GATE, MG_PAD, MG_GATE, A5, A4, A3,
    A2, Y1, Y2, Y_GATE, Y_PAD, Y_GATE, Y2, Y1, A2, RF_GATE, RF_PAD,
  ],
  // Link-Belt excavator — dig passes on the Riverfront pad (skewed lanes),
  // with a spoil-pile run at the end of each cycle.
  'asset-2': [
    [-86.7828, 36.1636, 3], [-86.7838, 36.1641, 3], [-86.7841, 36.1638, 2],
    [-86.7831, 36.1633, 3], [-86.7833, 36.1630, 3], [-86.7843, 36.1635, 2],
    [-86.7846, 36.1632, 3], [-86.7836, 36.1627, 3], [-86.7838, 36.1624, 3],
    [-86.7848, 36.1629, 2], [-86.7824, 36.1620, 4], [-86.7820, 36.1628, 4],
    [-86.7828, 36.1636, 3],
  ],
  // Sakai roller — compaction lanes across the Maple St pad, slightly
  // skewed like a real lift, stepping over a lane at each end.
  'asset-5': [
    [-86.7920, 36.1610, 4], [-86.7890, 36.1601, 4], [-86.7888, 36.1604, 3],
    [-86.7918, 36.1613, 4], [-86.7916, 36.1616, 3], [-86.7886, 36.1607, 4],
    [-86.7884, 36.1610, 3], [-86.7914, 36.1619, 4], [-86.7912, 36.1622, 3],
    [-86.7882, 36.1613, 4], [-86.7920, 36.1610, 4],
  ],
  // RAM 3500 Dump — material runs: Maple St load-out ↔ Palmetto Aggregates.
  'asset-6': [
    A4, A5, A6, A7, Q_GATE, Q_PAD, Q_GATE, A7, A6, [-86.7908, 36.1599, 8],
    MG_LOAD, [-86.7908, 36.1599, 8], A6, A7, Q_GATE, Q_PAD, Q_GATE, A7, A6,
    A5, A4,
  ],
  // Takeuchi mini-ex — trench line on the Maple St south end: short
  // back-and-forth passes stepping sideways.
  'asset-9': [
    [-86.7890, 36.1594, 2], [-86.7881, 36.1600, 2], [-86.7883, 36.1602, 2],
    [-86.7892, 36.1596, 2], [-86.7894, 36.1598, 2], [-86.7885, 36.1604, 2],
    [-86.7887, 36.1606, 2], [-86.7896, 36.1600, 2], [-86.7890, 36.1594, 2],
  ],
  // Peterbilt 567 — yard ↔ quarry hauls down the full artery.
  'asset-10': [
    Y_PAD, Y_GATE, Y2, Y1, A2, A3, A4, A5, A6, A7, Q_GATE,
    [-86.7947, 36.1565, 4], Q_GATE, A7, A6, A5, A4, A3, A2, Y1, Y2,
    Y_GATE, Y_PAD,
  ],
}

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

export const DEMO_MAP_CENTER: [number, number] = [-86.7876, 36.1620]
/** Demo stage bounds (just inside the Property Boundary) — random-walk demo
 *  movement must stay inside; nothing wanders across town or the river. */
export const DEMO_BOUNDS = { west: -86.7970, east: -86.7790, south: 36.1552, north: 36.1690 }
export const DEMO_MAP_ZOOM = 14.2

// ── v2: Bluetooth tool associations ──────────────────────────────────────────
// The two tool assets (asset-4 Drill Kit, asset-8 Level & Survey Kit) are
// detected by truck/equipment gateways via BLE.
export const MOCK_TOOL_ASSOCIATIONS: ToolAssociation[] = [
  {
    id: 'assoc-1', company_id: 'mock-company-1',
    tool_asset_id: 'asset-4', gateway_asset_id: 'asset-1', // Drill Kit in Chevy 1500
    rssi: -62, last_seen: new Date(Date.now() - 6 * 60000).toISOString(),
  },
  {
    id: 'assoc-2', company_id: 'mock-company-1',
    tool_asset_id: 'asset-8', gateway_asset_id: 'asset-9', // Survey Kit on Takeuchi mini-ex
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
    asset_id: 'asset-1', asset_name: 'Chevy 1500 — Owner', asset_type: 'vehicle',
    engine_hours: 168, idle_hours: 31, distance_miles: 2240,
    job_site_hours: [
      { geofence_id: 'fence-1', geofence_name: 'Riverfront Tower', hours: 96 },
      { geofence_id: 'fence-2', geofence_name: 'Maple St Grading', hours: 41 },
    ],
  },
  {
    asset_id: 'asset-2', asset_name: 'Link-Belt 130X2 Excavator', asset_type: 'equipment',
    engine_hours: 212, idle_hours: 58, distance_miles: 0,
    job_site_hours: [{ geofence_id: 'fence-1', geofence_name: 'Riverfront Tower', hours: 198 }],
  },
  {
    asset_id: 'asset-9', asset_name: 'Takeuchi TB235 Mini-Ex', asset_type: 'equipment',
    engine_hours: 143, idle_hours: 22, distance_miles: 0,
    job_site_hours: [{ geofence_id: 'fence-1', geofence_name: 'Riverfront Tower', hours: 131 }],
  },
  {
    asset_id: 'asset-6', asset_name: 'RAM 3500 Dump', asset_type: 'vehicle',
    engine_hours: 201, idle_hours: 47, distance_miles: 3110,
    job_site_hours: [
      { geofence_id: 'fence-1', geofence_name: 'Riverfront Tower', hours: 74 },
      { geofence_id: 'fence-2', geofence_name: 'Maple St Grading', hours: 88 },
    ],
  },
]

// ── v2: QuickBooks (demo connection) ────────────────────────────────────────────
export const MOCK_QBO_CONNECTION: QboConnection = {
  company_id: 'mock-company-1',
  realm_id: 'demo-realm-4620816365',
  connected_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
  company_name: 'Blue Ridge Sitework Co. (Sandbox)',
}

// Equipment billing rates ($/engine-hour) used for usage-invoice generation
export const MOCK_EQUIPMENT_RATES: Record<string, number> = {
  'asset-2': 145, // Link-Belt 130X2 Excavator
  'asset-9': 95,  // Takeuchi TB235 Mini-Ex
  'asset-1': 45,  // Chevy 1500 — Owner
  'asset-6': 45,  // RAM 3500 Dump
  'asset-10': 65, // Peterbilt 567 Tri-Axle
}

// ── Fleet scorecard (demo) ───────────────────────────────────────────────────
// Three personalities that SELL the report: the model employee, the yard
// truck, and the one worth a conversation. Deterministic jitter (no RNG) so
// the page is stable between refreshes.

interface MockDayCfg {
  first: number; onSite: number | null; last: number
  active: number; idle: number; miles: number
  satFactor: number   // how much of a day Saturday is (0 = off)
}

function mockDays(cfg: MockDayCfg, daysBack: number, extras?: (d: DayRhythm, weekday: number, i: number) => void): DayRhythm[] {
  const out: DayRhythm[] = []
  const today = new Date()
  for (let i = daysBack - 1; i >= 0; i--) {
    const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const weekday = dt.getDay()
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const workday = weekday >= 1 && weekday <= 6
    const f = weekday === 6 ? cfg.satFactor : weekday === 0 ? 0 : 1
    const jit = ((i * 7919) % 23) - 11 // ±11 min, deterministic
    const d: DayRhythm = {
      day: key,
      firstMoveMin: f > 0 ? cfg.first + jit : null,
      firstOnSiteMin: f > 0 && cfg.onSite != null ? cfg.onSite + jit : null,
      lastMoveMin: f > 0 ? Math.round(cfg.first + (cfg.last - cfg.first) * f) + jit : null,
      activeMin: Math.round(cfg.active * f),
      idleMin: Math.round(cfg.idle * f),
      miles: Math.round(cfg.miles * f),
      afterHoursMiles: 0,
      afterHoursMovingMin: 0,
      workday,
    }
    extras?.(d, weekday, i)
    out.push(d)
  }
  return out
}

function summarize(assetId: string, name: string, days: DayRhythm[], stops: StopMix[], siteHours: VehicleScore['siteHours']): VehicleScore {
  const act = days.filter((d) => d.firstMoveMin != null)
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
  const activeMin = days.reduce((s, d) => s + d.activeMin, 0)
  const idleMin = days.reduce((s, d) => s + d.idleMin, 0)
  return {
    assetId, name,
    daysActive: act.length, daysInRange: days.length,
    medFirstMove: med(act.map((d) => d.firstMoveMin!)),
    medFirstOnSite: med(act.map((d) => d.firstOnSiteMin).filter((x): x is number => x != null)),
    medLastMove: med(act.map((d) => d.lastMoveMin).filter((x): x is number => x != null)),
    activeHrs: Math.round(activeMin / 6) / 10,
    idleHrs: Math.round(idleMin / 6) / 10,
    idlePct: activeMin + idleMin > 0 ? Math.round((idleMin / (activeMin + idleMin)) * 100) : 0,
    miles: days.reduce((s, d) => s + d.miles, 0),
    afterHoursMiles: Math.round(days.reduce((s, d) => s + d.afterHoursMiles, 0)),
    afterHoursHrs: Math.round(days.reduce((s, d) => s + d.afterHoursMovingMin, 0) / 6) / 10,
    weekendMiles: days.filter((d) => !d.workday).reduce((s, d) => s + d.miles, 0),
    days, stops, siteHours, pendingStops: [],
  }
}

/** Demo scorecard over the trailing `daysBack` calendar days (min 1). */
export function buildMockScorecard(daysBack: number): VehicleScore[] {
  const n = Math.max(1, Math.min(45, Math.round(daysBack)))
  const scale = (m: number) => Math.round((m * n) / 30) // 30d-shaped totals → range

  // The model employee: rolling before 7, on site quick, home by 5.
  const chevy = summarize('asset-1', 'Chevy 1500 — Owner',
    mockDays({ first: 6 * 60 + 38, onSite: 7 * 60 + 4, last: 17 * 60 + 6, active: 340, idle: 76, miles: 74, satFactor: 0.5 }, n),
    [
      { kind: 'site', count: scale(46), minutes: scale(5940), workMinutes: scale(5760), topName: 'Riverfront Tower', topMinutes: 260 },
      { kind: 'supplier', count: scale(11), minutes: scale(430), workMinutes: scale(430), topName: '84 Lumber', topMinutes: 55 },
      { kind: 'fuel', count: scale(8), minutes: scale(96), workMinutes: scale(80), topName: 'Shell — Wade Hampton Blvd', topMinutes: 14 },
      { kind: 'food', count: scale(9), minutes: scale(280), workMinutes: scale(280), topName: 'Bojangles — Laurens Rd', topMinutes: 38 },
    ],
    [
      { id: 'fence-1', name: 'Riverfront Tower', hours: scale(96) },
      { id: 'fence-2', name: 'Maple St Grading', hours: scale(41) },
    ])

  // The conversation: late starts, long lunches, a Sunday trip, midday hours
  // at a residence. This card is the sales demo.
  const peterbilt = summarize('asset-10', 'Peterbilt 567 Tri-Axle',
    mockDays({ first: 8 * 60 + 12, onSite: 9 * 60 + 18, last: 16 * 60 + 24, active: 235, idle: 118, miles: 58, satFactor: 0 }, n,
      (d, weekday, i) => {
        if (weekday === 0 && i < 14) { // Sunday runs inside the last two weeks
          d.firstMoveMin = 10 * 60 + 24
          d.lastMoveMin = 14 * 60 + 42
          d.activeMin = 95; d.idleMin = 24; d.miles = 52
          d.afterHoursMiles = 52; d.afterHoursMovingMin = 95
        } else if (weekday === 5) { // Fridays trail off early with an errand loop
          d.lastMoveMin = 15 * 60 + 6
          d.afterHoursMiles = 9; d.afterHoursMovingMin = 22
        }
      }),
    [
      { kind: 'site', count: scale(31), minutes: scale(3810), workMinutes: scale(3705), topName: 'Maple St Grading', topMinutes: 210 },
      { kind: 'supplier', count: scale(6), minutes: scale(220), workMinutes: scale(220), topName: 'SiteOne Landscape', topMinutes: 48 },
      { kind: 'fuel', count: scale(9), minutes: scale(112), workMinutes: scale(96), topName: 'QuikTrip #482', topMinutes: 16 },
      { kind: 'food', count: scale(22), minutes: scale(1240), workMinutes: scale(1180), topName: 'Waffle House — White Horse Rd', topMinutes: 96 },
      { kind: 'store', count: scale(12), minutes: scale(540), workMinutes: scale(505), topName: 'Bass Pro Shops', topMinutes: 88 },
      { kind: 'residence', count: scale(8), minutes: scale(660), workMinutes: scale(610), topName: 'Stonebrook Dr', topMinutes: 145 },
    ],
    [{ id: 'fence-2', name: 'Maple St Grading', hours: scale(64) }])

  // The yard truck: short hops, half its engine time idling at the gate.
  const ram = summarize('asset-6', 'RAM 3500 Dump',
    mockDays({ first: 7 * 60 + 18, onSite: 7 * 60 + 32, last: 15 * 60 + 48, active: 120, idle: 96, miles: 21, satFactor: 0.4 }, n),
    [
      { kind: 'site', count: scale(38), minutes: scale(4620), workMinutes: scale(4540), topName: 'Equipment Yard', topMinutes: 240 },
      { kind: 'supplier', count: scale(9), minutes: scale(310), workMinutes: scale(310), topName: 'Ferguson Waterworks', topMinutes: 42 },
      { kind: 'fuel', count: scale(5), minutes: scale(60), workMinutes: scale(60), topName: 'Marathon — Poinsett Hwy', topMinutes: 13 },
    ],
    [
      { id: 'fence-3', name: 'Equipment Yard', hours: scale(88) },
      { id: 'fence-1', name: 'Riverfront Tower', hours: scale(22) },
    ])

  // Equipment reads differently: no commute, the story is hours-on-site.
  const linkBelt = summarize('asset-2', 'Link-Belt 130X2 Excavator',
    mockDays({ first: 7 * 60 + 22, onSite: 7 * 60 + 22, last: 16 * 60 + 30, active: 355, idle: 128, miles: 1, satFactor: 0.3 }, n),
    [{ kind: 'site', count: scale(26), minutes: scale(11040), workMinutes: scale(10520), topName: 'Riverfront Tower', topMinutes: 540 }],
    [{ id: 'fence-1', name: 'Riverfront Tower', hours: scale(198) }])

  return [peterbilt, chevy, ram, linkBelt].sort((a, b) => b.miles - a.miles)
}
