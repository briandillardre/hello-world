import { NextRequest, NextResponse } from 'next/server'
import { resolveDigestPrefs, dueNow } from '@/lib/weekly-digest'
import { deliverSummary, delivered, claimSend } from '@/lib/digest-delivery'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The evening nag — quiet unless someone forgot to clock out. If anyone on a
 * company's crew is still on, that company gets ONE reminder naming them.
 *
 * OFF by default (digest_prefs.nag), and that is deliberate: it is the least
 * actionable thing we send and the fastest way to teach someone to swipe our
 * notifications away. Nag fatigue kills nag systems.
 *
 * Until Sep 11 this route read open time entries across EVERY company at
 * once, merged the crew names into one list, and pushed them to the single
 * global NOTIFY_WEBHOOK_URL — so one customer's crew names went to a topic
 * belonging to someone else. Now it is scoped and opt-in per company.
 *
 * Manual test: GET /api/cron/nag with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  // FAIL CLOSED (sec-check, Sep 11): this run spends model tokens and mails
  // every company. Unset secret = no run, same as /api/cron/usage and /memo.
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const { data: companies, error } = await db.from('companies')
    .select('id, name, alert_email, alert_phone, digest_prefs, last_nag_at')
    .limit(200)
  if (error) return NextResponse.json({ ok: true, skipped: 'pre-106 DB', detail: error.message })

  // Whose hour is it? Almost always nobody's — resolve that from one cheap
  // row read per company before touching time_entries at all.
  const due = (companies ?? []).filter((co) => {
    const prefs = resolveDigestPrefs(co.digest_prefs)
    // Grace 1h: a "you forgot to clock out" nudge stops being useful late.
    // `force` skips the schedule, never the off switch.
    return prefs.nag.enabled && (force || dueNow({ hour: prefs.nag.hour, tz: prefs.tz, stamp: co.last_nag_at, graceHours: 1 }))
  }).slice(0, 25)
  if (!due.length) return NextResponse.json({ ok: true, due: 0 })

  const sinceIso = new Date(Date.now() - 18 * 3_600_000).toISOString()
  const results: { company: string; stillOn: number; sent: string[] }[] = []

  for (const co of due) {
    const prefs = resolveDigestPrefs(co.digest_prefs)
    const { data: open } = await db
      .from('time_entries')
      .select('person_name')
      .eq('company_id', co.id)
      .is('clock_out_at', null)
      .gte('clock_in_at', sinceIso)
      .limit(50)

    const names = Array.from(new Set((open ?? []).map((e) => e.person_name).filter(Boolean))).slice(0, 10)
    // Nobody still on = no message at all. Not even a stamp: if someone
    // clocks in late and is still on at the next check, that is worth one.
    if (!names.length) { results.push({ company: co.name ?? co.id, stillOn: 0, sent: [] }); continue }

    // Claim before sending: a run killed between the send and the stamp
    // would nag the same crew twice.
    if (!force && !(await claimSend(db, 'last_nag_at', co.id, co.last_nag_at))) continue

    const text = `${names.join(', ')} never clocked out. The daily log is the way out — give ${names.length === 1 ? 'them' : 'em'} a nudge.`
    const res = await deliverSummary({
      db,
      company: co,
      channels: { push: prefs.nag.push },
      title: 'Still on the clock',
      subject: `${co.name ?? 'Your crew'} — still on the clock`,
      text,
      clickPath: '/logs',
      pushKind: 'nag',
    })
    results.push({
      company: co.name ?? co.id,
      stillOn: names.length,
      sent: delivered(res) ? [res.pushed ? `push×${res.pushed}` : '', res.webhooked ? 'owner-webhook' : ''].filter(Boolean) : ['no channel configured'],
    })
  }

  return NextResponse.json({ ok: true, due: due.length, results })
}
