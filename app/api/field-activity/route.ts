import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { safeTz } from '@/lib/dates'
import { safeHttps } from '@/lib/safe-url'
import { getMyPermissions, getRealPermissions } from '@/lib/permissions-server'

export const dynamic = 'force-dynamic'

/**
 * Field activity for the map layer: crew clock-ins and daily-log submissions
 * with the GPS stamp the phone recorded (migration 059). Last 7 days, RLS-
 * scoped through the caller's session — same window as alert pins.
 *
 * Nothing inside a privacy zone is pinned (133): a punch or a log there is
 * kept on the time card ("in a privacy zone", lib/db/timecards.ts), but a
 * named pin at the exact spot would put the person's private place on every
 * crew phone's map. The same test as collection — every private zone, a
 * personal one the viewer cannot see included, 50 m past its edge, a site
 * or yard always wins. A zone read that fails shows no pins at all.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ events: [] })
    // Same view level as /logs and /photos — a role without daily logs gets an empty layer.
    if (!(await getMyPermissions()).features.includes('logs')) return NextResponse.json({ events: [] })
    const { companyId } = await getRealPermissions()
    if (!companyId) return NextResponse.json({ events: [] })
    const [{ createServiceClient }, { loadPrivacyZones }, { privacyZoneAt }] = await Promise.all([
      import('@/lib/supabase-server'), import('@/lib/location-privacy'), import('@/lib/location-policy'),
    ])
    const zones = await loadPrivacyZones(createServiceClient(), companyId) // throws → no pins
    const isPrivate = (lat: number, lng: number) => !!privacyZoneAt({ lat, lng }, zones)
    const tz = safeTz(cookies().get('ht_tz')?.value)
    const sinceIso = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })

    const [entriesQ, logsQ, zonesQ] = await Promise.all([
      supabase.from('time_entries')
        .select('id, person_name, category, clock_in_at, in_lat, in_lng, project_geofence_id, plan')
        .gte('clock_in_at', sinceIso).order('clock_in_at', { ascending: false }).limit(400),
      supabase.from('daily_logs')
        .select('id, user_id, created_at, writeup, lat, lng, time_entry_id, photos')
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(300),
      supabase.from('geofences').select('id, name').limit(500),
    ])
    // Any error (incl. pre-059 missing columns) → empty layer, never a 500.
    if (entriesQ.error || logsQ.error) return NextResponse.json({ events: [] })

    const zoneName = new Map((zonesQ.data ?? []).map((z) => [z.id as string, z.name as string]))
    const entryById = new Map((entriesQ.data ?? []).map((e) => [e.id as string, e]))

    type Ev = { kind: 'clockin' | 'log'; lat: number; lng: number; person: string; at: string; zone: string | null; text: string; photo?: string | null; photos?: number }
    const events: Ev[] = []
    for (const e of entriesQ.data ?? []) {
      if (typeof e.in_lat !== 'number' || typeof e.in_lng !== 'number') continue
      if (isPrivate(e.in_lat, e.in_lng)) continue
      events.push({
        kind: 'clockin', lat: e.in_lat, lng: e.in_lng,
        person: (e.person_name as string) || 'Crew',
        at: fmt.format(new Date(e.clock_in_at as string)),
        zone: zoneName.get(e.project_geofence_id as string) ?? null,
        text: (e.plan as string) || '',
      })
    }
    for (const l of logsQ.data ?? []) {
      if (typeof l.lat !== 'number' || typeof l.lng !== 'number') continue
      if (isPrivate(l.lat, l.lng)) continue
      const entry = entryById.get(l.time_entry_id as string)
      const shots = (Array.isArray(l.photos) ? l.photos : []) as { url?: string; kind?: string }[]
      // Member-writable JSON → only https URLs on our storage host reach the popup's <img>/<a>.
      const jobShots = shots.filter((p) => (p.kind ?? 'photo') === 'photo' && safeHttps(p?.url, { ourHostOnly: true }))
      events.push({
        kind: 'log', lat: l.lat, lng: l.lng,
        person: (entry?.person_name as string) || 'Crew',
        at: fmt.format(new Date(l.created_at as string)),
        zone: entry ? zoneName.get(entry.project_geofence_id as string) ?? null : null,
        text: String(l.writeup ?? '').slice(0, 140),
        photo: safeHttps(jobShots[0]?.url, { ourHostOnly: true }),
        photos: jobShots.length,
      })
    }
    return NextResponse.json({ events })
  } catch {
    return NextResponse.json({ events: [] })
  }
}
