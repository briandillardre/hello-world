import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase-server'
import { DEFAULT_TZ } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * Field activity for the map layer: crew clock-ins and daily-log submissions
 * with the GPS stamp the phone recorded (migration 059). Last 7 days, RLS-
 * scoped through the caller's session — same window as alert pins.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ events: [] })
    const tz = cookies().get('ht_tz')?.value || DEFAULT_TZ
    const sinceIso = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })

    const [entriesQ, logsQ, zonesQ] = await Promise.all([
      supabase.from('time_entries')
        .select('id, person_name, category, clock_in_at, in_lat, in_lng, project_geofence_id, plan')
        .gte('clock_in_at', sinceIso).order('clock_in_at', { ascending: false }).limit(400),
      supabase.from('daily_logs')
        .select('id, user_id, created_at, writeup, lat, lng, time_entry_id')
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(300),
      supabase.from('geofences').select('id, name').limit(500),
    ])
    // Any error (incl. pre-059 missing columns) → empty layer, never a 500.
    if (entriesQ.error || logsQ.error) return NextResponse.json({ events: [] })

    const zoneName = new Map((zonesQ.data ?? []).map((z) => [z.id as string, z.name as string]))
    const entryById = new Map((entriesQ.data ?? []).map((e) => [e.id as string, e]))

    type Ev = { kind: 'clockin' | 'log'; lat: number; lng: number; person: string; at: string; zone: string | null; text: string }
    const events: Ev[] = []
    for (const e of entriesQ.data ?? []) {
      if (typeof e.in_lat !== 'number' || typeof e.in_lng !== 'number') continue
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
      const entry = entryById.get(l.time_entry_id as string)
      events.push({
        kind: 'log', lat: l.lat, lng: l.lng,
        person: (entry?.person_name as string) || 'Crew',
        at: fmt.format(new Date(l.created_at as string)),
        zone: entry ? zoneName.get(entry.project_geofence_id as string) ?? null : null,
        text: String(l.writeup ?? '').slice(0, 140),
      })
    }
    return NextResponse.json({ events })
  } catch {
    return NextResponse.json({ events: [] })
  }
}
