import { NextRequest, NextResponse } from 'next/server'
import { safeTz } from '@/lib/dates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Receipt chase — runs EVERY 15 MINUTES (was hourly) to drive two loops.
 *
 * 1. THE NAG LADDER for swipe-time charges (source 'card_alert'). The ingest
 *    ping is rung 1. Then, until the receipt is captured or the charge is
 *    marked "no receipt needed" (Brian, Sep 9: "annoy the hell out of them
 *    until they take a picture"):
 *      rung 2   T+15 min   push
 *      rung 3   T+1 h      push + text (the cardholder's cell, if we have it)
 *      rung 4   T+4 h      push + text, sharper
 *      rung 5   T+24 h     push + text, AND the owner/admins get told once
 *      rung 6+  7 AM and 5 PM, company local time, every day — push, text
 *               in the evening — for two weeks; then the nightly digest
 *               (loop 2) carries it like any other aging charge.
 *    Every push carries the capture link as its tap target. The in-app bar
 *    (ReceiptNagBar) shows the same charges on every screen in between.
 * 2. THE NIGHTLY DIGEST for ALL aging unreceipted charges — unchanged, gated
 *    to the first run of the 22:xx UTC hour so it stays once a day.
 *
 * Manual test: GET with Authorization: Bearer $CRON_SECRET.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const GRACE_DAYS = 3
const RECHASE_DAYS = 3
const LADDER_DAYS = 14
/** Merchant name the Receipts page's test button writes (lib/actions/cards.ts). */
const TEST_MERCHANT = 'HammerTrack test swipe'
const MIN = 60_000
const HOUR = 3_600_000

interface OpenCharge {
  id: string
  company_id: string
  merchant: string | null
  amount: number
  txn_date: string
  last4: string | null
  cardholder_user_id: string | null
  capture_token: string | null
  nag_level: number
  created_at: string
  chased_at: string | null
  escalated_at: string | null
}

const money = (n: number | string) => `$${Number(n).toFixed(2)}`

function localHour(nowMs: number, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(nowMs))
  return Number(h) % 24
}

function dayLabel(txnDate: string, tz: string): string {
  const d = new Date(`${txnDate}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
}

/** Which rung fires now, if any. */
function dueRung(e: OpenCharge, nowMs: number, tz: string): number | null {
  const age = nowMs - Date.parse(e.created_at)
  const sinceLast = nowMs - Date.parse(e.chased_at ?? e.created_at)
  const lvl = e.nag_level ?? 1
  if (lvl <= 1) return age >= 15 * MIN ? 2 : null
  if (lvl === 2) return age >= 1 * HOUR ? 3 : null
  if (lvl === 3) return age >= 4 * HOUR ? 4 : null
  if (lvl === 4) return age >= 24 * HOUR ? 5 : null
  // Twice a day in local time, once per window (the cron runs 4× an hour).
  const h = localHour(nowMs, tz)
  if ((h === 7 || h === 17) && sinceLast >= 6 * HOUR) return lvl + 1
  return null
}

function copyFor(rung: number, e: OpenCharge, link: string, tz: string, nowMs: number): { title: string; body: string; sms: boolean } {
  const amt = money(e.amount)
  const where = e.merchant ? ` at ${e.merchant}` : ''
  const day = dayLabel(e.txn_date, tz)
  switch (rung) {
    case 2: return { title: '🧾 Receipt still missing', body: `Still need the receipt for ${amt}${where}. 20 seconds: ${link}`, sms: false }
    case 3: return { title: '🧾 An hour, no receipt', body: `An hour later, still no receipt for ${amt}${where}. Snap it now: ${link}`, sms: true }
    case 4: return { title: '🧾 4 hours. Still missing.', body: `${amt}${where} is a hole in the books until you snap it: ${link}`, sms: true }
    case 5: return { title: '🧾 Day two — the owner sees this now', body: `${amt}${where} from ${day} is on the owner's list. Snap it: ${link}`, sms: true }
    default: {
      const evening = localHour(nowMs, tz) >= 12
      return evening
        ? { title: '🧾 Before you head home', body: `${amt}${where} receipt from ${day} — snap it before you park: ${link}`, sms: true }
        : { title: '🧾 Still owed: a receipt', body: `Morning. Still owed: ${amt}${where} (${day}). ${link}`, sms: false }
    }
  }
}

export async function GET(req: NextRequest) {
  // Fails CLOSED like /api/cron/usage: this run sends texts on the company's
  // Twilio line, so no secret = no run.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const now = Date.now()

  // ── Loop 1: the nag ladder (every run) ──────────────────────────────────
  let laddered = 0
  let escalated = 0
  let texted = 0
  try {
    const { data: fresh } = await db
      .from('expenses')
      .select('id, company_id, merchant, amount, txn_date, last4, cardholder_user_id, capture_token, nag_level, created_at, chased_at, escalated_at')
      .eq('source', 'card_alert')
      .eq('status', 'needs_receipt')
      .gte('created_at', new Date(now - LADDER_DAYS * 86_400_000).toISOString())
      .limit(2000)
    const open = (fresh ?? []) as OpenCharge[]
    if (open.length) {
      const { sendPushToUser } = await import('@/lib/push')
      const { sendAlertSms } = await import('@/lib/notify')
      const { BRAND_URL } = await import('@/lib/brand')

      const companyIds = Array.from(new Set(open.map((e) => e.company_id)))
      const { data: cos } = await db.from('companies').select('id, name, alert_phone, digest_prefs').in('id', companyIds)
      const company = new Map((cos ?? []).map((c) => [c.id as string, c]))
      const { data: people } = await db.from('profiles').select('id, company_id, name, role, phone').in('company_id', companyIds)
      const person = new Map((people ?? []).map((p) => [p.id as string, p]))

      for (const e of open) {
        const co = company.get(e.company_id)
        const tz = safeTz((co?.digest_prefs as { tz?: string } | null)?.tz ?? null)
        let rung = dueRung(e, now, tz)
        if (!rung || !e.capture_token) continue
        // A "Send me a test swipe" row proves the loop; it never reaches the
        // owner escalation or the two-week daily rungs.
        if (e.merchant === TEST_MERCHANT && rung >= 5) rung = 0
        if (!rung) { await db.from('expenses').update({ chased_at: new Date(now).toISOString() }).eq('id', e.id); continue }
        const link = `${BRAND_URL}/r/${e.capture_token}`
        const msg = copyFor(rung, e, link, tz, now)
        const holder = e.cardholder_user_id ? person.get(e.cardholder_user_id) : null

        await sendPushToUser(e.company_id, e.cardholder_user_id, { title: msg.title, body: msg.body, url: `/r/${e.capture_token}` }, { strict: true })
        if (msg.sms && holder?.phone) {
          try { await sendAlertSms(String(holder.phone), `${co?.name ?? 'HammerTrack'}: ${msg.body}`); texted++ } catch { /* best-effort */ }
        }

        // Rung 5: the owner and admins hear about it once, in their own words.
        const patch: Record<string, unknown> = { nag_level: rung, chased_at: new Date(now).toISOString() }
        if (rung === 5 && !e.escalated_at) {
          const who = (holder?.name as string | undefined) || (e.last4 ? `Whoever carries card …${e.last4}` : 'Someone')
          const body = `${who} hasn't snapped the ${money(e.amount)}${e.merchant ? ` ${e.merchant}` : ''} receipt from ${dayLabel(e.txn_date, tz)} — 24 hours and counting.`
          const bosses = (people ?? []).filter((p) => p.company_id === e.company_id && (p.id === e.company_id || p.role === 'admin') && p.id !== e.cardholder_user_id)
          for (const b of bosses) {
            try { await sendPushToUser(e.company_id, b.id as string, { title: '🧾 Receipt overdue a day', body, url: '/receipts' }, { strict: true }) } catch { /* best-effort */ }
          }
          if (co?.alert_phone) { try { await sendAlertSms(String(co.alert_phone), `${co.name}: ${body}`) } catch { /* best-effort */ } }
          patch.escalated_at = new Date(now).toISOString()
          escalated++
        }
        await db.from('expenses').update(patch).eq('id', e.id)
        laddered++
      }
    }
  } catch (err) {
    console.error('receipt-chase ladder failed', err)
  }

  // ── Loop 2: nightly digest — only the first run of the 22:xx UTC hour ────
  const d = new Date(now)
  if (d.getUTCHours() !== 22 || d.getUTCMinutes() >= 15) {
    return NextResponse.json({ ok: true, laddered, escalated, texted, digest: 'skipped (not the nightly run)' })
  }

  const olderThan = new Date(now - GRACE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const rechaseBefore = new Date(now - RECHASE_DAYS * 86_400_000).toISOString()

  const { data: rows, error } = await db
    .from('expenses')
    .select('id, company_id, merchant, amount, txn_date, chased_at')
    .eq('status', 'needs_receipt')
    .lte('txn_date', olderThan)
    .or(`chased_at.is.null,chased_at.lt.${rechaseBefore}`)
    .limit(2000)
  if (error) return NextResponse.json({ ok: true, laddered, skipped: 'expenses unavailable', detail: error.message })
  if (!rows?.length) return NextResponse.json({ ok: true, laddered, escalated, texted, chased: 0 })

  const byCompany = new Map<string, { ids: string[]; count: number; total: number }>()
  for (const r of rows) {
    const g = byCompany.get(r.company_id) ?? { ids: [], count: 0, total: 0 }
    g.ids.push(r.id); g.count++; g.total += Number(r.amount)
    byCompany.set(r.company_id, g)
  }

  let notified = 0
  const { dispatchAlerts } = await import('@/lib/notify')
  for (const [companyId, g] of Array.from(byCompany.entries())) {
    const { data: co } = await db.from('companies').select('name, alert_phone, alert_email').eq('id', companyId).single()
    await dispatchAlerts(
      co?.name ?? 'Your fleet',
      { phone: co?.alert_phone, email: co?.alert_email },
      [{ severity: 'info', reason: `${g.count} charge${g.count === 1 ? '' : 's'} still need a receipt ($${g.total.toFixed(2)}). Snap them in HammerTrack → Receipts.` }],
      companyId,
    )
    await db.from('expenses').update({ chased_at: new Date(now).toISOString() }).in('id', g.ids)
    notified++
  }

  return NextResponse.json({ ok: true, laddered, escalated, texted, companies: notified, charges: rows.length })
}
