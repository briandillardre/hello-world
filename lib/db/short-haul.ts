import type { SupabaseClient } from '@supabase/supabase-js'
import { addDaysKey, zonedMidnightMs } from '@/lib/dates'
import { MASTER_RANK, RANK, type Role } from '@/lib/permissions'
import { buildShortHaul, isDriverClass, reportingPoints, type DriverClass, type ShortHaulRecord, type ShortHaulShift } from '@/lib/short-haul'

/**
 * DOT short-haul time records — the loader (migration 126). Reads who drives
 * a commercial vehicle (profiles.driver_class), their clock entries for the
 * 30-day window plus the 7 days before it (prior-7 totals, the 10-hour rest,
 * the 30-day log count), and asks the database how far each shift's phone
 * went from where that day started. Pure math lives in lib/short-haul.ts.
 */
export interface TeamDriver {
  id: string
  name: string
  role: Role
  isMaster: boolean
  driverClass: DriverClass | null
}

export interface ShortHaulResult {
  records: ShortHaulRecord[]
  /** Everyone on the team, with their driver type — the setup list. */
  team: TeamDriver[]
  /** False on a database without migration 126 (no driver_class column). */
  ready: boolean
  /** False when the radius function could not answer (reach unknown). */
  verified: boolean
}

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Days loaded before the window so its first day's 7-day total and rest are complete. */
const LEAD_DAYS = 8
const WINDOW_DAYS = 30

export function shortHaulWindow(toKey: string): { fromKey: string; toKey: string } {
  return { fromKey: addDaysKey(toKey, -(WINDOW_DAYS - 1)), toKey }
}

interface EntryRow {
  id: string; user_id: string; person_name: string | null
  clock_in_at: string; clock_out_at: string | null; break_minutes: number | null
  in_lat: number | null; in_lng: number | null; out_lat: number | null; out_lng: number | null
}

export async function getShortHaul(db: SupabaseClient, opts: {
  companyId: string
  toKey: string
  tz: string
  /** Restrict to these people (a crew member sees only their own record). */
  userIds?: string[] | null
  /** The viewer's rank: a driver who outranks them gets hours only (no GPS reads). */
  viewerRank?: number
  nowMs?: number
}): Promise<ShortHaulResult> {
  if (isMock) return { records: [], team: [], ready: false, verified: false }
  const viewerRank = opts.viewerRank ?? MASTER_RANK
  const { fromKey, toKey } = shortHaulWindow(opts.toKey)

  const { data: people, error: peopleErr } = await db.from('profiles')
    .select('id, name, email, role, driver_class').eq('company_id', opts.companyId).limit(1000)
  if (peopleErr) return { records: [], team: [], ready: false, verified: false }
  const team: TeamDriver[] = ((people ?? []) as { id: string; name: string | null; email: string | null; role: string | null; driver_class: string | null }[])
    .filter((p) => p.role !== 'prospect')
    .map((p) => {
      const isMaster = p.id === opts.companyId
      const role = (isMaster ? 'admin' : (p.role as Role | null) ?? 'associate') as Role
      return { id: p.id, name: p.name || p.email?.split('@')[0] || 'Teammate', role, isMaster, driverClass: isDriverClass(p.driver_class) ? p.driver_class : null }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const classes: Record<string, DriverClass> = {}
  for (const t of team) if (t.driverClass && (!opts.userIds || opts.userIds.includes(t.id))) classes[t.id] = t.driverClass
  const drivers = Object.keys(classes)
  if (!drivers.length) return { records: [], team, ready: true, verified: true }

  const { data, error } = await db.from('time_entries')
    .select('id, user_id, person_name, clock_in_at, clock_out_at, break_minutes, in_lat, in_lng, out_lat, out_lng')
    .eq('company_id', opts.companyId)
    .in('user_id', drivers)
    .gte('clock_in_at', new Date(zonedMidnightMs(addDaysKey(fromKey, -LEAD_DAYS), opts.tz)).toISOString())
    .lt('clock_in_at', new Date(zonedMidnightMs(addDaysKey(toKey, 1), opts.tz)).toISOString())
    .order('clock_in_at', { ascending: true })
    .limit(5000)
  if (error) return { records: [], team, ready: true, verified: false }
  const shifts: ShortHaulShift[] = ((data ?? []) as EntryRow[]).map((r) => ({
    id: r.id, userId: r.user_id, personName: r.person_name || team.find((t) => t.id === r.user_id)?.name || 'Driver',
    inAt: r.clock_in_at, outAt: r.clock_out_at, breakMinutes: Number(r.break_minutes) || 0,
    inLat: r.in_lat, inLng: r.in_lng, outLat: r.out_lat, outLng: r.out_lng,
  }))

  // Who outranks the viewer: hours only, like the time cards (120).
  const gpsHidden = new Set<string>()
  if (viewerRank < MASTER_RANK) {
    for (const t of team) {
      const rank = t.isMaster ? MASTER_RANK : (RANK[t.role] ?? 0)
      if (rank > viewerRank) gpsHidden.add(t.id)
    }
  }

  // How far each shift went from where its day started. Run as the SERVICE
  // ROLE, like timecard_gps_stats_v2: the entry ids were read under the
  // caller's own RLS, but a phone hidden by 111 must not read as "no fixes".
  let verified = true
  const origins = reportingPoints(shifts, opts.tz)
  const ask = shifts.filter((s) => !gpsHidden.has(s.userId))
  if (ask.length) {
    let rpcDb: SupabaseClient = db
    try {
      const { createServiceClient } = await import('@/lib/supabase-server')
      rpcDb = createServiceClient()
    } catch { /* the caller's client, RLS and all */ }
    const byId = new Map(shifts.map((s) => [s.id, s]))
    for (let i = 0; i < ask.length; i += 200) {
      const chunk = ask.slice(i, i + 200)
      const { data: rows, error: rpcErr } = await rpcDb.rpc('shorthaul_reach', {
        p_entry_ids: chunk.map((s) => s.id),
        p_lat: chunk.map((s) => origins.get(s.id)?.lat ?? null),
        p_lng: chunk.map((s) => origins.get(s.id)?.lng ?? null),
      })
      if (rpcErr) { verified = false; break }
      for (const row of (rows ?? []) as { entry_id: string; fixes: number | null; reach_m: number | null }[]) {
        const s = byId.get(row.entry_id)
        if (!s) continue
        s.fixes = Number(row.fixes) || 0
        s.reachM = row.reach_m == null ? null : Number(row.reach_m)
      }
    }
  }

  const records = buildShortHaul(shifts, classes, { tz: opts.tz, fromKey, toKey, nowMs: opts.nowMs, gpsHidden })
  return { records, team, ready: true, verified }
}
