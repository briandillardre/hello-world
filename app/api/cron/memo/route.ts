import { NextRequest, NextResponse } from 'next/server'
import { ensureOwnerMemo } from '@/lib/memo'
import { escapeHtml } from '@/lib/email'
import { shell } from '@/lib/weekly-digest'
import { BRAND_URL } from '@/lib/brand'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Monthly owner memo — runs on the 1st, composes each company's memo for
 * the new month (covering the trailing 30 days) and mails it to the
 * company's alert email. The memo also renders on /finance, where a fresh
 * one is generated lazily on first view — this cron keeps inboxes warm.
 *
 * Manual test: GET /api/cron/memo with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  // FAIL CLOSED (sec-check): this cron spends model tokens and mails every
  // company — without CRON_SECRET it must refuse, same as usage/simulator.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: companies } = await db.from('companies').select('id, name, alert_email').limit(50)
  const results: { company: string; composed: boolean; mailed: boolean }[] = []
  for (const co of companies ?? []) {
    try {
      const memo = await ensureOwnerMemo(db, co.id, co.name ?? 'Your company')
      let mailed = false
      // mailed_at stamp: a re-run (manual kick, platform retry) must never
      // re-mail a memo the company already got this month.
      if (memo && !memo.mailed_at && co.alert_email) {
        const { sendEmail } = await import('@/lib/email')
        const paras = memo.memo.split(/\n{2,}/).map((p) =>
          `<p style="margin:0 0 12px;font-size:13.5px;line-height:1.6;color:#c7d6e4">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
        ).join('')
        const html = shell(
          `${co.name ?? 'Your company'} — owner memo`,
          paras + `<p style="margin:14px 0 0;font-size:11.5px;color:#6f88a0">Every number above is computed from your tracked data — the full picture lives at ${BRAND_URL}/finance.</p>`
        )
        const r = await sendEmail(co.alert_email, `${co.name ?? 'Your company'} — this month's owner memo`, html)
        mailed = r.ok
        if (mailed) {
          await db.from('owner_memos').update({ mailed_at: new Date().toISOString() })
            .eq('company_id', co.id).eq('month', memo.month)
        }
      }
      results.push({ company: co.name ?? co.id, composed: !!memo, mailed })
    } catch (err) {
      console.error('Owner memo failed for', co.id, err)
      results.push({ company: co.name ?? co.id, composed: false, mailed: false })
    }
  }
  return NextResponse.json({ ran: results.length, results })
}
