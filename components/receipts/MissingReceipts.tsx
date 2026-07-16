'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Upload, Plus, Link2, X } from 'lucide-react'
import type { Expense } from '@/lib/db/expenses'
import { importChargesAction, addExpenseAction, linkReceiptAction, markNoReceiptAction } from '@/lib/actions/expenses'
import { PlaidConnect } from './PlaidConnect'

type Suggestion = { receiptId: string; score: number; reasons: string[] }
type ReceiptLite = { vendor: string | null; amount: number | null; txn_date: string | null; url: string }

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function MissingReceipts({
  open, suggestions, receiptsById,
}: {
  open: Expense[]
  suggestions: Record<string, Suggestion[]>
  receiptsById: Record<string, ReceiptLite>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [csv, setCsv] = useState('')
  const [form, setForm] = useState({ merchant: '', amount: '', txn_date: new Date().toISOString().slice(0, 10), last4: '' })

  const total = open.reduce((s, e) => s + Number(e.amount), 0)

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string } | unknown>, okMsg?: string) => {
    setBusy(key); setMsg(null)
    try {
      const r = (await fn()) as { ok?: boolean; error?: string }
      if (r && r.ok === false) setMsg(r.error ?? 'Something went wrong.')
      else { if (okMsg) setMsg(okMsg); router.refresh() }
    } finally { setBusy(null) }
  }

  return (
    <section className="rounded-xl border border-amber/30 bg-amber/[0.04] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber/20">
        <AlertTriangle className="h-4.5 w-4.5 text-amber flex-none" />
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-[15px] text-ink">Missing receipts</p>
          <p className="text-[12px] text-faint">
            {open.length === 0 ? 'All charges accounted for 🎉' : `${open.length} charge${open.length === 1 ? '' : 's'} without a receipt · ${money(total)} unaccounted`}
          </p>
        </div>
        <PlaidConnect onMessage={setMsg} />
        <button onClick={() => setShowImport((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal hover:text-ink px-2 py-1">
          <Upload className="h-3.5 w-3.5" /> Import
        </button>
        <button onClick={() => setShowAdd((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal hover:text-ink px-2 py-1">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {msg && <p className="px-4 py-2 text-[12px] text-amber bg-amber/5 border-b border-amber/20">{msg}</p>}

      {showImport && (
        <div className="p-4 border-b border-navy-800 space-y-2">
          <p className="text-[12px] text-muted">Paste your card statement as CSV (columns: Date, Description, Amount). We dedupe re-imports and auto-link any charge that already has a matching receipt.</p>
          <textarea
            value={csv} onChange={(e) => setCsv(e.target.value)} rows={4}
            placeholder={'Transaction Date,Description,Amount\n07/14/2026,THE HOME DEPOT #1247,-84.20'}
            className="w-full bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[12.5px] font-mono text-ink outline-none focus:border-amber/50"
          />
          <button
            disabled={busy === 'import' || !csv.trim()}
            onClick={() => run('import', async () => {
              const r = await importChargesAction(csv)
              if (r.ok) { setCsv(''); setShowImport(false); setMsg(`Imported ${r.imported} charge(s)${r.matched ? `, ${r.matched} auto-matched` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}.`) }
              return r
            })}
            className="rounded-lg bg-amber text-[#1a1100] font-semibold text-[13px] px-4 py-2 disabled:opacity-50"
          >
            {busy === 'import' ? 'Importing…' : 'Import charges'}
          </button>
        </div>
      )}

      {showAdd && (
        <div className="p-4 border-b border-navy-800 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} placeholder="Merchant" className="col-span-2 bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-amber/50" />
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" placeholder="Amount" className="bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-amber/50" />
            <input value={form.txn_date} onChange={(e) => setForm({ ...form, txn_date: e.target.value })} type="date" className="bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-amber/50" />
            <input value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value })} inputMode="numeric" maxLength={4} placeholder="Card last 4 (optional)" className="col-span-2 bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-amber/50" />
          </div>
          <button
            disabled={busy === 'add' || !form.merchant.trim() || !form.amount}
            onClick={() => run('add', async () => {
              const r = await addExpenseAction({ merchant: form.merchant, amount: Number(form.amount), txn_date: form.txn_date, last4: form.last4 || undefined })
              if (r.ok) { setForm({ merchant: '', amount: '', txn_date: form.txn_date, last4: '' }); setShowAdd(false) }
              return r
            })}
            className="rounded-lg bg-amber text-[#1a1100] font-semibold text-[13px] px-4 py-2 disabled:opacity-50"
          >
            {busy === 'add' ? 'Adding…' : 'Add charge'}
          </button>
        </div>
      )}

      {open.length > 0 && (
        <div className="divide-y divide-navy-800">
          {open.map((e) => {
            const sug = suggestions[e.id] ?? []
            return (
              <div key={e.id} className="p-3.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-ink text-[14px] truncate flex-1">{e.merchant || 'Charge'}</span>
                  <span className="font-display font-bold text-ink tabular-nums">{money(Number(e.amount))}</span>
                </div>
                <p className="text-[11.5px] text-faint mt-0.5">
                  {day(e.txn_date)}{e.last4 ? ` · card ••${e.last4}` : ''}{e.cardholder_name ? ` · ${e.cardholder_name}` : ''}
                </p>

                {sug.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10.5px] uppercase tracking-wider text-teal font-semibold">Looks like…</p>
                    {sug.map((s) => {
                      const r = receiptsById[s.receiptId]
                      return (
                        <div key={s.receiptId} className="flex items-center gap-2 rounded-lg bg-navy-900 border border-navy-700 px-2.5 py-2">
                          {r?.url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.url} alt="receipt" className="w-8 h-8 rounded object-cover flex-none border border-navy-700" />
                          )}
                          <span className="flex-1 min-w-0 text-[12px]">
                            <span className="text-ink font-medium">{r?.vendor ?? 'Receipt'}</span>
                            <span className="text-faint"> · {r?.amount != null ? money(Number(r.amount)) : '—'}{r?.txn_date ? ` · ${day(r.txn_date)}` : ''}</span>
                            <span className="block text-[10.5px] text-teal">{s.score}% · {s.reasons.join(', ')}</span>
                          </span>
                          <button
                            disabled={busy === e.id}
                            onClick={() => run(e.id, () => linkReceiptAction(e.id, s.receiptId))}
                            className="inline-flex items-center gap-1 rounded-lg bg-teal/15 border border-teal/40 text-teal text-[12px] font-semibold px-2.5 py-1.5 hover:bg-teal/25"
                          >
                            <Link2 className="h-3.5 w-3.5" /> Link
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex items-center gap-3 mt-2.5">
                  <button
                    disabled={busy === e.id}
                    onClick={() => run(e.id, () => markNoReceiptAction(e.id))}
                    className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" /> No receipt needed
                  </button>
                  {sug.length === 0 && <span className="text-[11.5px] text-faint">Snap a receipt below and we&apos;ll match it automatically.</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
