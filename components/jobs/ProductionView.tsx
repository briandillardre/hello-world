'use client'

/**
 * Production (migration 160): the foreman types what got built today — one
 * number per item — and the hours fill themselves from the time cards and the
 * machine ledger. The office reads % complete, the production rate and (with
 * costs) the unit cost against the bid. What is typed is kept on the phone
 * until it saves, so a dead zone never loses a day.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Check, Gauge, Pencil, Plus, Trash2 } from 'lucide-react'
import { PROD_UNITS, qtyWords, readQty, type ProdItem, type ProdUnit, type ProductionRollup } from '@/lib/jobs/production'
import { money } from '@/lib/jobs/payapp'
import type { ProductionData } from '@/lib/db/production'
import { deleteItemAction, itemsFromEstimateAction, saveDayAction, saveItemAction } from '@/lib/actions/production'

const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const num = (n: number | null, dp = 1) => (n === null ? '—' : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString('en-US'))
const pctW = (p: number | null) => (p === null ? '—' : `${Math.round(p * 100)}%`)
const box = 'rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'
const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'

type Draft = Record<string, { qty: string; note: string }>
const draftKey = (zone: string, day: string) => `ht-prod-draft:${zone}:${day}`
function readDraft(zone: string, day: string): Draft | null {
  try { const v = localStorage.getItem(draftKey(zone, day)); return v ? (JSON.parse(v) as Draft) : null } catch { return null }
}
function writeDraft(zone: string, day: string, d: Draft | null) {
  try { if (d) localStorage.setItem(draftKey(zone, day), JSON.stringify(d)); else localStorage.removeItem(draftKey(zone, day)) } catch { /* private window */ }
}

type ItemForm = { id: string | null; code: string; name: string; unit: ProdUnit; budgetQty: string; bidPerDay: string; bidUnitCost: string; crew: string }

