'use server'

/**
 * Safety's writes (migration 159). Members hold SELECT only; every write runs
 * on the service client after the session checks. Any login with Daily logs
 * open may lead a talk, sign one, or file a report — the near miss the
 * newest hand reports is the one that matters. Closing a report is Foreman
 * and up; removing a talk is its leader or a Manager. An injury (or any
 * treatment) pages the company's phones at once on the alerts switch — with
 * no details in the push, because the report itself is Foreman-and-up reading.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { cleanSignature, isReportKind, isTreatment, reportUrgency, topicByKey, REPORT_WORDS } from '@/lib/safety/talks'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function member() {
  const perms = await getMyPermissions()
  if (perms.viewingAs) throw new Error('You’re previewing another login — exit the preview to write.')
  if (isProspect(perms) || !perms.features.includes('logs')) throw new Error('Safety isn’t open for your login.')
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const sb = createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: profile } = await sb.from('profiles').select('company_id, name').eq('id', user.id).single()
  if (!profile?.company_id) throw new Error('Not signed in')
  return { perms, userId: user.id, companyId: String(profile.company_id), name: (profile.name as string | null) || user.email || 'Crew', svc: createServiceClient() }
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)
const refresh = () => revalidatePath('/safety')

/** A company site (never someone's personal zone, a boundary or a vendor) — or none. */
async function siteOf(svc: Svc, companyId: string, raw: unknown): Promise<string | null | 'bad'> {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string' || !UUID.test(raw)) return 'bad'
  const { data } = await svc.from('geofences').select('id, owner_id, kind').eq('id', raw).eq('company_id', companyId).maybeSingle()
  if (!data || data.owner_id || data.kind === 'boundary' || data.kind === 'vendor') return 'bad'
  return String(data.id)
}

async function companyToday(svc: Svc, companyId: string): Promise<string> {
  const { dayKey, safeTz } = await import('@/lib/dates')
  const { data } = await svc.from('companies').select('digest_prefs').eq('id', companyId).maybeSingle()
  const tz = (data?.digest_prefs as { tz?: unknown } | null)?.tz
  return dayKey(Date.now(), safeTz(typeof tz === 'string' ? tz : null))
}

// ── Toolbox talks ───────────────────────────────────────────────────────────

/** Lead a talk: a library topic (or your own), the site, the day; you sign it as you start it. */
export async function startTalkAction(raw: { topicKey?: unknown; topic?: unknown; siteId?: unknown; heldOn?: unknown; notes?: unknown; signature?: unknown }): Promise<Res<{ id: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to hold a talk.' }
  const { userId, companyId, name, svc } = await member()
  const lib = topicByKey(typeof raw?.topicKey === 'string' ? raw.topicKey : null)
  const topic = lib?.title ?? clip(raw?.topic, 160)
  if (!topic) return { ok: false, error: 'Pick a topic or write your own.' }
  const site = await siteOf(svc, companyId, raw?.siteId)
  if (site === 'bad') return { ok: false, error: 'That site wasn’t found.' }
  const today = await companyToday(svc, companyId)
  const heldOn = typeof raw?.heldOn === 'string' && DAY.test(raw.heldOn) && raw.heldOn <= today ? raw.heldOn : today
  // a crew can't flood the log: 60 talks a company a day is far past any real day
  const { count } = await svc.from('safety_talks').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('held_on', heldOn).is('deleted_at', null)
  if ((count ?? 0) >= 60) return { ok: false, error: 'That’s a lot of talks for one day — try again tomorrow.' }
  const { data, error } = await svc.from('safety_talks').insert({
    company_id: companyId, geofence_id: site, held_on: heldOn, topic_key: lib?.key ?? null, topic, notes: clip(raw?.notes, 4000), led_by: userId,
  }).select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t start it — try again.' }
  const sig = cleanSignature(raw?.signature)
  await svc.from('safety_signatures').insert({ company_id: companyId, talk_id: data.id, user_id: userId, name: name.slice(0, 80), signature: sig })
  refresh()
  return { ok: true, id: String(data.id) }
}

