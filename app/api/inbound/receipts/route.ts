import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual, createHash, randomBytes } from 'crypto'
import { parseCardAlert, slugFromInboundAddress } from '@/lib/receipts/card-alerts'
import { BRAND_URL } from '@/lib/brand'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Resend inbound webhook — the swipe-time trigger for receipt chase.
 *
 * The customer points their card issuer's instant transaction-alert emails at
 * receipts-{slug}@hammertrack.ai. Resend receives the mail and POSTs it here
 * (event `email.received` — configure the webhook + an inbound domain in the
 * Resend dashboard). We parse merchant/amount/last-4, open an expense in
 * `needs_receipt`, and push "snap the receipt?" to the mapped cardholder with
 * a magic capture link — all within seconds of the card being swiped.
 *
 * Auth: Svix signature (Resend signs all webhooks). RESEND_INBOUND_SECRET
 * (whsec_…) must be set — without it this endpoint fails closed, same posture
 * as the flespi webhook. Always answers 200 after auth so Resend doesn't
 * retry-storm over unparseable marketing mail.
 */

function verifySvix(req: NextRequest, payload: string): boolean {
  const secret = process.env.RESEND_INBOUND_SECRET
  if (!secret) return false
  const id = req.headers.get('svix-id')
  const ts = req.headers.get('svix-timestamp')
  const sigHeader = req.headers.get('svix-signature')
  if (!id || !ts || !sigHeader) return false
  // Reject stale timestamps (5 min) — standard svix replay protection.
  const age = Math.abs(Date.now() / 1000 - Number(ts))
  if (!Number.isFinite(age) || age > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const want = createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')
  const wantBuf = Buffer.from(want)
  // Header form: "v1,<b64> v1,<b64>…" — accept if ANY listed signature matches.
  for (const part of sigHeader.split(/\s+/)) {
    const sig = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part
    const gotBuf = Buffer.from(sig)
    if (gotBuf.length === wantBuf.length && timingSafeEqual(gotBuf, wantBuf)) return true
  }
  return false
}

interface InboundEmail {
  from?: string
  to?: string | string[]
  subject?: string
  text?: string
  html?: string
  message_id?: string
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifySvix(req, raw)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let evt: { type?: string; data?: InboundEmail }
  try { evt = JSON.parse(raw) } catch { return NextResponse.json({ ok: true, skipped: 'bad json' }) }
  if (evt.type && evt.type !== 'email.received') return NextResponse.json({ ok: true, skipped: evt.type })
  const mail = evt.data ?? (evt as InboundEmail)

  const toList = Array.isArray(mail.to) ? mail.to : [mail.to ?? '']
  const slug = toList.map((t) => slugFromInboundAddress(String(t))).find(Boolean) ?? null
  if (!slug) return NextResponse.json({ ok: true, skipped: 'no inbound slug in recipient' })

  const parsed = parseCardAlert({ subject: mail.subject, text: mail.text, html: mail.html, from: mail.from })
  if (!parsed) return NextResponse.json({ ok: true, skipped: 'not a transaction alert' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const { data: company } = await db.from('companies')
    .select('id, name, alert_phone').eq('inbound_slug', slug).single()
  if (!company) return NextResponse.json({ ok: true, skipped: 'unknown slug' })

  // Dedup: issuers often send the same alert to several recipients, and Resend
  // retries. Hash what identifies the swipe; message_id alone isn't enough
  // (forwards re-id), amount+last4+day alone is too strict (two coffees).
  const day = new Date().toISOString().slice(0, 10)
  const externalId = 'alert:' + createHash('sha256')
    .update([mail.message_id ?? '', parsed.amount.toFixed(2), parsed.last4 ?? '', parsed.merchant ?? '', day].join('|'))
    .digest('hex').slice(0, 32)

  // Card → cardholder mapping (set once on the Receipts page).
  let cardholderUserId: string | null = null
  let cardLabel: string | null = null
  if (parsed.last4) {
    const { data: card } = await db.from('company_cards')
      .select('user_id, label').eq('company_id', company.id).eq('last4', parsed.last4).maybeSingle()
    cardholderUserId = card?.user_id ?? null
    cardLabel = card?.label ?? null
  }

  const captureToken = randomBytes(18).toString('base64url')
  const { data: inserted, error } = await db.from('expenses').insert({
    company_id: company.id,
    source: 'card_alert',
    merchant: parsed.merchant,
    amount: parsed.amount,
    txn_date: day,
    last4: parsed.last4,
    cardholder_user_id: cardholderUserId,
    status: 'needs_receipt',
    external_id: externalId,
    capture_token: captureToken,
    nag_level: 1,
    chased_at: new Date().toISOString(),
  }).select('id').single()
  if (error) {
    // Unique violation on external_id = duplicate alert — done, quietly.
    if (error.code === '23505') return NextResponse.json({ ok: true, deduped: true })
    console.error('card-alert insert failed', error)
    return NextResponse.json({ ok: true, skipped: 'insert failed' })
  }

  // The instant ping. Push to the cardholder (falls back to all company
  // devices), SMS to the company alert phone if Twilio is live. The link IS
  // the auth — camera opens with zero login friction.
  const where = parsed.merchant ? ` at ${parsed.merchant}` : ''
  const card = parsed.last4 ? ` on card …${parsed.last4}${cardLabel ? ` (${cardLabel})` : ''}` : ''
  const link = `${BRAND_URL}/r/${captureToken}`
  const body = `$${parsed.amount.toFixed(2)}${where}${card} — snap the receipt: ${link}`

  let pushed = 0
  try {
    const { sendPushToUser } = await import('@/lib/push')
    pushed = await sendPushToUser(company.id, cardholderUserId, { title: '🧾 Snap the receipt?', body })
  } catch { /* best-effort */ }
  try {
    if (company.alert_phone) {
      const { sendAlertSms } = await import('@/lib/notify')
      await sendAlertSms(company.alert_phone, `${company.name}: ${body}`)
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, expense: inserted?.id, pushed })
}