export function ProductionView({ zone, data, roll, canLog, canManage, canCosts, demo }: {
  zone: { id: string; name: string }; data: ProductionData; roll: ProductionRollup; canLog: boolean; canManage: boolean; canCosts: boolean; demo: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [day, setDay] = useState(data.today)
  const [form, setForm] = useState<ItemForm | null>(null)
  const items = useMemo(() => [...data.items].sort((a, b) => a.sort - b.sort), [data.items])
  const progress = useMemo(() => new Map(roll.items.map((p) => [p.id, p])), [roll.items])

  // what the server holds for the picked day
  const onDay = useMemo(() => {
    const m: Draft = {}
    for (const e of data.entries) if (e.day === day) m[e.itemId] = { qty: String(e.qty), note: e.note ?? '' }
    return m
  }, [data.entries, day])
  const [vals, setVals] = useState<Draft>({})
  const [fromDraft, setFromDraft] = useState(false)
  const dirty = useRef(false)
  useEffect(() => {
    const d = readDraft(zone.id, day)
    setVals(d ?? onDay); setFromDraft(!!d); dirty.current = !!d
  }, [zone.id, day, onDay])
  function setVal(id: string, patch: Partial<{ qty: string; note: string }>) {
    setVals((v) => {
      const next = { ...v, [id]: { qty: v[id]?.qty ?? '', note: v[id]?.note ?? '', ...patch } }
      writeDraft(zone.id, day, next); dirty.current = true
      return next
    })
    setSaved(null)
  }

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string, after?: () => void) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return false }
    after?.(); router.refresh(); return true
  }

  async function saveDay() {
    const rows = items.map((it) => ({ itemId: it.id, qty: vals[it.id]?.qty ?? '', note: vals[it.id]?.note ?? '' }))
      .filter((r) => r.qty.trim() !== '' || onDay[r.itemId])
    for (const r of rows) if (readQty(r.qty) === 'bad') { setErr('One of the numbers can’t be read — numbers only.'); return }
    if (!rows.length) { setErr('Type at least one number first.'); return }
    await run('day', () => saveDayAction(zone.id, day, rows), 'Couldn’t save — it’s kept on this phone; try again when you have signal.', () => {
      writeDraft(zone.id, day, null); setFromDraft(false); dirty.current = false; setSaved(day)
    })
  }

  const recent = useMemo(() => {
    const days = new Map<string, number>()
    for (const e of data.entries) days.set(e.day, (days.get(e.day) ?? 0) + 1)
    const hrs = new Map(data.days.map((d) => [d.day, d]))
    return Array.from(days.keys()).sort().reverse().slice(0, 14).map((d) => ({ day: d, items: days.get(d)!, hrs: hrs.get(d) ?? null }))
  }, [data.entries, data.days])

  const money$ = roll.earned !== null

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4 text-[12.5px]">
        <div>
          <Link href={`/jobs/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> The job</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Gauge className="h-5 w-5 text-amber flex-none" /> <span className="truncate">Production · {zone.name}</span></h1>
          <p className="text-faint">Type what got built each day — that&apos;s all. The hours come from the crew&apos;s GPS time cards on this site and the machines&apos; own hours{canCosts ? ', and the cost is shared across the day’s items by the value each earned' : ''}.</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-muted">Demo mode — a sample job. Sign in to log your own.</p>}
        {!data.available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber">Production is being set up — try again in a minute.</p>}
        {data.partial && <p className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> Some of the history couldn&apos;t be read just now, so these totals may be short — refresh to try again.</p>}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        {/* where it stands */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Complete" value={pctW(roll.pctComplete)} sub={money$ ? 'by earned value' : 'average of the items'} />
          <Stat label="Days logged" value={String(roll.daysLogged)} sub={roll.unallocatedDays.length ? `${roll.unallocatedDays.length} worked day${roll.unallocatedDays.length === 1 ? '' : 's'} with no quantity` : 'every worked day has numbers'} tone={roll.unallocatedDays.length ? 'warn' : undefined} />
          {money$ ? <>
            <Stat label="Earned / bid" value={money(roll.earned ?? 0)} sub={`of ${money(roll.budgetValue ?? 0)}`} />
            <Stat label={(roll.overUnder ?? 0) >= 0 ? 'Under the bid' : 'Over the bid'} value={money(Math.abs(roll.overUnder ?? 0))} sub={`field cost ${money(roll.allocatedCost ?? 0)}`} tone={(roll.overUnder ?? 0) < 0 ? 'bad' : 'good'} />
          </> : <>
            <Stat label="Items" value={String(items.length)} sub={`${roll.items.filter((p) => (p.pct ?? 0) >= 1).length} done`} />
            <Stat label="Crew hours" value={num(data.days.reduce((a, d) => a + d.laborHrs, 0), 0)} sub="on time cards here" />
          </>}
        </div>
        {roll.unallocatedDays.length > 0 && (
          <p className="text-amber">Worked with nothing logged: {roll.unallocatedDays.slice(-6).map(fmtDay).join(', ')}{roll.unallocatedDays.length > 6 ? ` and ${roll.unallocatedDays.length - 6} more` : ''}{money$ ? ` — ${money(roll.unallocatedCost)} of field cost isn’t on any item until those days get numbers.` : '.'}</p>
        )}

        {/* the day's numbers */}
        {items.length > 0 && (
          <section className="rounded-xl border border-amber/40 bg-navy-900/60 p-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-ink font-semibold text-[14px] flex-1">{day === data.today ? 'Today’s numbers' : `Numbers for ${fmtDay(day)}`}</h2>
              <input type="date" className={box} value={day} max={data.today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
            </div>
            {fromDraft && <p className="text-amber">Not saved yet — kept on this phone.</p>}
            <div className="space-y-2">
              {items.map((it) => {
                const p = progress.get(it.id)
                return (
                  <div key={it.id} className="rounded-lg border border-navy-800 bg-navy-950/60 p-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-ink font-medium truncate">{it.name}</p>
                        <p className="text-faint truncate">{[it.code, it.crew].filter(Boolean).join(' · ')}</p>
                        {p && <p className="text-muted text-[12px]">{it.unit === 'LS' ? qtyWords(p.installed, it.unit) : `${qtyWords(p.installed, it.unit)} of ${qtyWords(it.budgetQty, it.unit)} · ${pctW(p.pct)}`}</p>}
                      </div>
                      {it.unit === 'LS' ? (
                        <button type="button" disabled={!canLog && !demo} onClick={() => setVal(it.id, { qty: vals[it.id]?.qty === '1' ? '' : '1' })}
                          className={'rounded-xl px-3 py-2.5 text-[13px] font-semibold min-w-[96px] ' + (vals[it.id]?.qty === '1' ? 'bg-teal text-navy-950' : 'border border-navy-700 text-muted')}>
                          {vals[it.id]?.qty === '1' ? 'Done today' : 'Mark done'}
                        </button>
                      ) : (
                        <label className="flex items-center gap-1.5">
                          <input inputMode="decimal" enterKeyHint="next" disabled={!canLog && !demo} placeholder="0"
                            className="w-28 rounded-xl border border-navy-700 bg-navy-950 px-3 py-2.5 text-right text-[18px] font-mono text-ink outline-none focus:border-amber"
                            value={vals[it.id]?.qty ?? ''} onChange={(e) => setVal(it.id, { qty: e.target.value })} aria-label={`${it.name} today, ${it.unit}`} />
                          <span className="w-10 text-faint">{it.unit}</span>
                        </label>
                      )}
                    </div>
                    {(vals[it.id]?.qty || vals[it.id]?.note) && (canLog || demo) ? (
                      <input className={box + ' w-full mt-2'} placeholder="Note (optional) — rain, rock, waiting on a sub…" maxLength={300}
                        value={vals[it.id]?.note ?? ''} onChange={(e) => setVal(it.id, { note: e.target.value })} />
                    ) : null}
                  </div>
                )
              })}
            </div>
            {canLog ? (
              <div className="flex items-center gap-2">
                <button type="button" disabled={!!busy} onClick={() => void saveDay()} className="rounded-xl bg-amber px-4 py-2.5 font-semibold text-navy-950 disabled:opacity-50 text-[14px]">{busy === 'day' ? 'Saving…' : 'Save the day'}</button>
                {saved === day && !fromDraft && <span className="inline-flex items-center gap-1 text-teal"><Check className="h-4 w-4" /> Saved</span>}
              </div>
            ) : <p className="text-faint">{demo ? 'Sign in to log quantities.' : 'Your login can read production but not log it.'}</p>}
          </section>
        )}

        {/* the items */}
        <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-ink font-semibold text-[14px] flex-1">Against the bid</h2>
            {canManage && <button type="button" className={btn} onClick={() => setForm({ id: null, code: '', name: '', unit: 'CY', budgetQty: '', bidPerDay: '', bidUnitCost: '', crew: '' })}><Plus className="h-3.5 w-3.5" /> Add an item</button>}
          </div>
          {!items.length && (
            <div className="space-y-2">
              <p className="text-muted">No items yet. {canManage ? 'Bring them over from the won estimate — quantities, production rates and unit costs come with them — or add them by hand.' : 'A Manager sets up the items (from the estimate or by hand); then the crew logs against them.'}</p>
              {canManage && canCosts && <button type="button" disabled={!!busy} onClick={() => void run('est', () => itemsFromEstimateAction(zone.id), 'Couldn’t build them — try again.')} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'est' ? 'Building…' : 'Bring items from the estimate'}</button>}
            </div>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto -mx-3 px-3">
              <table className="min-w-[620px] w-full text-ink">
                <thead className="text-faint text-[10.5px] uppercase tracking-wider"><tr className="text-left">
                  <th className="py-1 pr-2">Item</th><th className="py-1 pr-2 text-right">Done</th><th className="py-1 pr-2 text-right">Per day · bid</th><th className="py-1 pr-2 text-right">Days left</th>
                  {money$ && <><th className="py-1 pr-2 text-right">Unit cost · bid</th><th className="py-1 pr-2 text-right">Over / under</th></>}
                  {canManage && <th className="py-1" />}
                </tr></thead>
                <tbody>
                  {items.map((it) => {
                    const p = progress.get(it.id)
                    if (!p) return null
                    const slow = p.actualPerDay !== null && it.bidPerDay !== null && p.actualPerDay < it.bidPerDay * 0.9
                    const dear = p.actualUnitCost !== null && it.bidUnitCost !== null && p.actualUnitCost > it.bidUnitCost
                    return (
                      <tr key={it.id} className="border-t border-navy-800 align-top">
                        <td className="py-1.5 pr-2">
                          <p className="text-ink">{it.name}</p>
                          <p className="text-faint">{[it.code, it.crew, p.laborHrs ? `${num(p.laborHrs, 0)} crew-h` : null].filter(Boolean).join(' · ')}</p>
                          <div className="mt-1 h-1.5 w-full max-w-[220px] rounded-full bg-navy-800 overflow-hidden"><div className={'h-full ' + ((p.pct ?? 0) >= 1 ? 'bg-teal' : 'bg-amber')} style={{ width: `${Math.min(100, Math.round((p.pct ?? 0) * 100))}%` }} /></div>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono whitespace-nowrap">{qtyWords(p.installed, it.unit)}{it.unit !== 'LS' && <><br /><span className="text-faint">{pctW(p.pct)} of {qtyWords(it.budgetQty, it.unit)}</span></>}</td>
                        <td className={'py-1.5 pr-2 text-right font-mono whitespace-nowrap ' + (slow ? 'text-amber' : '')}>{it.unit === 'LS' ? '—' : <>{num(p.actualPerDay, 0)}<br /><span className="text-faint">{num(it.bidPerDay, 0)} bid</span></>}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{p.daysLeft === null ? '—' : num(p.daysLeft, 1)}</td>
                        {money$ && <>
                          <td className={'py-1.5 pr-2 text-right font-mono whitespace-nowrap ' + (dear ? 'text-red-300' : '')}>{p.actualUnitCost === null ? '—' : money(p.actualUnitCost)}<br /><span className="text-faint">{it.bidUnitCost === null ? '—' : money(it.bidUnitCost)} bid</span></td>
                          <td className={'py-1.5 pr-2 text-right font-mono ' + ((p.overUnder ?? 0) < 0 ? 'text-red-300' : 'text-teal')}>{p.overUnder === null ? '—' : money(p.overUnder)}</td>
                        </>}
                        {canManage && <td className="py-1.5 text-right whitespace-nowrap">
                          <button type="button" aria-label="Edit" onClick={() => setForm(toForm(it))} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" aria-label="Remove" onClick={() => { if (window.confirm(`Remove ${it.name}? Its logged quantities go with it.`)) void run('del', () => deleteItemAction(zone.id, it.id), 'Couldn’t remove it — try again.') }} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {form && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-navy-700 bg-navy-900 p-2">
              <input className={box + ' col-span-2'} placeholder="Item (e.g. 15&quot; RCP)" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={box} placeholder="Cost code" value={form.code} maxLength={40} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              <select className={box} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as ProdUnit })}>{PROD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              <label className="space-y-0.5"><span className="block text-[11px] text-faint">Bid quantity</span><input inputMode="decimal" className={box + ' w-full'} value={form.budgetQty} onChange={(e) => setForm({ ...form, budgetQty: e.target.value })} /></label>
              <label className="space-y-0.5"><span className="block text-[11px] text-faint">Bid per crew-day</span><input inputMode="decimal" className={box + ' w-full'} value={form.bidPerDay} onChange={(e) => setForm({ ...form, bidPerDay: e.target.value })} /></label>
              {canCosts && <label className="space-y-0.5"><span className="block text-[11px] text-faint">Bid direct $ / unit</span><input inputMode="decimal" className={box + ' w-full'} value={form.bidUnitCost} onChange={(e) => setForm({ ...form, bidUnitCost: e.target.value })} /></label>}
              <label className="space-y-0.5"><span className="block text-[11px] text-faint">Crew</span><input className={box + ' w-full'} value={form.crew} maxLength={80} onChange={(e) => setForm({ ...form, crew: e.target.value })} /></label>
              <div className="col-span-2 sm:col-span-4 flex gap-2">
                <button type="button" disabled={!!busy} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50" onClick={() => void run('item', () => saveItemAction(zone.id, {
                  code: form.code, name: form.name, unit: form.unit, budgetQty: form.budgetQty, bidPerDay: form.bidPerDay, crew: form.crew,
                  ...(canCosts ? { bidUnitCost: form.bidUnitCost } : {}),
                }, form.id), 'Couldn’t save — try again.', () => setForm(null))}>{busy === 'item' ? 'Saving…' : 'Save item'}</button>
                <button type="button" className={btn} onClick={() => setForm(null)}>Cancel</button>
              </div>
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-1">
            <h2 className="text-ink font-semibold text-[14px]">Recent days</h2>
            <div className="divide-y divide-navy-800">
              {recent.map((r) => (
                <button key={r.day} type="button" onClick={() => { setDay(r.day); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="flex w-full items-center gap-2 py-1.5 text-left hover:text-ink">
                  <span className="w-28 text-ink">{fmtDay(r.day)}</span>
                  <span className="flex-1 text-muted">{r.items} item{r.items === 1 ? '' : 's'} logged</span>
                  <span className="text-faint">{r.hrs ? `${num(r.hrs.laborHrs, 0)} crew-h · ${num(r.hrs.equipHrs, 0)} machine-h` : 'no hours on site'}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function toForm(it: ProdItem): ItemForm {
  return { id: it.id, code: it.code ?? '', name: it.name, unit: it.unit, budgetQty: String(it.budgetQty), bidPerDay: it.bidPerDay === null ? '' : String(it.bidPerDay), bidUnitCost: it.bidUnitCost === null ? '' : String(it.bidUnitCost), crew: it.crew ?? '' }
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' | 'good' }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900/60 px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wider text-faint">{label}</p>
      <p className={'font-mono text-[17px] ' + (tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber' : tone === 'good' ? 'text-teal' : 'text-ink')}>{value}</p>
      {sub && <p className="text-faint text-[11px] truncate">{sub}</p>}
    </div>
  )
}
