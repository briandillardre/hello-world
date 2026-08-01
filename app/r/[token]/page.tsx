import type { Metadata } from 'next'
import { CaptureForm } from './CaptureForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Snap the receipt', robots: { index: false } }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Magic receipt-capture page. The token IS the auth — minted server-side when
 * a card alert arrives, scoped to exactly one charge, dead once captured. No
 * login: the person holding the card is standing in a parking lot; every
 * second of friction is a receipt that never gets photographed.
 */
export default async function CapturePage({ params }: { params: { token: string } }) {
  let charge: { merchant: string | null; amount: number; txn_date: string; last4: string | null; captured: boolean } | null = null
  let zones: { id: string; name: string }[] = []

  if (!isMock && /^[A-Za-z0-9_-]{16,64}$/.test(params.token)) {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const db = createServiceClient()
    const { data: exp } = await db.from('expenses')
      .select('company_id, merchant, amount, txn_date, last4, status')
      .eq('capture_token', params.token).maybeSingle()
    if (exp) {
      charge = {
        merchant: exp.merchant, amount: Number(exp.amount), txn_date: exp.txn_date,
        last4: exp.last4, captured: exp.status !== 'needs_receipt',
      }
      // Job picker: active site zones only — this choice IS the job costing.
      const { data: gs } = await db.from('geofences')
        .select('id, name, kind, completed_at, active_until')
        .eq('company_id', exp.company_id).is('owner_id', null)
      zones = (gs ?? [])
        .filter((g) => (g.kind ?? 'site') === 'site' && !g.completed_at &&
          (!g.active_until || Date.parse(g.active_until) > Date.now()))
        .map((g) => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 text-ink">
      <div className="max-w-md mx-auto px-4 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber mb-1">HammerTrack</p>
        {!charge ? (
          <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6">
            <h1 className="font-display font-bold text-lg mb-2">Link not found</h1>
            <p className="text-sm text-muted">
              This capture link is invalid or was already used. If the receipt still needs to be
              logged, add it from the Receipts page in the app.
            </p>
          </div>
        ) : charge.captured ? (
          <div className="rounded-2xl border border-teal/40 bg-navy-900 p-6">
            <h1 className="font-display font-bold text-lg mb-2">✅ Already captured</h1>
            <p className="text-sm text-muted">
              The receipt for {charge.merchant ? `${charge.merchant} ` : ''}(${charge.amount.toFixed(2)}) is in.
              Nothing else to do.
            </p>
          </div>
        ) : (
          <CaptureForm
            token={params.token}
            merchant={charge.merchant}
            amount={charge.amount}
            last4={charge.last4}
            zones={zones}
          />
        )}
      </div>
    </div>
  )
}
