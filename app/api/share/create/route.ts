import { NextRequest, NextResponse } from 'next/server'
import { createShareToken } from '@/lib/share-token'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const MAX_SPAN_MS = 92 * 86_400_000
const LIFE_MS = 7 * 86_400_000

/** Mint a public replay link for ONE asset + window. Caller must be signed in
 *  and able to see the asset (RLS does that check for us). */
export async function POST(req: NextRequest) {
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const body = await req.json().catch(() => null) as { assetId?: string; fromMs?: number; toMs?: number; t?: number } | null
  const { assetId, fromMs, toMs } = body ?? {}
  if (!assetId || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs! <= fromMs!) {
    return NextResponse.json({ error: 'assetId, fromMs, toMs required' }, { status: 400 })
  }

  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: asset } = await supabase.from('assets').select('id').eq('id', assetId).maybeSingle()
  if (!asset) return NextResponse.json({ error: 'asset not found' }, { status: 404 })

  // Very long windows (All / YTD) clamp to the most recent 92 days.
  const to = Math.round(toMs!)
  const from = Math.max(Math.round(fromMs!), to - MAX_SPAN_MS)
  const t = typeof body?.t === 'number' && body.t >= 0 && body.t <= 1 ? body.t : undefined

  const token = createShareToken({ assetId, fromMs: from, toMs: to, t, expMs: Date.now() + LIFE_MS })
  if (!token) return NextResponse.json({ error: 'sharing not configured' }, { status: 501 })

  return NextResponse.json({ url: `${req.nextUrl.origin}/share/${token}` })
}
