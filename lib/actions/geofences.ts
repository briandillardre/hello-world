'use server'

import { revalidatePath } from 'next/cache'
import { getGeofence, createGeofence, updateGeofence, deleteGeofence, logZoneEvent } from '@/lib/db/geofences'
import { getCurrentCompanyId } from '@/lib/db/company'

/** Who's performing the action, for the zone change log. */
async function currentActor(): Promise<{ id: string | null; name: string }> {
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const s = createClient()
    const { data: { user } } = await s.auth.getUser()
    if (!user) return { id: null, name: 'System' }
    const { data: p } = await s.from('profiles').select('name').eq('id', user.id).maybeSingle()
    return { id: user.id, name: (p?.name as string) || user.email || 'User' }
  } catch { return { id: null, name: 'User' } }
}

export interface ZoneLifecycleOpts {
  personal?: boolean
  active_from?: string | null
  active_until?: string | null
}

export async function createGeofenceAction(
  name: string, geometry: GeoJSON.Polygon, color: string,
  kind: 'site' | 'boundary' | 'yard' = 'site', opts?: ZoneLifecycleOpts
) {
  const companyId = await getCurrentCompanyId()
  const id = await createGeofence(companyId, {
    name, geometry, color, kind,
    personal: opts?.personal, active_from: opts?.active_from ?? null, active_until: opts?.active_until ?? null,
  })
  if (id) {
    // Personal zones are private reference only — they never drive company
    // alerts, so skip the default enter/exit rules. Global zones get them:
    // without a rule nothing ever fires (owner, Jul 14). Deletable on /alerts.
    if (!opts?.personal) {
      try {
        const { createAlertRule } = await import('../db/alerts')
        await createAlertRule(companyId, { geofence_id: id, asset_id: null, trigger: 'enter', idle_minutes: null })
        await createAlertRule(companyId, { geofence_id: id, asset_id: null, trigger: 'exit', idle_minutes: null })
      } catch { /* rules are additive — zone creation must not fail on them */ }
    }
    const actor = await currentActor()
    await logZoneEvent(companyId, id, actor.id, 'created', { by: actor.name, kind, personal: !!opts?.personal })
  }
  revalidatePath('/geofences')
  revalidatePath('/map')
  // Null = the insert didn't happen (RPC error / RLS) — callers surface it.
  return id
}

export async function saveGeofenceAction(
  id: string,
  name: string,
  color: string,
  parentId: string | null,
  geometry?: GeoJSON.Polygon,
  kind?: 'site' | 'boundary' | 'yard',
  opts?: ZoneLifecycleOpts & { clear_dates?: boolean }
) {
  const g = await getGeofence(id)
  if (!g) return
  const geomChanged = !!geometry && JSON.stringify(geometry) !== JSON.stringify(g.geometry)
  await updateGeofence(id, {
    name, color, geometry: geometry ?? g.geometry, parent_id: parentId, kind,
    personal: opts?.personal, active_from: opts?.active_from, active_until: opts?.active_until, clear_dates: opts?.clear_dates,
  })

  // Log what changed so the zone page can explain shifts in hours/acreage.
  const changed: string[] = []
  if (name !== g.name) changed.push('name')
  if (color !== g.color) changed.push('color')
  if (kind && kind !== g.kind) changed.push('kind')
  if (geomChanged) changed.push('boundary')
  if (opts && (opts.active_from !== undefined || opts.active_until !== undefined || opts.clear_dates)) changed.push('dates')
  if (opts?.personal !== undefined) changed.push('visibility')
  if (changed.length) {
    const companyId = await getCurrentCompanyId()
    const actor = await currentActor()
    await logZoneEvent(companyId, id, actor.id, geomChanged ? 'reshaped' : 'edited', {
      by: actor.name, changed,
      from: { name: g.name, color: g.color, kind: g.kind ?? 'site' },
      to: { name, color, kind: kind ?? g.kind ?? 'site' },
    })
  }
  revalidatePath('/geofences')
  revalidatePath(`/geofences/${id}`)
  revalidatePath('/map')
}

export async function deleteGeofenceAction(id: string) {
  await deleteGeofence(id)
  revalidatePath('/geofences')
  revalidatePath('/map')
}

/** Owner notes on a zone — free text the panel shows and the AI reads.
 *  Direct column update (RLS-scoped); RPC untouched. */
export async function saveZoneNotesAction(id: string, notes: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase
      .from('geofences')
      .update({ notes: notes.trim() || null })
      .eq('id', id)
    if (error) {
      // 42703 = column missing → migration 020 not applied yet.
      if (error.code === '42703') return { ok: false, error: 'Run migration 020_notes.sql first.' }
      return { ok: false, error: error.message }
    }
    revalidatePath(`/geofences/${id}`)
    revalidatePath('/geofences')
    revalidatePath('/map')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'failed' }
  }
}

/** Document-folder link on a zone (Dropbox/Drive/etc.) — just a URL. */
export async function saveZoneFolderAction(id: string, folderUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = folderUrl.trim()
    if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: 'Enter a full link starting with https://' }
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase
      .from('geofences')
      .update({ folder_url: url || null })
      .eq('id', id)
    if (error) {
      if (error.code === '42703') return { ok: false, error: 'Run migration 032 first.' }
      return { ok: false, error: error.message }
    }
    revalidatePath(`/geofences/${id}`)
    revalidatePath('/map')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'failed' }
  }
}
