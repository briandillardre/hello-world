'use server'

import { revalidatePath } from 'next/cache'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// One phone asset per user, keyed by a deterministic tracker id.
const phoneTracker = (userId: string) => `phone-${userId}`

export interface PhoneFix {
  lat: number
  lng: number
  speed?: number | null
  accuracy?: number | null
  heading?: number | null
  battery?: number | null
}

/**
 * Push one GPS fix from the signed-in user's phone onto the fleet map. Auth is
 * the Supabase session cookie (no API key exposed to the browser); on first use
 * it provisions a personnel "phone" asset for the user, then appends a location.
 * The main map picks it up like any other tracker.
 */
export async function pushPhoneLocation(fix: PhoneFix): Promise<{ ok: boolean; assetId?: string; reason?: string }> {
  const { lat, lng } = fix
  if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'coords' }
  }
  if (isMock) return { ok: false, reason: 'demo' }

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'auth' }

  const { data: profile } = await supabase.from('profiles').select('company_id, name').eq('id', user.id).single()
  const companyId = profile?.company_id ?? user.id
  const trackerId = phoneTracker(user.id)

  const svc = createServiceClient()
  // Find or (re)create the phone asset — reactivated if a prior share stopped it.
  const { data: existing } = await svc
    .from('assets')
    .select('id, active')
    .eq('company_id', companyId)
    .eq('tracker_id', trackerId)
    .maybeSingle()

  let assetId = existing?.id as string | undefined
  if (!assetId) {
    const name = profile?.name ? `${profile.name} (phone)` : 'My phone'
    const { data: created, error } = await svc
      .from('assets')
      .insert({ company_id: companyId, name, type: 'personnel', tracker_id: trackerId, active: true, metadata: { source: 'phone' } })
      .select('id')
      .single()
    if (error || !created) return { ok: false, reason: 'asset' }
    assetId = created.id
  } else if (existing && !existing.active) {
    await svc.from('assets').update({ active: true }).eq('id', assetId)
  }

  const { error: locErr } = await svc.from('asset_locations').insert({
    asset_id: assetId,
    company_id: companyId,
    lat,
    lng,
    accuracy: fix.accuracy ?? null,
    battery: fix.battery ?? null,
    speed: fix.speed ?? null,
    heading: fix.heading ?? null,
    timestamp: new Date().toISOString(),
    raw: { source: 'phone', ...fix },
  })
  if (locErr) return { ok: false, reason: 'location' }

  revalidatePath('/map')
  return { ok: true, assetId }
}

/** Stop sharing: deactivate the phone asset so its pin drops off the fleet map
 *  (history is kept). Next share reactivates it. */
export async function stopPhoneShare(): Promise<{ ok: boolean }> {
  if (isMock) return { ok: false }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
  const companyId = profile?.company_id ?? user.id
  const svc = createServiceClient()
  await svc.from('assets').update({ active: false }).eq('company_id', companyId).eq('tracker_id', phoneTracker(user.id))
  revalidatePath('/map')
  return { ok: true }
}
