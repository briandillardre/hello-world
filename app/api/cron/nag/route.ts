import { NextRequest, NextResponse } from 'next/server'
import { BRAND_URL } from '@/lib/brand'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The 7 PM nag — quiet unless someone forgot. Runs an hour after the evening
 * digest; if anyone is still on the clock it pushes ONE reminder naming them.
 * Nobody still on = no push at all (nag fatigue kills nag systems).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const url = process.env.NOTIFY_WEBHOOK_URL
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const sinceIso = new Date(Date.now() - 18 * 3_600_000).toISOString()

  const { data: open } = await db
    .from('time_entries')
    .select('person_name, clock_in_at, company_id')
    .is('clock_out_at', null)
    .gte('clock_in_at', sinceIso)
    .limit(50)

  if (!open?.length) return NextResponse.json({ ok: true, stillOn: 0 })

  const names = Array.from(new Set(open.map((e) => e.person_name))).slice(0, 10)
  let sent = false
  if (url && (/(^|\/\/|\.)ntfy\./.test(url) || url.includes('ntfy.sh/'))) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Title: 'Still on the clock', Priority: 'default', Tags: 'alarm_clock', Click: `${BRAND_URL}/logs` },
      body: `${names.join(', ')} never clocked out. The daily log is the way out — give ${names.length === 1 ? 'them' : 'em'} a nudge.`,
    }).catch(() => null)
    sent = !!res?.ok
  }
  return NextResponse.json({ ok: true, stillOn: names.length, sent })
}
