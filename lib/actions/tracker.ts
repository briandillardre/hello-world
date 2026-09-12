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
  /** When the fix was taken (ISO) — a background batch replays honest times.
   *  Clamped: nothing in the future, nothing older than 24 h. Default = now. */
  at?: string | null
  /** Who produced it: 'live' (Share location), 'shift' (the clock's tracker),
   *  'gateway' (the BLE phone gateway). Lands in raw.source for the record. */
  source?: 'live' | 'shift' | 'gateway' | null
  /**
   * May this fix bring a phone asset back from a stopped share? TRUE for the
   * two paths a person opts into (Share location, being on the clock). FALSE
   * for the always-on BLE gateway: "Stop sharing" has to mean it (ship-check,
   * Sep 12 — the gateway silently put a foreman's dot back on the map after
   * he turned sharing off). An inactive asset then answers 'sharing_off'.
   */
  reactivate?: boolean
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
    if (fix.reactivate === false) return { ok: false, reason: 'sharing_off' }
    await svc.from('assets').update({ active: true }).eq('id', assetId)
  }

  // The fix's own time when the client says so (a shift batch that waited
  // out a dead zone), clamped to [now − 24 h, now]; otherwise now.
  const nowMs = Date.now()
  let atMs = nowMs
  if (typeof fix.at === 'string') {
    const t = Date.parse(fix.at)
    if (Number.isFinite(t)) atMs = Math.min(nowMs, Math.max(nowMs - 24 * 3_600_000, t))
  }
  const { at: _at, source, reactivate: _re, ...rest } = fix
  void _at; void _re
  const { error: locErr } = await svc.from('asset_locations').insert({
    asset_id: assetId,
    company_id: companyId,
    lat,
    lng,
    accuracy: fix.accuracy ?? null,
    battery: fix.battery ?? null,
    speed: fix.speed ?? null,
    heading: fix.heading ?? null,
    timestamp: new Date(atMs).toISOString(),
    raw: { source: 'phone', ...rest, ...(source ? { via: source } : {}) },
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
