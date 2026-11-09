/**
 * Safety reads (migration 159), all through the caller's RLS: every member
 * reads the company's toolbox talks and who signed them; a report (it names
 * people and injuries) is read by Foreman and up, or by whoever filed it.
 */
import type { ReportKind, Treatment } from '@/lib/safety/talks'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface TalkRow {
  id: string; heldOn: string; topicKey: string | null; topic: string; notes: string | null
  siteId: string | null; siteName: string | null; ledBy: string | null; leaderName: string | null
  signatures: { id: string; userId: string | null; name: string; signature: string | null; signedAt: string }[]
}
export interface ReportRow {
  id: string; kind: ReportKind; occurredAt: string; what: string; injury: boolean; treatment: Treatment
  people: string | null; actions: string | null; siteId: string | null; siteName: string | null
  reportedBy: string | null; reporterName: string | null; status: 'open' | 'closed'; closedAt: string | null; closeNote: string | null; closerName: string | null
  createdAt: string
}
export interface SafetyData { available: boolean; talks: TalkRow[]; reports: ReportRow[]; me: string | null }

const DEMO_SIG = 'M20 70L40 40L55 65L70 30L90 72L110 45L130 60L160 38L190 66L220 50L250 58'

function demo(): SafetyData {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
  return {
    available: true, me: null,
    talks: [
      { id: 't1', heldOn: day(0), topicKey: 'trench', topic: 'Trench and excavation safety', notes: null, siteId: null, siteName: 'Creekside Commons', ledBy: null, leaderName: 'Foreman',
        signatures: ['Foreman', 'Operator 1', 'Laborer 2', 'Pipe layer'].map((n, i) => ({ id: `s${i}`, userId: null, name: n, signature: DEMO_SIG, signedAt: new Date().toISOString() })) },
      { id: 't2', heldOn: day(1), topicKey: 'blindspots', topic: 'Blind spots and spotters', notes: 'New hand on the roller — walked the swing radius.', siteId: null, siteName: 'Creekside Commons', ledBy: null, leaderName: 'Foreman',
        signatures: ['Foreman', 'Operator 1', 'Laborer 2'].map((n, i) => ({ id: `u${i}`, userId: null, name: n, signature: DEMO_SIG, signedAt: new Date().toISOString() })) },
    ],
    reports: [
      { id: 'r1', kind: 'near_miss', occurredAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), what: 'Dump truck backed toward the pipe crew without a spotter; horn stopped it ~10 ft out.', injury: false, treatment: 'none', people: null, actions: 'Spotter assigned to every backing truck. Covered at today’s talk.', siteId: null, siteName: 'Creekside Commons', reportedBy: null, reporterName: 'Laborer 2', status: 'closed', closedAt: new Date().toISOString(), closeNote: 'Spotter rule in place.', closerName: 'Foreman', createdAt: new Date().toISOString() },
      { id: 'r2', kind: 'observation', occurredAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), what: 'Spoil pile within 2 ft of the trench edge at STA 4+10.', injury: false, treatment: 'none', people: null, actions: null, siteId: null, siteName: 'Creekside Commons', reportedBy: null, reporterName: 'Operator 1', status: 'open', closedAt: null, closeNote: null, closerName: null, createdAt: new Date().toISOString() },
    ],
  }
}

export async function getSafety(companyId: string, days = 60): Promise<SafetyData> {
  if (isMock) return demo()
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const { data: { user } } = await db.auth.getUser()
    const since = new Date(Date.now() - days * 86_400_000)
    const [t, r] = await Promise.all([
      db.from('safety_talks').select('id, held_on, topic_key, topic, notes, geofence_id, led_by').eq('company_id', companyId).gte('held_on', since.toISOString().slice(0, 10)).order('held_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      db.from('safety_reports').select('id, kind, occurred_at, what, injury, treatment, people, actions, geofence_id, reported_by, status, closed_by, closed_at, close_note, created_at').eq('company_id', companyId).order('occurred_at', { ascending: false }).limit(200),
    ])
    if (t.error || r.error) return { available: false, talks: [], reports: [], me: user?.id ?? null }
    const talkIds = (t.data ?? []).map((x) => String(x.id))
    const sigs = new Map<string, TalkRow['signatures']>()
    for (let i = 0; i < talkIds.length; i += 100) {
      const { data } = await db.from('safety_signatures').select('id, talk_id, user_id, name, signature, signed_at').in('talk_id', talkIds.slice(i, i + 100)).order('signed_at').limit(5000)
      for (const s of data ?? []) {
        const list = sigs.get(String(s.talk_id)) ?? []
        list.push({ id: String(s.id), userId: (s.user_id as string | null) ?? null, name: String(s.name), signature: (s.signature as string | null) ?? null, signedAt: String(s.signed_at) })
        sigs.set(String(s.talk_id), list)
      }
    }
    const siteIds = Array.from(new Set([...(t.data ?? []), ...(r.data ?? [])].map((x) => x.geofence_id).filter(Boolean).map(String)))
    const people = Array.from(new Set([...(t.data ?? []).map((x) => x.led_by), ...(r.data ?? []).flatMap((x) => [x.reported_by, x.closed_by])].filter(Boolean).map(String)))
    const [g, p] = await Promise.all([
      siteIds.length ? db.from('geofences').select('id, name').in('id', siteIds.slice(0, 500)) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      people.length ? db.from('profiles').select('id, name').in('id', people.slice(0, 500)) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ])
    const site = new Map((g.data ?? []).map((x) => [String(x.id), String(x.name)]))
    const who = new Map((p.data ?? []).map((x) => [String(x.id), (x.name as string | null) || 'Teammate']))
    const nameOf = (id: unknown) => (id ? who.get(String(id)) ?? null : null)
    return {
      available: true, me: user?.id ?? null,
      talks: (t.data ?? []).map((x) => ({
        id: String(x.id), heldOn: String(x.held_on), topicKey: (x.topic_key as string | null) ?? null, topic: String(x.topic), notes: (x.notes as string | null) ?? null,
        siteId: (x.geofence_id as string | null) ?? null, siteName: x.geofence_id ? site.get(String(x.geofence_id)) ?? null : null,
        ledBy: (x.led_by as string | null) ?? null, leaderName: nameOf(x.led_by), signatures: sigs.get(String(x.id)) ?? [],
      })),
      reports: (r.data ?? []).map((x) => ({
        id: String(x.id), kind: x.kind as ReportKind, occurredAt: String(x.occurred_at), what: String(x.what), injury: !!x.injury, treatment: x.treatment as Treatment,
        people: (x.people as string | null) ?? null, actions: (x.actions as string | null) ?? null,
        siteId: (x.geofence_id as string | null) ?? null, siteName: x.geofence_id ? site.get(String(x.geofence_id)) ?? null : null,
        reportedBy: (x.reported_by as string | null) ?? null, reporterName: nameOf(x.reported_by),
        status: x.status === 'closed' ? 'closed' : 'open', closedAt: (x.closed_at as string | null) ?? null, closeNote: (x.close_note as string | null) ?? null, closerName: nameOf(x.closed_by),
        createdAt: String(x.created_at),
      })),
    }
  } catch {
    return { available: false, talks: [], reports: [], me: null }
  }
}
