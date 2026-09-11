import { NextRequest, NextResponse } from 'next/server'
import { CHECK_TYPES } from '@/lib/field-types'
import { isZoneLogEvent } from '@/lib/alerts-engine'
import { resolveDigestPrefs, dueNow, proseEmailHtml } from '@/lib/weekly-digest'
import { deliverSummary, delivered } from '@/lib/digest-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The evening digest — stage 3 of the AI ladder (docs/AI-ROADMAP.md):
 * the AI notices first, the human decides. Reads the day with the service
 * client (no session on a cron) and writes a dispatcher's-eye summary.
 *
 * Runs HOURLY and sends at each company's own local hour (digest_prefs.evening)
 * — until Sep 11 it ran once at 6 PM ET, looped every company, and pushed all
 * of them to one global NOTIFY_WEBHOOK_URL: the founder's phone got a
 * notification per company per night and the companies got nothing they could
 * switch off. lib/digest-delivery.ts is the fix; that file has the full note.
 *
 * Manual test: GET /api/cron/digest with `Authorization: Bearer $CRON_SECRET`.
 * Add `?force=1` to ignore the hour gate and the once-a-day stamp.
 */

interface DayFacts {
  company: string
  assetsTotal: number
  assetsMoved: string[]
  assetsDark: { name: string; hoursSinceSeen: number }[]
  openAlerts: { asset: string; trigger: string }[]
  clockedIn: { name: string; where: string }[]
  stillOnClock: string[]
  logsFiled: number
  safetyNotes: string[]
  checksOverdue: { asset: string; check: string; daysOver: number }[]
  /** Insight-engine headlines (≤3) — trends, not today-noise. */
  noticed: string[]
}

function plainDigest(f: DayFacts): string {
  const lines: string[] = []
  lines.push(`${f.assetsMoved.length} of ${f.assetsTotal} assets moved today.`)
  if (f.clockedIn.length) lines.push(`Crew: ${f.clockedIn.map((c) => `${c.name} (${c.where})`).join(', ')} — ${f.logsFiled} log${f.logsFiled === 1 ? '' : 's'} filed.`)
  if (f.stillOnClock.length) lines.push(`STILL ON THE CLOCK: ${f.stillOnClock.join(', ')}.`)
  if (f.safetyNotes.length) lines.push(`Safety: ${f.safetyNotes.join(' · ')}`)
  if (f.openAlerts.length) lines.push(`Unacknowledged alerts: ${f.openAlerts.map((a) => `${a.asset} (${a.trigger})`).join(', ')}.`)
  if (f.assetsDark.length) lines.push(`Dark >24h: ${f.assetsDark.map((d) => d.name).join(', ')}.`)
  if (f.checksOverdue.length) lines.push(`Checks due: ${f.checksOverdue.map((c) => `${c.asset} ${c.check} (${c.daysOver}d over)`).join(', ')}.`)
  if (f.noticed.length) lines.push(`Noticed: ${f.noticed.join(' · ')}`)
  if (lines.length <= 1 && !f.clockedIn.length) lines.push('All quiet — no alerts, nothing overdue.')
  return lines.join('\n')
}

async function composeWithAi(f: DayFacts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: process.env.AI_MODEL || 'claude-opus-4-8',
      max_tokens: 400,
      system:
        'You write a construction company owner\'s evening fleet digest. Plain sentences, sharp dispatcher voice, under 110 words, no markdown, no preamble. Lead with what needs action (still on the clock, safety notes, alerts, overdue checks); end with the routine. Use ONLY the facts given — never invent names or numbers. Never mention tracker hardware brands. The noticed list is the trend engine\'s findings — weave the most important one in naturally.',
      messages: [{ role: 'user', content: `FACTS: ${JSON.stringify(f)}` }],
    })
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim()
    return text || null
  } catch (err) {
    console.error('Digest AI compose failed', err)
    return null
  }
}

