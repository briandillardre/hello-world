/**
 * The ONE door a worker phone's own location goes through (location privacy,
 * migrations 132 + 133). Server-only and deliberately NOT a server action:
 * every export of a 'use server' file is callable by any client, and this
 * one trusts the ids it is handed. Callers establish who is asking first:
 *
 *   - `pushPhoneLocation` (lib/actions/tracker.ts) — Go Live, the client's
 *     door: the Share-location view level, never a Prospective Client, never
 *     inside a "view app as" preview, rate-limited;
 *   - /api/clock/fix — the shift recorder (an open time entry, Time clock);
 *   - /api/ingest/ble-phone — the tag listener (Tag scanner + Share location).
 *
 * A fix inside a privacy zone is never kept (lib/location-policy
 * `privacyZoneAt`: the zone, 50–150 m past its edge by the fix's accuracy,
 * a site or yard always wins) — checked BEFORE the phone asset is created or
 * revived, so nothing about the person moves while inside. `hiddenZone`
 * says the zone is someone else's personal ("only me") zone: the caller must
 * then answer the person exactly as if the point had been kept, so a reply
 * never maps a zone they cannot see.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface PhoneFixInput {
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
   *  'gateway' (the BLE phone gateway). Lands in raw.via for the record. */
  source?: 'live' | 'shift' | 'gateway' | null
  /**
   * May this fix bring a phone asset back from a stopped share? TRUE for the
   * two paths a person opts into (Share location, being on the clock). FALSE
   * for the always-on BLE gateway: "Stop sharing" has to mean it (ship-check,
   * Sep 12). An inactive asset then answers 'sharing_off'.
   */
  reactivate?: boolean
}

export interface PhoneFixResult {
  ok: boolean
  assetId?: string
  reason?: 'coords' | 'demo' | 'privacy_check' | 'asset' | 'location' | 'sharing_off' | 'not_allowed'
  withheld?: 'privacy_zone'
  /** The zone it fell in is someone else's personal zone — reply as if kept. */
  hiddenZone?: boolean
}

const phoneTracker = (userId: string) => `phone-${userId}`
const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

/** Record one fix on `who`'s own `phone-<uid>` asset — or nothing, inside a
 *  privacy zone. `who` must come from the caller's own session. */
export async function recordPhoneLocation(who: { userId: string; companyId: string }, fix: PhoneFixInput): Promise<PhoneFixResult> {
  const { lat, lng } = fix
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'coords' }
  }
  if (isMock) return { ok: false, reason: 'demo' }
  const { userId, companyId } = who
  const accuracy = num(fix.accuracy, 0, 10_000)

  const { createServiceClient } = await import('./supabase-server')
  const svc = createServiceClient()
  // A Prospective Client never appears on the map (118) — whichever door
  // asked. The callers' view levels already say so; this is the backstop.
  const { data: profile } = await svc.from('profiles').select('name, role').eq('id', userId).maybeSingle()
  if (userId !== companyId && profile?.role === 'prospect') return { ok: false, reason: 'not_allowed' }
  // Inside a privacy zone nothing is kept. A zone read that fails keeps
  // nothing either — the next fix tries again.
  try {
    const { loadPrivacyZones } = await import('./location-privacy')
    const { privacyZoneAt } = await import('./location-policy')
    const zones = await loadPrivacyZones(svc, companyId)
    if (privacyZoneAt({ lat, lng }, zones, { accuracyM: accuracy })) {
      // Inside a zone this person may know of (company-wide, or their own)?
      // Then the reply may say so; otherwise it is someone's hidden one.
      const seen = privacyZoneAt({ lat, lng }, zones, { accuracyM: accuracy, onlyVisibleTo: userId })
      return { ok: true, withheld: 'privacy_zone', hiddenZone: !seen }
    }
  } catch {
    return { ok: false, reason: 'privacy_check' }
  }
  // Find or (re)create the phone asset — reactivated if a prior share stopped it.
  const trackerId = phoneTracker(userId)
  const { data: existing } = await svc.from('assets').select('id, active')
    .eq('company_id', companyId).eq('tracker_id', trackerId).maybeSingle()

  let assetId = existing?.id as string | undefined
  if (!assetId) {
    const name = profile?.name ? `${profile.name} (phone)` : 'My phone'
    // The owner's phone starts "owner only" and an Admin's "Admins" (111 —
    // Brian, Sep 18: "I do not want to be tracked as admin"). The crew's
    // phones stay visible: that is what clock-in tracking is for. Widen it
    // any time on the asset page.
    const visibility = userId === companyId ? 'master' : profile?.role === 'admin' ? 'admins' : null
    const { data: created, error } = await svc.from('assets')
      .insert({ company_id: companyId, name, type: 'personnel', tracker_id: trackerId, active: true,
        metadata: { source: 'phone', ...(visibility ? { visibility } : {}) } })
      .select('id').single()
    if (error || !created) return { ok: false, reason: 'asset' }
    assetId = created.id as string
  } else if (existing && !existing.active) {
    if (fix.reactivate === false) return { ok: false, reason: 'sharing_off' }
    await svc.from('assets').update({ active: true }).eq('id', assetId)
  }

  // The fix's own time when the caller says so (a shift batch that waited
  // out a dead zone), clamped to [now − 24 h, now]; otherwise now.
  const nowMs = Date.now()
  let atMs = nowMs
  if (typeof fix.at === 'string') {
    const t = Date.parse(fix.at)
    if (Number.isFinite(t)) atMs = Math.min(nowMs, Math.max(nowMs - 24 * 3_600_000, t))
  }
  const speed = num(fix.speed, 0, 300)
  const heading = num(fix.heading, 0, 360)
  const battery = num(fix.battery, 0, 100)
  // raw is built from known fields only — never a spread of what the client sent.
  const { error: locErr } = await svc.from('asset_locations').insert({
    asset_id: assetId, company_id: companyId, lat, lng,
    accuracy, battery, speed, heading,
    timestamp: new Date(atMs).toISOString(),
    raw: { source: 'phone', lat, lng, accuracy, speed, heading, battery, ...(fix.source ? { via: fix.source } : {}) },
  })
  if (locErr) return { ok: false, reason: 'location' }

  try { const { revalidatePath } = await import('next/cache'); revalidatePath('/map') } catch { /* outside a request */ }
  return { ok: true, assetId }
}
