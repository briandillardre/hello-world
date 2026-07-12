'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Sparkles, ExternalLink, Receipt } from 'lucide-react'
import { extractReceiptAction, approveReceiptAction, rejectReceiptAction, type ReceiptRow } from '@/lib/actions/receipts'

/**
 * The receipts inbox — stage 4 of the AI ladder, propose-only by design:
 * AI reads the photo and fills the fields, a human edits and taps ✓, and only
 * then does a Purchase post to QuickBooks. Reject sends it to the done pile
 * with a note. Nothing ever posts unreviewed.
 */

const CATEGORIES = ['fuel', 'materials', 'repairs', 'meals', 'tools', 'other']

function PendingCard({ r, zoneNames }: { r: ReceiptRow; zoneNames: Record<string, string> }) {
  const router = useRouter()
  const [vendor, setVendor] = useState(r.vendor ?? '')
  const [amount, setAmount] = useState(r.amount != null ? String(r.amount) : '')
  const [date, setDate] = useState(r.txn_date ?? '')
  const [category, setCategory] = useState(r.category ?? '')
  const [busy, setBusy] = useState<'extract' | 'approve' | 'reject' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  const run = async (kind: 'extract' | 'approve' | 'reject') => {
    if (busy) return
    setBusy(kind)
    setMsg(null)
    const res =
      kind === 'extract' ? await extractReceiptAction(r.id)
      : kind === 'approve' ? await approveReceiptAction(r.id, {
          vendor: vendor.trim() || undefined,
          amount: amount.trim() ? Number(amount) : undefined,
          txn_date: date || undefined,
          category: category || undefined,
        })
      : await rejectReceiptAction(r.id)
    setBusy(null)
    if (!res.ok) setMsg(res.error ?? 'Failed')
    else router.refresh()
  }

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-950 p-3 flex gap-3">
      <button onClick={() => setZoom(true)} className="flex-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.url} alt="receipt" className="w-24 h-32 object-cover rounded-lg border border-navy-700" />
      </button>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor"
            className="flex-1 min-w-0 bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" inputMode="decimal"
            className="w-24 bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50 text-right tabular-nums" />
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="bg-navy-900 border border-navy-700 rounded-lg px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-amber/50" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="bg-navy-900 border border-navy-700 rounded-lg px-2 py-1.5 text-[12px] text-ink outline-none focus:border-amber/50">
            <option value="">category…</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {r.project_geofence_id && zoneNames[r.project_geofence_id] && (
            <span className="text-[11px] text-teal truncate">{zoneNames[r.project_geofence_id]}</span>
          )}
        </div>
        {msg && <p className="text-[11.5px] text-alert">{msg}</p>}
        <div className="flex items-center gap-2 pt-0.5">
          <button onClick={() => run('extract')} disabled={!!busy}
            className="flex items-center gap-1 rounded-lg border border-navy-700 bg-navy-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-muted hover:text-ink disabled:opacity-40">
            <Sparkles className="h-3 w-3 text-amber" /> {busy === 'extract' ? 'Reading…' : 'AI read'}
          </button>
          <button onClick={() => run('approve')} disabled={!!busy}
            className="flex items-center gap-1 rounded-lg bg-teal/20 border border-teal/40 text-teal px-3 py-1.5 text-[11.5px] font-bold hover:bg-teal/30 disabled:opacity-40">
            <Check className="h-3.5 w-3.5" /> {busy === 'approve' ? 'Posting…' : 'Approve → QuickBooks'}
          </button>
          <button onClick={() => run('reject')} disabled={!!busy}
            className="flex items-center gap-1 rounded-lg border border-navy-700 text-faint px-2.5 py-1.5 text-[11.5px] font-semibold hover:text-alert disabled:opacity-40">
            <X className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
      </div>
      {zoom && (
        <button className="fixed inset-0 z-[70] bg-black/85 grid place-items-center p-4" onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.url} alt="receipt" className="max-h-[92vh] max-w-full rounded-lg" />
        </button>
      )}
    </div>
  )
}

export function ReceiptsInbox({ pending, done, zoneNames }: {
  pending: ReceiptRow[]
  done: ReceiptRow[]
  zoneNames: Record<string, string>
}) {
  return (
    <div className="space-y-5">
      {pending.length === 0 ? (
        <div className="rounded-xl border border-navy-700 bg-navy-950 p-8 text-center">
          <Receipt className="h-8 w-8 text-faint mx-auto mb-2" />
          <p className="text-sm text-muted">
            Inbox zero. Receipts land here when the crew snaps them at clock-out — AI reads them,
            you approve, QuickBooks gets the expense.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => <PendingCard key={r.id} r={r} zoneNames={zoneNames} />)}
        </div>
      )}

      {done.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-1.5">Done</p>
          <ul className="space-y-1">
            {done.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12.5px] rounded-lg border border-navy-800 bg-navy-950 px-3 py-2">
                <span className={r.status === 'approved' ? 'text-teal' : 'text-faint'}>{r.status === 'approved' ? '✓' : '✕'}</span>
                <span className="text-ink font-medium truncate flex-1">{r.vendor ?? 'Receipt'}</span>
                {r.amount != null && <span className="font-mono text-muted tabular-nums">${Number(r.amount).toFixed(2)}</span>}
                {r.qbo_purchase_id && <ExternalLink className="h-3 w-3 text-faint" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