export async function GET(req: NextRequest) {
  // Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` when the env
  // var exists. If it's set, require it — manual pokes need the secret too.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const sinceIso = new Date(Date.now() - 18 * 3_600_000).toISOString()
  const results: { company: string; sent: string[] }[] = []

  const { data: companies, error } = await db.from('companies')
    .select('id, name, alert_email, alert_phone, digest_prefs, last_evening_digest_at')
    .limit(200)
  if (error) return NextResponse.json({ ok: true, skipped: 'pre-106 DB', detail: error.message })

  // Gate BEFORE any of the day's queries: on a quiet hour this route costs
  // one row read per company, not a fleet scan each. The cap keeps a busy
  // hour inside maxDuration — dueNow's grace window picks up the overflow on
  // the next run rather than losing anyone's day.
  const due = (companies ?? []).filter((co) => {
    const prefs = resolveDigestPrefs(co.digest_prefs)
    return force || (prefs.evening.enabled && dueNow({ hour: prefs.evening.hour, tz: prefs.tz, stamp: co.last_evening_digest_at }))
  })
  const BATCH = 12
  for (const co of due.slice(0, BATCH)) {
    const prefs = resolveDigestPrefs(co.digest_prefs)

    const [assetsQ, alertsQ, entriesQ, logsQ, checksQ, geosQ] = await Promise.all([
      db.from('assets').select('id, name, type').eq('company_id', co.id),
      db.from('alert_events').select('asset_id, kind, rule:alert_rules(trigger)').eq('company_id', co.id).is('acknowledged_at', null).gte('triggered_at', sinceIso).limit(50),
      db.from('time_entries').select('person_name, category, project_geofence_id, clock_out_at').eq('company_id', co.id).gte('clock_in_at', sinceIso).limit(100),
      db.from('daily_logs').select('safety').eq('company_id', co.id).gte('created_at', sinceIso).limit(100),
      db.from('equipment_checks').select('asset_id, check_type, created_at').eq('company_id', co.id).gte('created_at', new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(2000),
      db.from('geofences').select('id, name').eq('company_id', co.id),
    ])
    const assets = assetsQ.data ?? []
    if (!assets.length) continue
    const nameOf = new Map(assets.map((a) => [a.id, a.name]))
    const zoneOf = new Map((geosQ.data ?? []).map((g) => [g.id, g.name]))

    // Movement + dark: newest fix per asset in the last 24h (paged once —
    // a small fleet's day fits in one page; growth moves this to a view).
    const { data: locs } = await db
      .from('asset_locations')
      .select('asset_id, speed, timestamp')
      .eq('company_id', co.id)
      .gte('timestamp', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(1000)
    const moved = new Set<string>()
    const seen = new Set<string>()
    for (const r of locs ?? []) {
      seen.add(r.asset_id)
      if ((r.speed ?? 0) > 2) moved.add(r.asset_id)
    }
    const trackable = assets.filter((a) => a.type === 'vehicle' || a.type === 'equipment')
    const dark = trackable.filter((a) => !seen.has(a.id)).map((a) => ({ name: a.name, hoursSinceSeen: 24 }))

    // Latest check per asset+type → overdue vs interval (equipment only).
    const lastCheck = new Map<string, number>()
    for (const c of checksQ.data ?? []) {
      const k = `${c.asset_id}:${c.check_type}`
      const ms = new Date(c.created_at).getTime()
      if ((lastCheck.get(k) ?? 0) < ms) lastCheck.set(k, ms)
    }
    const checksOverdue: DayFacts['checksOverdue'] = []
    for (const a of assets.filter((x) => x.type === 'equipment')) {
      for (const t of CHECK_TYPES) {
        const ms = lastCheck.get(`${a.id}:${t.key}`)
        if (!ms) continue // never logged — don't nag about a habit that hasn't started
        const daysOver = Math.floor((Date.now() - ms) / 86_400_000) - t.intervalDays
        if (daysOver > 0) checksOverdue.push({ asset: a.name, check: t.label.toLowerCase(), daysOver })
      }
    }

    const entries = entriesQ.data ?? []
    const facts: DayFacts = {
      company: co.name ?? 'Company',
      assetsTotal: trackable.length,
      assetsMoved: trackable.filter((a) => moved.has(a.id)).map((a) => a.name),
      assetsDark: dark.slice(0, 5),
      openAlerts: (alertsQ.data ?? []).filter((e) => !isZoneLogEvent(e as { kind?: string | null; rule?: { trigger?: string | null } | null })).slice(0, 10).map((e) => ({
        asset: nameOf.get(e.asset_id) ?? 'Asset',
        trigger: ((e.rule as { trigger?: string } | null)?.trigger ?? 'alert').replace(/_/g, ' '),
      })),
      clockedIn: entries.map((e) => ({
        name: e.person_name,
        where: e.project_geofence_id ? zoneOf.get(e.project_geofence_id) ?? 'project' : e.category,
      })),
      stillOnClock: entries.filter((e) => !e.clock_out_at).map((e) => e.person_name),
      logsFiled: (logsQ.data ?? []).length,
      noticed: await (async () => {
        try {
          const { getInsightHeadlines } = await import('@/lib/insights')
          return await getInsightHeadlines(db, co.id, 3)
        } catch { return [] }
      })(),
      safetyNotes: (logsQ.data ?? []).map((l) => l.safety).filter((s): s is string => !!s?.trim()).slice(0, 5),
      checksOverdue: checksOverdue.slice(0, 6),
    }

    const text = (await composeWithAi(facts)) ?? plainDigest(facts)
    const res = await deliverSummary({
      db,
      company: co,
      channels: { push: prefs.evening.push, email: prefs.evening.email, sms: prefs.evening.sms },
      title: 'Evening digest',
      subject: `${facts.company} — evening digest`,
      text,
      emailHtml: (manageUrl) => proseEmailHtml(`${facts.company} — evening digest`, text, manageUrl),
      clickPath: '/logs',
    })
    // Stamp even when no channel is configured, or an hourly cron retries
    // this company every hour for a send that can never land.
    await db.from('companies').update({ last_evening_digest_at: new Date().toISOString() }).eq('id', co.id)
    results.push({
      company: co.name ?? co.id,
      sent: delivered(res)
        ? [res.pushed ? `push×${res.pushed}` : '', res.emailed ? 'email' : '', res.texted ? 'sms' : '', res.webhooked ? 'owner-webhook' : ''].filter(Boolean)
        : ['no channel configured'],
    })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), due: due.length, deferred: Math.max(0, due.length - BATCH), results })
}
