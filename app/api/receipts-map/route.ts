import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions } from '@/lib/permissions-server'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Receipts as a MAP layer (Brian, Sep 9: "these should also be a layer to be
 * shown on the map"). One pin per card charge in the window:
 *   red   — still needs a photo, pinned where the swipe happened (the truck
 *           at the vendor counter, else the cardholder's phone — 099)
 *   teal  — captured, pinned where the PHOTO was taken (or the swipe, when
 *           the photo carried no fix), with the picture in the popup
 * Dollar figures are a cost-level fact: no costs permission → an empty layer,
 * never a 403 the panel would show as "feed down". Capture tokens ride ONLY
 * on the caller's own open charges (the "Snap now" button in the popup) —
 * an API-layer rule; the underlying expenses policy is company-wide (see
 * /api/receipts/mine, task #59).
 */
export interface ReceiptPin {
  id: string
  merchant: string | null
  amount: number
  day: string
  status: 'open' | 'captured'
  holder: string | null
  lat: number
  lng: number
  at: 'swipe' | 'photo'
  createdAt: string
  photo: string | null
  token: string | null
}

export async function GET(req: NextRequest) {
  if (isMock) return NextResponse.json({ pins: [] })
  try {
    const perms = await getMyPermissions()
    if (!perms.canViewCosts) return NextResponse.json({ pins: [] })
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ pins: [] })

    const q = new URL(req.url).searchParams
    const toMs = Number(q.get('to')) || Date.now()
    const fromMs = Number(q.get('from')) || toMs - 30 * 86_400_000
    const [{ data: rows, error }, { data: people }] = await Promise.all([
      supabase.from('expenses')
        .select('id, merchant, amount, txn_date, status, cardholder_user_id, capture_token, swipe_lat, swipe_lng, created_at, receipt:receipts(lat, lng, url, taken_at)')
        .eq('source', 'card_alert')
        .in('status', ['needs_receipt', 'matched'])
        .gte('created_at', new Date(fromMs).toISOString())
        .lte('created_at', new Date(toMs + 86_400_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('profiles').select('id, name'),
    ])
    if (error) return NextResponse.json({ pins: [] }) // pre-099 schema
    const name = new Map((people ?? []).map((p) => [p.id as string, (p.name as string) || null]))

    const pins: ReceiptPin[] = []
    for (const r of rows ?? []) {
      const rc = (Array.isArray(r.receipt) ? r.receipt[0] : r.receipt) as { lat: number | null; lng: number | null; url: string; taken_at: string | null } | null
      const captured = r.status === 'matched'
      const photoFix = rc && typeof rc.lat === 'number' && typeof rc.lng === 'number'
      const swipeFix = typeof r.swipe_lat === 'number' && typeof r.swipe_lng === 'number'
      if (!photoFix && !swipeFix) continue
      const usePhoto = captured && photoFix
      pins.push({
        id: r.id as string,
        merchant: (r.merchant as string | null) ?? null,
        amount: Number(r.amount),
        day: r.txn_date as string,
        status: captured ? 'captured' : 'open',
        holder: r.cardholder_user_id ? name.get(r.cardholder_user_id as string) ?? null : null,
        lat: usePhoto ? (rc!.lat as number) : (r.swipe_lat as number),
        lng: usePhoto ? (rc!.lng as number) : (r.swipe_lng as number),
        at: usePhoto ? 'photo' : 'swipe',
        createdAt: r.created_at as string,
        photo: captured ? rc?.url ?? null : null,
        token: !captured && r.cardholder_user_id === user.id ? (r.capture_token as string | null) ?? null : null,
      })
    }
    return NextResponse.json({ pins })
  } catch {
    return NextResponse.json({ pins: [] })
  }
}