/**
 * Sign a talk. Signed in = you, once. A crew member without a login (a new
 * hire, a sub's hand) signs on someone's phone by typed name — that line
 * carries no login.
 */
export async function signTalkAction(talkId: string, raw: { guestName?: unknown; signature?: unknown }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to sign.' }
  const { userId, companyId, name, svc } = await member()
  if (!UUID.test(talkId)) return { ok: false, error: 'That talk wasn’t found.' }
  const { data: talk } = await svc.from('safety_talks').select('id, held_on').eq('id', talkId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!talk) return { ok: false, error: 'That talk wasn’t found.' }
  const sig = cleanSignature(raw?.signature)
  const guest = clip(raw?.guestName, 80)
  if (guest) {
    if (!sig) return { ok: false, error: 'Have them sign with a finger first.' }
    const { count } = await svc.from('safety_signatures').select('id', { count: 'exact', head: true }).eq('talk_id', talkId)
    if ((count ?? 0) >= 200) return { ok: false, error: 'That talk has 200 signatures already.' }
    const { error } = await svc.from('safety_signatures').insert({ company_id: companyId, talk_id: talkId, user_id: null, name: guest, signature: sig })
    if (error) return { ok: false, error: 'Couldn’t save the signature — try again.' }
  } else {
    // a login signs once (the partial unique index): a second signature replaces the first
    const { data: had } = await svc.from('safety_signatures').select('id').eq('talk_id', talkId).eq('user_id', userId).maybeSingle()
    const w = had
      ? await svc.from('safety_signatures').update({ signature: sig, signed_at: new Date().toISOString() }).eq('id', had.id)
      : await svc.from('safety_signatures').insert({ company_id: companyId, talk_id: talkId, user_id: userId, name: name.slice(0, 80), signature: sig })
    if (w.error) return { ok: false, error: 'Couldn’t save the signature — try again.' }
  }
  refresh()
  return { ok: true }
}

export async function removeTalkAction(talkId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, userId, companyId, svc } = await member()
  if (!UUID.test(talkId)) return { ok: false, error: 'That talk wasn’t found.' }
  const { data: talk } = await svc.from('safety_talks').select('id, led_by').eq('id', talkId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!talk) return { ok: false, error: 'That talk wasn’t found.' }
  if (talk.led_by !== userId && rankOf(perms) < RANK.manager) return { ok: false, error: 'Only whoever led it, or a Manager, can remove a talk.' }
  await svc.from('safety_talks').update({ deleted_at: new Date().toISOString() }).eq('id', talkId).eq('company_id', companyId)
  refresh()
  return { ok: true }
}

// ── Incident / near-miss / observation reports ──────────────────────────────

