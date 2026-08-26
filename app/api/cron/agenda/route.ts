import { NextRequest, NextResponse } from 'next/server'
import { CHECK_TYPES } from '@/lib/field-types'
import { BRAND_URL } from '@/lib/brand'
import { isZoneLogEvent } from '@/lib/alerts-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The Monday agenda — AI roadmap stages 5-6: last week's anomalies become
 * this week's to-do list. Runs Monday morning, reads the past 7 days with
 * the service client, flags what looks wrong, and pushes one message the
 * owner can run the 7 AM meeting from.
 *
 * Manual test: GET /api/cron/agenda with `Authorization: Bearer $CRON_SECRET`.
 */

interface WeekFacts {
  company: string
  weekMiles: Record<string, number>      // asset name → rough miles (moving pings)
  unusedAssets: string[]                 // vehicles/equipment that never moved all week
  darkAssets: string[]                   // nothing heard in 48h+
  weakBatteries: { name: string; pct: number }[]
  openAlerts: { asset: string; trigger: string }[]
  checksOverdue: { asset: string; check: string; daysOver: number }[]
  hoursByPerson: Record<string, number>  // clocked hours last week
  safetyNotes: string[]
  logsFiled: number
}

function plainAgenda(f: WeekFacts): string {
  const lines: string[] = ['Monday agenda:']
  if (f.openAlerts.length) lines.push(`Deal with first: ${f.openAlerts.map((a) => `${a.asset} (${a.trigger})`).join(', ')}.`)
  if (f.safetyNotes.length) lines.push(`Safety carried over: ${f.safetyNotes.join(' · ')}`)
  if (f.checksOverdue.length) lines.push(`Overdue checks: ${f.checksOverdue.map((c) => `${c.asset} ${c.check} (${c.daysOver}d)`).join(', ')}.`)
  if (f.darkAssets.length) lines.push(`Not reporting: ${f.darkAssets.join(', ')} — check power/parking.`)
  if (f.weakBatteries.length) lines.push(`Weak batteries: ${f.weakBatteries.map((b) => `${b.name} ${b.pct}%`).join(', ')}.`)
  if (f.unusedAssets.length) lines.push(`Sat all week: ${f.unusedAssets.join(', ')} — rent out, move, or sell?`)
  const hrs = Object.entries(f.hoursByPerson)
  if (hrs.length) lines.push(`Hours last week: ${hrs.map(([n, h]) => `${n} ${h.toFixed(1)}h`).join(', ')} · ${f.logsFiled} logs filed.`)
  if (lines.length === 1) lines.push('Clean week — nothing flagged.')
  return lines.join('\n')
}

async function composeWithAi(f: WeekFacts): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: process.env.AI_MODEL || 'claude-opus-4-8',
      max_tokens: 500,
      system:
        'You write a construction company owner\'s MONDAY MORNING agenda from last week\'s fleet facts. Sharp dispatcher voice, plain sentences, under 140 words, no markdown. Order: 1) anything unsafe or alerting, 2) overdue maintenance/checks, 3) equipment problems (dark units, weak batteries), 4) money observations (machines that sat unused all week), 5) one-line crew hours recap. Use ONLY the facts given — never invent. Never mention tracker hardware brands.',
      messages: [{ role: 'user', content: `FACTS: ${JSON.stringify(f)}` }],
    })
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim()
    return text || null
  } catch (err) {
    console.error('Agenda AI compose failed', err)
    return null
  }
}

