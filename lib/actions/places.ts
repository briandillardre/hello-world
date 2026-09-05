'use server'
import { requireEditOrThrow } from '@/lib/permissions-server'

import { revalidatePath } from 'next/cache'
import { createPlace, updatePlace, removePlace } from '@/lib/db/places'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import type { Place, PlaceKind } from '@/lib/types'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const KINDS: PlaceKind[] = ['supplier', 'fuel', 'dump', 'shop', 'customer', 'rental', 'other']

function clean(input: { name: string; kind: string; lat: number; lng: number; address?: string | null; notes?: string | null }):
  { ok: true; name: string; kind: PlaceKind; lat: number; lng: number; address: string | null; notes: string | null } | { ok: false; error: string } {
  const name = String(input.name ?? '').trim().slice(0, 80)
  if (!name) return { ok: false, error: 'Give the place a name.' }
  const kind = (KINDS as string[]).includes(input.kind) ? (input.kind as PlaceKind) : 'other'
  const lat = Number(input.lat), lng = Number(input.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    return { ok: false, error: 'That pin has no valid location.' }
  }
  return {
    ok: true, name, kind, lat, lng,
    address: String(input.address ?? '').trim().slice(0, 160) || null,
    notes: String(input.notes ?? '').trim().slice(0, 400) || null,
  }
}

export async function createPlaceAction(input: { name: string; kind: string; lat: number; lng: number; address?: string | null; notes?: string | null }):
  Promise<{ ok: boolean; place?: Place; error?: string }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode — saving places works once signed in to your company.' }
  const perms = await getMyPermissions()
  if (!perms.canEdit) return { ok: false, error: 'Your role can view places but not add them.' }
  const v = clean(input)
  if (!v.ok) return { ok: false, error: v.error }

  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  const { place, error } = await createPlace(companyId, { ...v, createdBy: user?.id ?? null })
  if (error || !place) return { ok: false, error: error?.includes('relation') ? 'Places is still deploying — try again in a minute.' : (error ?? 'Could not save') }
  revalidatePath('/map')
  return { ok: true, place }
}

export async function updatePlaceAction(id: string, patch: { name?: string; kind?: string; notes?: string | null; address?: string | null }):
  Promise<{ ok: boolean; error?: string }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode — editing places works once signed in.' }
  const perms = await getMyPermissions()
  if (!perms.canEdit) return { ok: false, error: 'Your role can view places but not edit them.' }
  const companyId = await getCurrentCompanyId()
  const out: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const n = String(patch.name).trim().slice(0, 80)
    if (!n) return { ok: false, error: 'Give the place a name.' }
    out.name = n
  }
  if (patch.kind !== undefined) out.kind = (KINDS as string[]).includes(patch.kind) ? patch.kind : 'other'
  if (patch.notes !== undefined) out.notes = String(patch.notes ?? '').trim().slice(0, 400) || null
  if (patch.address !== undefined) out.address = String(patch.address ?? '').trim().slice(0, 160) || null
  const err = await updatePlace(companyId, id, out)
  if (err) return { ok: false, error: err }
  revalidatePath('/map')
  return { ok: true }
}

export async function removePlaceAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireEditOrThrow()
  if (isMock) return { ok: false, error: 'Demo mode.' }
  const perms = await getMyPermissions()
  if (!perms.canEdit) return { ok: false, error: 'Your role can view places but not remove them.' }
  const companyId = await getCurrentCompanyId()
  const err = await removePlace(companyId, id)
  if (err) return { ok: false, error: err }
  revalidatePath('/map')
  return { ok: true }
}
