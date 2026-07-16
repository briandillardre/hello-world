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

/** All measurements visible to the caller (company + own personal), newest first. */
export async function getMeasurements(companyId: string): Promise<Measurement[]> {
  if (isMock) return []
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
