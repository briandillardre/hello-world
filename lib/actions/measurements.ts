'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import type { MeasureKind, MeasureProps } from '@/lib/db/measurements'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SaveMeasurementInput {
  name: string
  kind: MeasureKind
  personal: boolean
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
  props: MeasureProps
}

export async function saveMeasurementAction(input: SaveMeasurementInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }
    const { data, error } = await supabase
      .from('measurements')
      .insert({
        company_id: companyId,
        owner_id: input.personal ? user.id : null,
        name: input.name.trim() || 'Measurement',
        kind: input.kind,
        geometry: input.geometry,
        props: input.props,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    revalidatePath('/map')
    return { ok: true, id: data.id as string }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed.' }
  }
}

export async function deleteMeasurementAction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('measurements').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/map')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed.' }
  }
}
