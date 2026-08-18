import type { LengthUnit, AreaUnit, Takeoff } from '@/lib/measure'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export type MeasureKind = 'point' | 'line' | 'area'

export interface MeasureProps {
  lengthUnit?: LengthUnit
  areaUnit?: AreaUnit
  lengthFt?: number
  areaSqFt?: number
  statePlane?: { northing: number; easting: number }
  elevationFt?: number | null
  takeoff?: Takeoff | null
}

export interface Measurement {
  id: string
  name: string
  kind: MeasureKind
  personal: boolean
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
  props: MeasureProps
  created_at: string
}

/** One saved measurement by id (RLS scopes to the caller's visibility). */
export async function getMeasurement(id: string): Promise<Measurement | null> {
  if (isMock || !id) return null
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data: r } = await supabase
    .from('measurements')
    .select('id, name, kind, owner_id, geometry, props, created_at')
    .eq('id', id)
    .maybeSingle()
  if (!r) return null
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as MeasureKind,
    personal: r.owner_id != null,
    geometry: r.geometry as Measurement['geometry'],
    props: (r.props ?? {}) as MeasureProps,
    created_at: r.created_at as string,
  }
}

// Demo seeds — the saved-measurements layer has to demo itself. Shapes sit on
// the Nashville demo stage next to the mock fleet (WEST of the river).
const MOCK_MEASUREMENTS: Measurement[] = [
  {
    id: 'meas-demo-1',
    name: 'Pad A — 4" gravel',
    kind: 'area',
    personal: false,
    geometry: { type: 'Polygon', coordinates: [[
      [-86.7846, 36.1631], [-86.7838, 36.1633], [-86.7834, 36.1628],
      [-86.7842, 36.1625], [-86.7846, 36.1631],
    ]] },
    props: { areaUnit: 'sf', areaSqFt: 26800, lengthUnit: 'ft', takeoff: { cubicFt: 8933, cubicYd: 331, tons: 464, material: 'Gravel (crushed)', depthIn: 4 } },
    created_at: '2026-08-12T14:20:00Z',
  },
  {
    id: 'meas-demo-2',
    name: 'Silt fence run',
    kind: 'line',
    personal: false,
    geometry: { type: 'LineString', coordinates: [
      [-86.7852, 36.1620], [-86.7843, 36.1617], [-86.7833, 36.1618],
    ] },
    props: { lengthUnit: 'ft', lengthFt: 560 },
    created_at: '2026-08-13T11:05:00Z',
  },
]

/** All measurements visible to the caller (company + own personal), newest first. */
export async function getMeasurements(companyId: string): Promise<Measurement[]> {
  if (isMock) return MOCK_MEASUREMENTS
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data } = await supabase
    .from('measurements')
    .select('id, name, kind, owner_id, geometry, props, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as MeasureKind,
    personal: r.owner_id != null,
    geometry: r.geometry as Measurement['geometry'],
    props: (r.props ?? {}) as MeasureProps,
    created_at: r.created_at as string,
  }))
}