export async function fileReportAction(raw: {
  kind?: unknown; occurredAt?: unknown; siteId?: unknown; what?: unknown; injury?: unknown; treatment?: unknown; people?: unknown; actions?: unknown; lat?: unknown; lng?: unknown; idem?: unknown
}): Promise<Res<{ id: string; paged: boolean }>> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in to file a report.' }
  const { userId, companyId, name, svc } = await member()
  if (!isReportKind(raw?.kind)) return { ok: false, error: 'Pick what kind of report.' }
  const what = clip(raw?.what, 4000)
  if (!what) return { ok: false, error: 'Say what happened.' }
  const treatment = isTreatment(raw?.treatment) ? raw.treatment : 'none'
  const injury = raw?.injury === true
  const t = typeof raw?.occurredAt === 'string' ? Date.parse(raw.occurredAt) : NaN
  const now = Date.now()
  // a moment in the last year, never ahead of now (+5 min of clock drift)
  const occurredAt = Number.isFinite(t) && t <= now + 5 * 60_000 && t >= now - 366 * 86_400_000 ? new Date(t).toISOString() : new Date(now).toISOString()
  const site = await siteOf(svc, companyId, raw?.siteId)
  if (site === 'bad') return { ok: false, error: 'That site wasn’t found.' }
  const lat = typeof raw?.lat === 'number' && Number.isFinite(raw.lat) && Math.abs(raw.lat) <= 90 ? raw.lat : null
  const lng = typeof raw?.lng === 'number' && Number.isFinite(raw.lng) && Math.abs(raw.lng) <= 180 ? raw.lng : null
  const { count } = await svc.from('safety_reports').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('reported_by', userId).gte('created_at', new Date(now - 86_400_000).toISOString())
  if ((count ?? 0) >= 40) return { ok: false, error: 'That’s 40 reports from you today — call the office.' }
  // the same report sent twice (a retry after a lost reply) lands once
  const idem = typeof raw?.idem === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw.idem) ? raw.idem : null
  if (idem) {
    const { data: dup } = await svc.from('safety_reports').select('id').eq('company_id', companyId).eq('reported_by', userId).eq('what', what).eq('occurred_at', occurredAt).limit(1)
    if (dup?.length) return { ok: true, id: String(dup[0].id), paged: false }
  }
  const { data, error } = await svc.from('safety_reports').insert({
    company_id: companyId, geofence_id: site, kind: raw.kind, occurred_at: occurredAt, what, injury, treatment,
    people: clip(raw?.people, 500), actions: clip(raw?.actions, 4000), lat, lng, reported_by: userId,
  }).select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t file it — try again.' }

  const paged = reportUrgency({ kind: raw.kind, injury, treatment }) === 'page'
  if (paged) {
    let siteName = ''
    if (site) {
      const { data: g } = await svc.from('geofences').select('name').eq('id', site).maybeSingle()
      siteName = g?.name ? ` at ${String(g.name)}` : ''
    }
    const title = `${REPORT_WORDS.incident.emoji} Injury reported`
    const body = `${name} reported an injury${siteName}. Open the report to read it.`.slice(0, 240)
    try {
      const { sendPushToCompanyPlain } = await import('@/lib/push')
      await sendPushToCompanyPlain(companyId, { title, body, url: '/safety' }, 'alerts')
    } catch { /* best-effort */ }
    try {
      const { mirrorOwnerWebhook } = await import('@/lib/digest-delivery')
      await mirrorOwnerWebhook(svc, companyId, title, body, '/safety')
    } catch { /* best-effort */ }
  }
  refresh()
  return { ok: true, id: String(data.id), paged }
}

export async function closeReportAction(id: string, note: unknown): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, userId, companyId, svc } = await member()
  if (rankOf(perms) < RANK.foreman) return { ok: false, error: 'Closing a report is for Foremen and up.' }
  if (!UUID.test(id)) return { ok: false, error: 'That report wasn’t found.' }
  const { data, error } = await svc.from('safety_reports').update({ status: 'closed', closed_by: userId, closed_at: new Date().toISOString(), close_note: clip(note, 2000) })
    .eq('id', id).eq('company_id', companyId).is('deleted_at', null).eq('status', 'open').select('id').maybeSingle()
  if (error || !data) return { ok: false, error: 'Couldn’t close it — it may be closed already.' }
  refresh()
  return { ok: true }
}

export async function reopenReportAction(id: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { perms, companyId, svc } = await member()
  if (rankOf(perms) < RANK.foreman) return { ok: false, error: 'Reopening a report is for Foremen and up.' }
  if (!UUID.test(id)) return { ok: false, error: 'That report wasn’t found.' }
  await svc.from('safety_reports').update({ status: 'open', closed_by: null, closed_at: null, close_note: null }).eq('id', id).eq('company_id', companyId).is('deleted_at', null)
  refresh()
  return { ok: true }
}