async function pushAgenda(company: string, text: string): Promise<boolean> {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) return false
  try {
    if (/(^|\/\/|\.)ntfy\./.test(url) || url.includes('ntfy.sh/')) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Title: 'Monday agenda', Priority: 'default', Tags: 'calendar', Click: `${BRAND_URL}/command` },
        body: text,
      })
      return res.ok
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company, agenda: text, at: new Date().toISOString() }),
    })
    return res.ok
  } catch (err) {
    console.error('Agenda push failed', err)
    return false
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const results: { company: string; sent: boolean; text: string }[] = []

  const { data: companies } = await db.from('companies').select('id, name').limit(20)
  for (const co of companies ?? []) {
    const [assetsQ, alertsQ, entriesQ, logsQ, checksQ] = await Promise.all([
      db.from('assets').select('id, name, type').eq('company_id', co.id),
      db.from('alert_events').select('asset_id, kind, rule:alert_rules(trigger)').eq('company_id', co.id).is('acknowledged_at', null).gte('triggered_at', weekAgo).limit(50),
      db.from('time_entries').select('person_name, clock_in_at, clock_out_at').eq('company_id', co.id).gte('clock_in_at', weekAgo).limit(300),
      db.from('daily_logs').select('safety').eq('company_id', co.id).gte('created_at', weekAgo).limit(200),
      db.from('equipment_checks').select('asset_id, check_type, created_at').eq('company_id', co.id).gte('created_at', new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(2000),
    ])
    const assets = assetsQ.data ?? []
    if (!assets.length) continue
    const nameOf = new Map(assets.map((a) => [a.id, a.name]))
    const trackable = assets.filter((a) => a.type === 'vehicle' || a.type === 'equipment')

    // A week of positions, thinned: newest first, up to the API cap. Enough
    // to say who moved, who sat, and who went silent.
    const { data: locs } = await db
      .from('asset_locations')
      .select('asset_id, speed, battery, timestamp')
      .eq('company_id', co.id)
      .gte('timestamp', weekAgo)
      .order('timestamp', { ascending: false })
      .limit(5000)
    const movedPings = new Map<string, number>()
    const newestMs = new Map<string, number>()
    const newestBatt = new Map<string, number>()
    for (const r of locs ?? []) {
      if (!newestMs.has(r.asset_id)) {
        newestMs.set(r.asset_id, new Date(r.timestamp).getTime())
        if (r.battery != null) newestBatt.set(r.asset_id, r.battery)
      }
      if ((r.speed ?? 0) > 2) movedPings.set(r.asset_id, (movedPings.get(r.asset_id) ?? 0) + 1)
    }

    const weekMiles: Record<string, number> = {}
    for (const a of trackable) {
      const n = movedPings.get(a.id)
      // Thinned pings ≈ minutes moving; miles here would be a guess — report
      // relative activity as "moving pings" only when composing needs it.
      if (n) weekMiles[a.name] = n
    }
    const unusedAssets = trackable.filter((a) => newestMs.has(a.id) && !movedPings.has(a.id)).map((a) => a.name)
    const darkAssets = trackable
      .filter((a) => (newestMs.get(a.id) ?? 0) < Date.now() - 48 * 3_600_000)
      .map((a) => a.name)
    const weakBatteries = trackable
      .flatMap((a) => {
        const pct = newestBatt.get(a.id)
        return pct != null && pct < 15 ? [{ name: a.name, pct }] : []
      })
      .slice(0, 5)

    const lastCheck = new Map<string, number>()
    for (const c of checksQ.data ?? []) {
      const k = `${c.asset_id}:${c.check_type}`
      const ms = new Date(c.created_at).getTime()
      if ((lastCheck.get(k) ?? 0) < ms) lastCheck.set(k, ms)
    }
    const checksOverdue: WeekFacts['checksOverdue'] = []
    for (const a of assets.filter((x) => x.type === 'equipment')) {
      for (const t of CHECK_TYPES) {
        const ms = lastCheck.get(`${a.id}:${t.key}`)
        if (!ms) continue
        const daysOver = Math.floor((Date.now() - ms) / 86_400_000) - t.intervalDays
        if (daysOver > 0) checksOverdue.push({ asset: a.name, check: t.label.toLowerCase(), daysOver })
      }
    }

    const hoursByPerson: Record<string, number> = {}
    for (const e of entriesQ.data ?? []) {
      const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : new Date(e.clock_in_at).getTime()
      const h = Math.max(0, (end - new Date(e.clock_in_at).getTime()) / 3_600_000)
      hoursByPerson[e.person_name] = (hoursByPerson[e.person_name] ?? 0) + h
    }

    const facts: WeekFacts = {
      company: co.name ?? 'Company',
      weekMiles,
      unusedAssets: unusedAssets.slice(0, 5),
      darkAssets: darkAssets.slice(0, 5),
      weakBatteries,
      openAlerts: (alertsQ.data ?? []).filter((e) => !isZoneLogEvent(e as { kind?: string | null; rule?: { trigger?: string | null } | null })).slice(0, 10).map((e) => ({
        asset: nameOf.get(e.asset_id) ?? 'Asset',
        trigger: ((e.rule as { trigger?: string } | null)?.trigger ?? 'alert').replace(/_/g, ' '),
      })),
      checksOverdue: checksOverdue.slice(0, 6),
      hoursByPerson,
      safetyNotes: (logsQ.data ?? []).map((l) => l.safety).filter((s): s is string => !!s?.trim()).slice(0, 5),
      logsFiled: (logsQ.data ?? []).length,
    }

    const text = (await composeWithAi(facts)) ?? plainAgenda(facts)
    const sent = await pushAgenda(facts.company, text)
    results.push({ company: facts.company, sent, text })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), results })
}
