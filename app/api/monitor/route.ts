import { NextRequest, NextResponse } from 'next/server'
import { notifySystem } from '@/lib/monitor'

export const dynamic = 'force-dynamic'

/**
 * Client-side error intake: the browser reports uncaught errors here and we
 * page the owner over ntfy. Demo mode stays silent — random visitors on the
 * public demo shouldn't be able to ring anyone's phone.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ ok: true })
  let body: { message?: string; source?: string; stack?: string } = {}
  try { body = await req.json() } catch { /* malformed → generic */ }
  const message = String(body.message ?? 'unknown error').slice(0, 300)
  const source = String(body.source ?? 'browser').slice(0, 120)
  // Extension noise and cross-origin junk carry no signal.
  if (/^Script error\.?$/i.test(message) || /ResizeObserver loop/i.test(message)) {
    return NextResponse.json({ ok: true })
  }
  const stack = String(body.stack ?? '').split('\n').slice(0, 3).join('\n').slice(0, 400)
  await notifySystem('browser error', `${message}\n@ ${source}${stack ? `\n${stack}` : ''}`)
  return NextResponse.json({ ok: true })
}
