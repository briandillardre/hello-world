'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireEditOrThrow, getMyPermissions, requireFeature } from '@/lib/permissions-server'
import { ipRateLimited } from '@/lib/rate-limit'
import { getCurrentCompanyId } from '@/lib/db/company'
import { lookupAircraft, identFromTrace } from '@/lib/aircraft-source'
import type { SavedAircraft } from '@/lib/db/aircraft'

/**
 * Saving and un-saving watched aircraft (migration 108).
 *
 * Saving is not a bookmark. The upstream archive only keeps ~30 days, so
 * saving a plane is what tells the nightly cron to start banking its flights
 * into our own tables — it is the difference between "the last month" and a
 * log that keeps going. The UI says so at the button.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface SaveResult { ok: boolean; error?: string; aircraft?: SavedAircraft }

/**
 * How many aircraft one company may watch.
 *
 * Every saved plane is permanent nightly cron work and permanent JSONB in
 * `aircraft_flights`. Without a cap, a script that saves fifty thousand hexes
 * starves every real customer's plane behind the nightly budget forever
 * (sec-check, Sep 12).
 */
const MAX_SAVED = 25

/** Server actions never pass through the route rate limiter, so they need
 *  their own — this one reaches two third-party APIs. */
function actionRateLimited(tag: string, limit: number): boolean {
  try {
    return ipRateLimited({ headers: { get: (k: string) => headers().get(k) } }, tag, limit)
  } catch {
    return false // no request context (tests) — nothing to limit
  }
}

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim().slice(0, max)
  return s || null
}

/** Save an airframe by hex — the identity is re-resolved server-side, never
 *  trusted from the form (a client could otherwise file any label it liked
 *  against any hex). */
export async function saveAircraftAction(input: { hex: string; label?: string; notes?: string }): Promise<SaveResult> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode — saving planes works once signed in to your company.' }
  await requireFeature('aircraft')
  const perms = await getMyPermissions()
  if (!perms.canEdit) return { ok: false, error: 'Your role can read the flight log but not save planes.' }
  if (actionRateLimited('ac-save', 10)) return { ok: false, error: 'Slow down a moment.' }

  const hex = String(input.hex ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(hex)) return { ok: false, error: 'That is not an aircraft address.' }

  const companyId = await getCurrentCompanyId()
  if (!companyId) return { ok: false, error: 'No company.' }

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  const db = createServiceClient()

  // Re-saving something already on the list is an edit, not a duplicate, and
  // un-deleting a previously removed one keeps its banked history attached.
  const { data: existing } = await db.from('aircraft_saved')
    .select('id').eq('company_id', companyId).eq('hex', hex).eq('active', true).maybeSingle()

  if (!existing) {
    const { count } = await db.from('aircraft_saved')
      .select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('active', true)
    if ((count ?? 0) >= MAX_SAVED) {
      return { ok: false, error: `You can watch ${MAX_SAVED} aircraft. Remove one to add another.` }
    }
  }

  // Identity lookup AFTER the cap check, so a refused save costs no upstream
  // calls at all.
  const ident = (await lookupAircraft(hex)) ?? (await identFromTrace(hex))

  const row = {
    company_id: companyId,
    hex,
    reg: ident?.reg ?? null,
    type_code: ident?.typeCode ?? null,
    descr: ident?.desc ?? null,
    owner: ident?.owner ?? null,
    label: clean(input.label, 60),
    notes: clean(input.notes, 400),
    active: true,
  }

  const q = existing
    ? db.from('aircraft_saved').update(row).eq('id', (existing as { id: string }).id)
    : db.from('aircraft_saved').insert({ ...row, created_by: user?.id ?? null })
  const { error } = await q
  if (error) {
    console.error('saveAircraft failed', error.message)
    return {
      ok: false,
      error: error.message.includes('relation')
        ? 'The flight log is still deploying — try again in a minute.'
        : 'Could not save that plane.',
    }
  }
  revalidatePath('/aircraft')
  return { ok: true }
}

export async function removeAircraftAction(hex: string): Promise<SaveResult> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  await requireFeature('aircraft')
  const perms = await getMyPermissions()
  if (!perms.canEdit) return { ok: false, error: 'Your role can read the flight log but not change it.' }
  const h = String(hex ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(h)) return { ok: false, error: 'That is not an aircraft address.' }
  const companyId = await getCurrentCompanyId()
  if (!companyId) return { ok: false, error: 'No company.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  // Soft: the banked flights stay, so re-saving later picks the log back up
  // where it left off instead of starting from the last 30 days again.
  const { error } = await createServiceClient()
    .from('aircraft_saved').update({ active: false }).eq('company_id', companyId).eq('hex', h)
  if (error) return { ok: false, error: 'Could not remove that plane.' }
  revalidatePath('/aircraft')
  return { ok: true }
}

/** Rename ("the boss's plane") or re-note one saved airframe. */
export async function labelAircraftAction(hex: string, label: string, notes?: string): Promise<SaveResult> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  await requireFeature('aircraft')
  const perms = await getMyPermissions()
  if (!perms.canEdit) return { ok: false, error: 'Your role can read the flight log but not change it.' }
  const h = String(hex ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(h)) return { ok: false, error: 'That is not an aircraft address.' }
  const companyId = await getCurrentCompanyId()
  if (!companyId) return { ok: false, error: 'No company.' }

  const patch: Record<string, string | null> = { label: clean(label, 60) }
  if (notes !== undefined) patch.notes = clean(notes, 400)
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { error } = await createServiceClient()
    .from('aircraft_saved').update(patch).eq('company_id', companyId).eq('hex', h).eq('active', true)
  if (error) return { ok: false, error: 'Could not save that.' }
  revalidatePath('/aircraft')
  return { ok: true }
}
