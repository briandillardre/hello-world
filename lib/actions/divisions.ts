'use server'

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'

/**
 * Division writes (migration 106). Every one goes through requireEditOrThrow,
 * so a read-only role — or an admin inside a view-as preview — cannot rename
 * or re-label anything by calling the action directly.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const HEX = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLOR = '#2dd4bf'

type Res = { ok: boolean; id?: string; error?: string }

/** Missing table (106 not applied) reads as a plain-words answer, not a stack. */
function friendly(message: string): string {
  if (/relation .*divisions.* does not exist|schema cache|division_id/i.test(message)) {
    return 'Divisions need one database update — it lands with the next deploy.'
  }
  return message
}

function paths() {
  revalidatePath('/map')
  revalidatePath('/assets')
  revalidatePath('/zones')
  revalidatePath('/settings')
}

export async function createDivisionAction(name: string, color?: string): Promise<Res> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  const clean = name.trim().slice(0, 60)
  if (!clean) return { ok: false, error: 'Give the division a name.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('divisions')
      .insert({
        company_id: companyId,
        name: clean,
        color: color && HEX.test(color) ? color : DEFAULT_COLOR,
        created_by: user?.id ?? null,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') return { ok: false, error: `You already have a division called “${clean}”.` }
      return { ok: false, error: friendly(error.message) }
    }
    paths()
    return { ok: true, id: data.id as string }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? friendly(e.message) : 'Could not create it.' }
  }
}

export async function updateDivisionAction(
  id: string,
  patch: { name?: string; color?: string; notes?: string | null },
): Promise<Res> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  if (!id) return { ok: false, error: 'Missing division.' }
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const clean = patch.name.trim().slice(0, 60)
    if (!clean) return { ok: false, error: 'Give the division a name.' }
    row.name = clean
  }
  if (patch.color !== undefined && HEX.test(patch.color)) row.color = patch.color
  if (patch.notes !== undefined) row.notes = patch.notes ? patch.notes.slice(0, 300) : null
  if (!Object.keys(row).length) return { ok: true }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase.from('divisions').update(row).eq('id', id)
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'Another division already has that name.' }
      return { ok: false, error: friendly(error.message) }
    }
    paths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? friendly(e.message) : 'Could not save it.' }
  }
}

/** Archive, never delete: the label stays readable on everything that wore it,
 *  and Restore puts it back in the pickers. */
export async function setDivisionArchivedAction(id: string, archived: boolean): Promise<Res> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  if (!id) return { ok: false, error: 'Missing division.' }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { error } = await supabase
      .from('divisions')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id)
    if (error) return { ok: false, error: friendly(error.message) }
    paths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? friendly(e.message) : 'Could not archive it.' }
  }
}

/** Label one asset / zone / place. `divisionId = null` clears it. RLS keeps
 *  the row in the caller's company; the id is verified to belong there too so
 *  a hand-made call can't borrow another company's division. */
export async function setRowDivisionAction(
  table: 'assets' | 'geofences' | 'places',
  rowId: string,
  divisionId: string | null,
): Promise<Res> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  if (!rowId) return { ok: false, error: 'Missing row.' }
  if (table !== 'assets' && table !== 'geofences' && table !== 'places') return { ok: false, error: 'Unknown table.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    if (divisionId) {
      const { data: div } = await supabase
        .from('divisions').select('id').eq('id', divisionId).eq('company_id', companyId).maybeSingle()
      if (!div) return { ok: false, error: 'That division is not in this company.' }
    }
    const { error } = await supabase.from(table).update({ division_id: divisionId }).eq('id', rowId)
    if (error) return { ok: false, error: friendly(error.message) }
    paths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? friendly(e.message) : 'Could not save it.' }
  }
}

/** Label everything at once — the "put all 14 Upstate trucks in Upstate" move
 *  nobody wants to do fourteen times. Capped so one call can't rewrite a fleet. */
export async function bulkSetDivisionAction(
  table: 'assets' | 'geofences',
  rowIds: string[],
  divisionId: string | null,
): Promise<Res> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Not available in demo.' }
  const ids = Array.from(new Set(rowIds.filter((x) => typeof x === 'string' && x))).slice(0, 500)
  if (!ids.length) return { ok: false, error: 'Nothing selected.' }
  if (table !== 'assets' && table !== 'geofences') return { ok: false, error: 'Unknown table.' }
  try {
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    if (divisionId) {
      const { data: div } = await supabase
        .from('divisions').select('id').eq('id', divisionId).eq('company_id', companyId).maybeSingle()
      if (!div) return { ok: false, error: 'That division is not in this company.' }
    }
    const { error } = await supabase.from(table).update({ division_id: divisionId }).in('id', ids)
    if (error) return { ok: false, error: friendly(error.message) }
    paths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? friendly(e.message) : 'Could not save it.' }
  }
}
