'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PricingNav } from './PricingNav'
import { ArrowLeft, Camera, FileText, Keyboard, Loader2, Plus, Receipt, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import type { InvoiceRow, InvoiceSite } from '@/lib/db/invoices'
import {
  AP_BUCKETS, INVOICE_UNITS, apAging, cleanDraft, daysLate, invoiceChecks, lineAmount, matchMaterial, owedOn, paidUnitCost,
  type InvoiceDraft, type Match,
} from '@/lib/pricing/invoice'
import {
  chargeInvoiceAction, deleteInvoiceAction, fileInvoiceAction, invoiceFileUrlAction, markInvoicePaidAction,
  readInvoiceAction, startInvoiceUploadAction,
} from '@/lib/actions/invoices'
import { PLACE_KIND_META } from '@/components/map/PlaceSheet'

export interface InvoiceMaterial { id: string; name: string; unit: string }
export interface InvoiceSource { id: string; name: string; kind: string }

const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const unitMoney = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const fmtDay = (d: string | null) => {
  if (!d) return '—'
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const todayLocal = () => new Date().toLocaleDateString('en-CA')
const input = 'rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-ink text-[12.5px] min-w-0'
const NO_REPLY = 'No answer from the server — check the connection and try again.'
const NEW = '__new'
const SOURCE_KINDS = ['supplier', 'quarry', 'asphalt', 'concrete', 'borrow', 'landfill', 'dump'] as const
const kindLabel = (k: string) => (PLACE_KIND_META as Record<string, { label: string; emoji: string }>)[k] ?? { label: k, emoji: '📍' }

/**
 * Supplier invoices (migration 165): the real cost of stone, asphalt and
 * concrete is on what the quarry and the plant bill. Upload the PDF or take
 * a photo → it is read → you check it line by line → filing it dates the
 * cost book's prices for that source and, with a site, charges the job's
 * material cost. The list doubles as accounts payable: due, paid, late.
 */
export function InvoicesView({ invoices, materials, sources, sites, canEdit, canManage, demo }: {
  invoices: InvoiceRow[]
  materials: InvoiceMaterial[]
  sources: InvoiceSource[]
  sites: InvoiceSite[]
  canEdit: boolean
  canManage: boolean
  demo: boolean
}) {
  const [review, setReview] = useState<{ form: Form; filePath: string | null; fileName: string | null; byAi: boolean; note: string | null } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const today = todayLocal()
  const ap = useMemo(() => apAging(invoices, today), [invoices, today])
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href="/costbook" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Cost book</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Receipt className="h-5 w-5 text-amber" /> Supplier invoices</h1>
          <p className="text-[12.5px] text-faint">What the quarry, the plant and the supplier actually billed — tons, $/ton, freight and fuel. Filing one dates the cost book’s price for that source and can charge the job.</p>
        </div>
        <PricingNav at="invoices" />
        {demo && <p className="text-sm text-faint">Demo invoices — sign in to a real company to read and file your own.</p>}

        <ApStrip ap={ap} />

        {done && <p className="text-[12.5px] text-teal rounded-xl border border-teal/30 bg-teal/5 px-3 py-2">{done}</p>}
        {canEdit && !review && (
          <AddInvoice
            materials={materials} sources={sources}
            onReview={(r) => { setDone(null); setReview(r) }}
          />
        )}
        {review && (
          <Review
            key={review.filePath ?? 'typed'}
            initial={review.form} filePath={review.filePath} fileName={review.fileName} byAi={review.byAi} readNote={review.note}
            materials={materials} sources={sources} sites={sites}
            onCancel={() => setReview(null)}
            onFiled={(msg) => { setReview(null); setDone(msg) }}
          />
        )}

        <InvoiceList invoices={invoices} sources={sources} sites={sites} canEdit={canEdit} canManage={canManage} demo={demo} today={today} />
      </div>
    </div>
  )
}

// ── AP summary ──────────────────────────────────────────────────────────────

function ApStrip({ ap }: { ap: ReturnType<typeof apAging> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
      <Stat label="Unpaid" value={money(ap.open)} sub={`${ap.openCount} invoice${ap.openCount === 1 ? '' : 's'}`} />
      <Stat label="Past due" value={money(ap.pastDue)} tone={ap.pastDue > 0 ? 'text-red-400' : undefined}
        sub={AP_BUCKETS.filter((b) => b.key !== 'current' && ap.buckets[b.key] > 0).map((b) => `${b.label}: ${money(ap.buckets[b.key])}`).join(' · ') || 'Nothing late'} />
      <Stat label="Due this week" value={money(ap.dueThisWeek)} tone={ap.dueThisWeek > 0 ? 'text-amber' : undefined} />
      <Stat label="Current" value={money(ap.buckets.current)} sub="not yet due" />
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 px-3 py-2 min-w-0">
      <div className="text-faint text-[11px] uppercase tracking-wide">{label}</div>
      <div className={'font-mono text-[15px] ' + (tone ?? 'text-ink')}>{value}</div>
      {sub && <div className="text-faint text-[11px] truncate" title={sub}>{sub}</div>}
    </div>
  )
}

// ── The form (strings while typing; cleaned into a draft for every number shown) ──

interface FormLine { description: string; materialId: string; newName: string; qty: string; unit: string; unitPrice: string; amount: string; ticket: string; match: Match | null }
interface Form {
  vendorName: string; invoiceNo: string; invoiceOn: string; dueOn: string
  freight: string; fuel: string; tax: string; total: string; delivered: boolean
  placeId: string; newKind: string; newLatLng: string
  zoneId: string
  lines: FormLine[]
}

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const blankLine = (): FormLine => ({ description: '', materialId: '', newName: '', qty: '', unit: 'TON', unitPrice: '', amount: '', ticket: '', match: null })
const blankForm = (): Form => ({ vendorName: '', invoiceNo: '', invoiceOn: todayLocal(), dueOn: '', freight: '', fuel: '', tax: '', total: '', delivered: false, placeId: '', newKind: 'supplier', newLatLng: '', zoneId: '', lines: [blankLine()] })

function formFrom(d: InvoiceDraft, matches: (Match | null)[]): Form {
  return {
    vendorName: d.vendorName, invoiceNo: d.invoiceNo ?? '', invoiceOn: d.invoiceOn ?? '', dueOn: d.dueOn ?? '',
    freight: s(d.freight), fuel: s(d.fuel), tax: s(d.tax), total: s(d.total), delivered: d.delivered,
    placeId: d.placeId ?? '', newKind: 'supplier', newLatLng: '', zoneId: d.zoneId ?? '',
    lines: d.lines.length ? d.lines.map((l, i) => ({
      description: l.description, materialId: l.materialId ?? '', newName: '', qty: s(l.qty), unit: l.unit ?? '', unitPrice: s(l.unitPrice),
      amount: s(l.amount), ticket: l.ticket ?? '', match: matches[i] ?? null,
    })) : [blankLine()],
  }
}

function draftFrom(f: Form): InvoiceDraft {
  return cleanDraft({
    vendorName: f.vendorName, invoiceNo: f.invoiceNo, invoiceOn: f.invoiceOn, dueOn: f.dueOn,
    freight: f.freight, fuel: f.fuel, tax: f.tax, total: f.total, delivered: f.delivered,
    placeId: f.placeId === NEW ? null : f.placeId, zoneId: f.zoneId,
    lines: f.lines.map((l) => ({ description: l.description, materialId: l.materialId === NEW ? null : l.materialId, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount, ticket: l.ticket })),
  })
}

const numText = (v: string) => v.replace(/[^0-9.\-]/g, '')

// ── Add an invoice ──────────────────────────────────────────────────────────

/** Photos shrink to ≤ 2200 px JPEG before upload (the reader takes ≤ 5 MB, and phones shoot 12 MP). */
async function shrinkPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height))
    if (k === 1 && file.size < 3_000_000) { bmp.close(); return file }
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85))
    return out ?? file
  } catch {
    return file
  }
}

function AddInvoice({ materials, sources, onReview }: {
  materials: InvoiceMaterial[]
  sources: InvoiceSource[]
  onReview: (r: { form: Form; filePath: string | null; fileName: string | null; byAi: boolean; note: string | null }) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setErr(null)
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    setBusy('Uploading…')
    try {
      const body = isPdf ? file : await shrinkPhoto(file)
      const mime = isPdf ? 'application/pdf' : (body.type || file.type || 'image/jpeg')
      const st = await startInvoiceUploadAction({ filename: file.name, size: body.size, mime }).catch(() => null)
      if (!st?.ok) { setErr(st && !st.ok ? st.error : NO_REPLY); return }
      const up = await createClient().storage.from('invoices').uploadToSignedUrl(st.path, st.token, body, { contentType: mime }).catch(() => null)
      if (!up || up.error) { setErr('The upload didn’t finish — try again.'); return }
      setBusy('Reading the invoice…')
      const r = await readInvoiceAction({ path: st.path }).catch(() => null)
      if (!r?.ok) {
        // The file is up: keep it with a blank form to type in.
        const why = r && !r.ok ? r.error : NO_REPLY
        if (r && !r.ok && r.typeIt) { onReview({ form: blankForm(), filePath: st.path, fileName: file.name, byAi: false, note: why }); return }
        setErr(why)
        return
      }
      const form = formFrom(r.draft, r.lineMatches)
      const extra = r.vendorMatch ? `Vendor matched to ${r.vendorMatch.name}.` : r.draft.vendorName ? 'The vendor matches no source yet — pick one or add it.' : null
      onReview({ form, filePath: st.path, fileName: file.name, byAi: true, note: extra })
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
      if (camRef.current) camRef.current.value = ''
    }
  }

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2 text-[12.5px]">
      <div className="font-semibold text-ink">Add an invoice</div>
      <p className="text-faint">A PDF from the plant’s email, or a photo of the paper ticket. It is read for you — every number stays yours to check before anything is filed.</p>
      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-3 py-2 disabled:opacity-50"><FileText className="h-4 w-4" /> Upload PDF or photo</button>
        <button type="button" disabled={!!busy} onClick={() => camRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-teal/50 text-teal px-3 py-2 disabled:opacity-50 md:hidden"><Camera className="h-4 w-4" /> Take a photo</button>
        <button type="button" disabled={!!busy} onClick={() => onReview({ form: blankForm(), filePath: null, fileName: null, byAi: false, note: null })} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 text-muted hover:text-ink px-3 py-2 disabled:opacity-50"><Keyboard className="h-4 w-4" /> Type it in</button>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {busy && <p className="text-muted inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</p>}
      {err && <p className="text-red-400">{err}</p>}
      {materials.length === 0 && sources.length === 0 && <p className="text-faint">Tip: the cost book has no materials or sources yet — the first invoice you file can add them.</p>}
    </section>
  )
}

// ── Review ──────────────────────────────────────────────────────────────────

function Review({ initial, filePath, fileName, byAi, readNote, materials, sources, sites, onCancel, onFiled }: {
  initial: Form
  filePath: string | null
  fileName: string | null
  byAi: boolean
  readNote: string | null
  materials: InvoiceMaterial[]
  sources: InvoiceSource[]
  sites: InvoiceSite[]
  onCancel: () => void
  onFiled: (msg: string) => void
}) {
  const router = useRouter()
  const [f, setF] = useState<Form>(initial)
  const [updatePrices, setUpdatePrices] = useState(true)
  const [chargeJob, setChargeJob] = useState(() => !!sites.find((x) => x.id === initial.zoneId)?.hasJob)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const draft = useMemo(() => draftFrom(f), [f])
  const checks = useMemo(() => invoiceChecks(draft), [draft])
  const site = sites.find((x) => x.id === f.zoneId) ?? null

  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }))
  const setLine = (i: number, patch: Partial<FormLine>) => setF((cur) => ({ ...cur, lines: cur.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }))

  function locate() {
    if (!navigator.geolocation) { setErr('This device can’t give its location — type the lat, lng.'); return }
    navigator.geolocation.getCurrentPosition(
      (p) => set({ newLatLng: `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}` }),
      () => setErr('Location is off for this app — type the lat, lng instead.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  async function file() {
    setErr(null)
    let newSource: { name: string; kind: string; lat: number; lng: number } | null = null
    if (f.placeId === NEW) {
      const m = f.newLatLng.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
      if (!m) { setErr('A new source needs its location: “Use this phone’s location” at the plant, or type lat, lng.'); return }
      newSource = { name: f.vendorName, kind: f.newKind, lat: Number(m[1]), lng: Number(m[2]) }
    }
    const newMaterials = f.lines.flatMap((l, i) => (l.materialId === NEW ? [{ line: i, name: (l.newName || l.description).slice(0, 80) }] : []))
    if (newMaterials.some((m) => !m.name.trim())) { setErr('Name each new material.'); return }
    setBusy(true)
    const r = await fileInvoiceAction(draft, {
      filePath, fileName, readByAi: byAi, updatePrices, chargeJob: chargeJob && !!site?.hasJob, newSource, newMaterials,
    }).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : NO_REPLY); return }
    const bits = [`Filed ${draft.vendorName}${draft.invoiceNo ? ` #${draft.invoiceNo}` : ''}.`]
    if (r.prices) bits.push(`${r.prices} cost-book price${r.prices === 1 ? '' : 's'} dated ${fmtDay(draft.invoiceOn)}.`)
    if (r.charged) bits.push(`${r.charged} cost${r.charged === 1 ? '' : 's'} charged to ${site?.name ?? 'the job'}.`)
    bits.push(...r.warnings)
    onFiled(bits.join(' '))
    router.refresh()
  }

  const sum = draft.lines.reduce((t, l) => t + (lineAmount(l) ?? 0), 0)
  return (
    <section className="rounded-xl border border-amber/40 bg-navy-900 p-3 space-y-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <div className="font-semibold text-ink flex-1 min-w-0 truncate">Check the invoice{fileName ? ` · ${fileName}` : ''}</div>
        <button type="button" aria-label="Cancel" onClick={onCancel} className="rounded p-1 text-faint hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      {readNote && <p className="text-muted">{readNote}</p>}
      {byAi && <p className="text-faint">Read from the file — check each number against the paper. Anything that couldn’t be read is left blank.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-faint">Vendor<input value={f.vendorName} onChange={(e) => set({ vendorName: e.target.value.slice(0, 120) })} className={input} /></label>
        <label className="flex flex-col gap-1 text-faint">Invoice no.<input value={f.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value.slice(0, 60) })} className={input} /></label>
        <label className="flex flex-col gap-1 text-faint">Invoice date<input type="date" value={f.invoiceOn} onChange={(e) => set({ invoiceOn: e.target.value })} className={input} /></label>
        <label className="flex flex-col gap-1 text-faint">Due<input type="date" value={f.dueOn} onChange={(e) => set({ dueOn: e.target.value })} className={input} /></label>
      </div>

      <div className="space-y-1">
        <label className="flex flex-col gap-1 text-faint">Source (where it came from)
          <select value={f.placeId} onChange={(e) => set({ placeId: e.target.value })} className={input}>
            <option value="">— none (don’t date prices) —</option>
            {sources.map((x) => <option key={x.id} value={x.id}>{kindLabel(x.kind).emoji} {x.name}</option>)}
            <option value={NEW}>+ New source: {f.vendorName || 'this vendor'}</option>
          </select>
        </label>
        {f.placeId === NEW && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-navy-700 p-2">
            <select value={f.newKind} onChange={(e) => set({ newKind: e.target.value })} aria-label="Kind of source" className={input}>
              {SOURCE_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k).label}</option>)}
            </select>
            <input value={f.newLatLng} onChange={(e) => set({ newLatLng: e.target.value.slice(0, 60) })} placeholder="lat, lng of the plant" aria-label="Location" className={input + ' flex-1 min-w-[9rem]'} />
            <button type="button" onClick={locate} className="rounded-lg border border-navy-700 px-2 py-1.5 text-muted hover:text-ink">Use this phone’s location</button>
            <p className="w-full text-faint">The estimate measures the road from the plant to each site, so a source needs its real location — or drop its pin on the <Link href="/map" className="underline">map</Link> first.</p>
          </div>
        )}
        <label className="flex flex-col gap-1 text-faint">Site it was for
          <select value={f.zoneId} onChange={(e) => { set({ zoneId: e.target.value }); setChargeJob(!!sites.find((x) => x.id === e.target.value)?.hasJob) }} className={input}>
            <option value="">— no site —</option>
            {sites.map((x) => <option key={x.id} value={x.id}>{x.name}{x.hasJob ? '' : ' (no job)'}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-faint uppercase tracking-wide text-[11px]">Lines</div>
        {f.lines.map((l, i) => {
          const dl = draft.lines[i]
          const allIn = dl ? paidUnitCost(dl, draft) : null
          const lineWarn = checks.filter((c) => c.line === i + 1)
          const suggest = l.description && !l.materialId ? matchMaterial(l.description, materials) : null
          return (
            <div key={i} className="rounded-lg border border-navy-800 bg-navy-950/40 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value.slice(0, 200) })} placeholder="As printed (#57 STONE)" aria-label={`Line ${i + 1} description`} className={input + ' flex-1'} />
                <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => set({ lines: f.lines.filter((_, k) => k !== i) })} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select value={l.materialId} onChange={(e) => setLine(i, { materialId: e.target.value })} aria-label={`Line ${i + 1} material`} className={input + ' flex-1 min-w-[9rem]'}>
                  <option value="">— not in the book —</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  <option value={NEW}>+ New material…</option>
                </select>
                {l.match && l.materialId === l.match.id && <span className="text-faint text-[11px]">matched</span>}
                {suggest && <button type="button" onClick={() => setLine(i, { materialId: suggest.id })} className="text-teal text-[11.5px] underline">{suggest.name}?</button>}
              </div>
              {l.materialId === NEW && (
                <input value={l.newName} onChange={(e) => setLine(i, { newName: e.target.value.slice(0, 80) })} placeholder={l.description || 'Material name'} aria-label={`Line ${i + 1} new material name`} className={input + ' w-full'} />
              )}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                <label className="flex flex-col text-faint text-[11px]">Qty<input value={l.qty} onChange={(e) => setLine(i, { qty: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
                <label className="flex flex-col text-faint text-[11px]">Unit
                  <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} className={input}>
                    <option value="">—</option>
                    {INVOICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label className="flex flex-col text-faint text-[11px]">$ / unit<input value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
                <label className="flex flex-col text-faint text-[11px]">Amount<input value={l.amount} onChange={(e) => setLine(i, { amount: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
                <label className="flex flex-col text-faint text-[11px] col-span-2 sm:col-span-1">Ticket<input value={l.ticket} onChange={(e) => setLine(i, { ticket: e.target.value.slice(0, 40) })} className={input} /></label>
              </div>
              <div className="text-faint text-[11.5px]">
                All-in delivered: <span className="font-mono text-ink">{allIn === null ? '—' : `${unitMoney(allIn)} / ${dl?.unit ?? 'unit'}`}</span>
                {(draft.freight || draft.fuel) ? <span> (with its share of freight + fuel)</span> : null}
              </div>
              {lineWarn.map((c, k) => <p key={k} className="text-amber text-[11.5px]">{c.text}</p>)}
            </div>
          )
        })}
        {f.lines.length < 200 && (
          <button type="button" onClick={() => set({ lines: [...f.lines, blankLine()] })} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /> Line</button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1 text-faint">Freight<input value={f.freight} onChange={(e) => set({ freight: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
        <label className="flex flex-col gap-1 text-faint">Fuel surcharge<input value={f.fuel} onChange={(e) => set({ fuel: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
        <label className="flex flex-col gap-1 text-faint">Tax<input value={f.tax} onChange={(e) => set({ tax: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
        <label className="flex flex-col gap-1 text-faint">Total<input value={f.total} onChange={(e) => set({ total: numText(e.target.value) })} inputMode="decimal" className={input} /></label>
      </div>
      <p className="text-faint">Lines add to <span className="font-mono text-ink">{money(sum)}</span>.</p>
      <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={f.delivered} onChange={(e) => set({ delivered: e.target.checked })} /> Prices are delivered (no separate freight)</label>

      {checks.filter((c) => c.line === null).map((c, k) => <p key={k} className="text-amber">{c.text}</p>)}

      <div className="space-y-1.5 border-t border-navy-800 pt-2">
        <label className="flex items-start gap-2 text-muted"><input type="checkbox" className="mt-0.5" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} />
          <span>Update the cost book prices{f.placeId && f.placeId !== NEW ? '' : ' (pick or add the source)'} — dated {fmtDay(draft.invoiceOn)}</span></label>
        <label className={'flex items-start gap-2 ' + (site?.hasJob ? 'text-muted' : 'text-faint')}><input type="checkbox" className="mt-0.5" disabled={!site?.hasJob} checked={chargeJob && !!site?.hasJob} onChange={(e) => setChargeJob(e.target.checked)} />
          <span>Charge to the job’s cost{site ? (site.hasJob ? ` — ${site.name}, as material` : ` — ${site.name} has no job yet`) : ' (pick the site)'}</span></label>
      </div>
      {err && <p className="text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void file()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} File it</button>
        <button type="button" onClick={onCancel} className="text-faint hover:text-ink">Cancel</button>
      </div>
    </section>
  )
}

// ── The list ────────────────────────────────────────────────────────────────

function DuePill({ inv, today }: { inv: InvoiceRow; today: string }) {
  const owed = owedOn(inv)
  if (inv.paidOn && owed <= 0) return <span className="rounded-full px-2 py-0.5 text-[11px] bg-teal/15 text-teal whitespace-nowrap">Paid {fmtDay(inv.paidOn)}</span>
  const late = daysLate(inv, today)
  if (late !== null && late > 0) return <span className="rounded-full px-2 py-0.5 text-[11px] bg-red-500/15 text-red-400 whitespace-nowrap">{late} day{late === 1 ? '' : 's'} late</span>
  if (late !== null && late >= -7) return <span className="rounded-full px-2 py-0.5 text-[11px] bg-amber/15 text-amber whitespace-nowrap">{late === 0 ? 'Due today' : `Due in ${-late}d`}</span>
  return <span className="rounded-full px-2 py-0.5 text-[11px] border border-navy-700 text-faint whitespace-nowrap">{inv.dueOn ? `Due ${fmtDay(inv.dueOn)}` : 'Unpaid'}</span>
}

function InvoiceList({ invoices, sources, sites, canEdit, canManage, demo, today }: {
  invoices: InvoiceRow[]; sources: InvoiceSource[]; sites: InvoiceSite[]; canEdit: boolean; canManage: boolean; demo: boolean; today: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'late'>('all')
  const siteName = useMemo(() => new Map(sites.map((x) => [x.id, x])), [sites])
  const sourceName = useMemo(() => new Map(sources.map((x) => [x.id, x.name])), [sources])
  const shown = invoices.filter((i) => filter === 'all' || (owedOn(i) > 0 && (filter === 'unpaid' || (daysLate(i, today) ?? 0) > 0)))
  return (
    <section className="space-y-2 text-[12.5px]">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold text-ink flex-1">Invoices ({invoices.length})</div>
        {(['all', 'unpaid', 'late'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (filter === k ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>
            {k === 'all' ? 'All' : k === 'unpaid' ? 'Unpaid' : 'Late'}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">{invoices.length ? 'Nothing here.' : 'No invoices yet — upload the first one above.'}</p>
      ) : (
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
          {shown.map((inv) => (
            <div key={inv.id}>
              <button type="button" onClick={() => setOpen(open === inv.id ? null : inv.id)} className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-navy-800/40">
                <span className="flex-1 min-w-0">
                  <span className="block text-ink truncate">{inv.vendorName}{inv.invoiceNo ? <span className="text-faint"> · #{inv.invoiceNo}</span> : null}</span>
                  <span className="block text-faint truncate">{fmtDay(inv.invoiceOn)}{inv.zoneId ? ` · ${siteName.get(inv.zoneId)?.name ?? 'site'}` : ''}{inv.charged ? ' · on job cost' : ''}</span>
                </span>
                <span className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="font-mono text-ink whitespace-nowrap">{inv.total === null ? '—' : money(inv.total)}</span>
                  <DuePill inv={inv} today={today} />
                </span>
              </button>
              {open === inv.id && (
                <Detail inv={inv} site={inv.zoneId ? siteName.get(inv.zoneId) ?? null : null} sourceName={inv.placeId ? sourceName.get(inv.placeId) ?? null : null}
                  canEdit={canEdit && !demo} canManage={canManage && !demo} onGone={() => setOpen(null)} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Detail({ inv, site, sourceName, canEdit, canManage, onGone }: {
  inv: InvoiceRow; site: InvoiceSite | null; sourceName: string | null; canEdit: boolean; canManage: boolean; onGone: () => void
}) {
  const router = useRouter()
  const [paying, setPaying] = useState<{ on: string; amount: string } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const draft: InvoiceDraft = { ...inv, delivered: false }

  async function run<T extends { ok: boolean }>(p: Promise<T>, after: (r: T) => void) {
    setErr(null); setMsg(null); setBusy(true)
    const r = await p.catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr(r && !r.ok ? (r as unknown as { error: string }).error : NO_REPLY); return }
    after(r)
  }
  const openFile = () => run(invoiceFileUrlAction(inv.id), (r) => { if (r.ok) window.open(r.url, '_blank', 'noopener') })
  const pay = () => {
    if (!paying) return
    const amount = paying.amount.trim() === '' ? null : Number(paying.amount)
    if (amount !== null && !Number.isFinite(amount)) { setErr('That amount can’t be read.'); return }
    void run(markInvoicePaidAction(inv.id, { paidOn: paying.on, paidAmount: amount }), () => { setPaying(null); router.refresh() })
  }
  const unpay = () => run(markInvoicePaidAction(inv.id, { paidOn: null, paidAmount: null }), () => router.refresh())
  const remove = () => run(deleteInvoiceAction(inv.id), () => { onGone(); router.refresh() })
  const charge = () => run(chargeInvoiceAction(inv.id), (r) => { if (r.ok) setMsg(`${r.charged} cost${r.charged === 1 ? '' : 's'} charged to ${site?.name ?? 'the job'}.`); router.refresh() })

  return (
    <div className="px-3 pb-3 pt-1 space-y-2 text-[12.5px] bg-navy-950/30">
      <div className="text-faint">
        {sourceName ? `Source: ${sourceName}` : 'No source picked'}{site ? ` · Site: ${site.name}` : ''} · {inv.readBy === 'ai' ? 'read from the file' : 'typed in'}
        {inv.dueOn ? ` · due ${fmtDay(inv.dueOn)}` : ''}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[30rem]">
          <thead><tr className="text-faint text-left"><th className="py-1 pr-2 font-normal">Item</th><th className="py-1 pr-2 font-normal text-right">Qty</th><th className="py-1 pr-2 font-normal text-right">$ / unit</th><th className="py-1 pr-2 font-normal text-right">Amount</th><th className="py-1 font-normal text-right">All-in</th></tr></thead>
          <tbody>
            {inv.lines.map((l, i) => {
              const allIn = paidUnitCost(l, draft)
              return (
                <tr key={i} className="border-t border-navy-800">
                  <td className="py-1 pr-2 text-ink">{l.description || '—'}{l.ticket ? <span className="text-faint"> · tkt {l.ticket}</span> : null}</td>
                  <td className="py-1 pr-2 text-right font-mono whitespace-nowrap">{l.qty === null ? '—' : `${l.qty.toLocaleString()} ${l.unit ?? ''}`}</td>
                  <td className="py-1 pr-2 text-right font-mono whitespace-nowrap">{l.unitPrice === null ? '—' : unitMoney(l.unitPrice)}</td>
                  <td className="py-1 pr-2 text-right font-mono whitespace-nowrap">{lineAmount(l) === null ? '—' : money(lineAmount(l)!)}</td>
                  <td className="py-1 text-right font-mono whitespace-nowrap">{allIn === null ? '—' : unitMoney(allIn)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-faint">
        {inv.freight ? <span>Freight <span className="font-mono text-ink">{money(inv.freight)}</span></span> : null}
        {inv.fuel ? <span>Fuel <span className="font-mono text-ink">{money(inv.fuel)}</span></span> : null}
        {inv.tax ? <span>Tax <span className="font-mono text-ink">{money(inv.tax)}</span></span> : null}
        <span>Total <span className="font-mono text-ink">{inv.total === null ? '—' : money(inv.total)}</span></span>
        {inv.paidOn && <span>Paid <span className="font-mono text-ink">{money(inv.paidAmount ?? inv.total ?? 0)}</span> on {fmtDay(inv.paidOn)}</span>}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        {inv.hasFile && <button type="button" disabled={busy} onClick={() => void openFile()} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink"><FileText className="h-3.5 w-3.5" /> View the file</button>}
        {canEdit && !inv.paidOn && !paying && <button type="button" onClick={() => setPaying({ on: todayLocal(), amount: inv.total === null ? '' : String(inv.total) })} className="rounded-lg border border-teal/50 text-teal px-2 py-1">Mark paid</button>}
        {canEdit && inv.paidOn && <button type="button" disabled={busy} onClick={() => void unpay()} className="rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink">Mark unpaid</button>}
        {canEdit && site?.hasJob && !inv.charged && <button type="button" disabled={busy} onClick={() => void charge()} className="rounded-lg border border-navy-700 px-2 py-1 text-muted hover:text-ink">Charge to {site.name}</button>}
        {canManage && !confirm && <button type="button" onClick={() => setConfirm(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /> Remove</button>}
      </div>
      {paying && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 text-faint">Paid on <input type="date" value={paying.on} onChange={(e) => setPaying({ ...paying, on: e.target.value })} className={input} /></label>
          <label className="flex items-center gap-1 text-faint">$ <input value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: numText(e.target.value) })} inputMode="decimal" className={input + ' w-28'} /></label>
          <button type="button" disabled={busy} onClick={pay} className="rounded-lg bg-amber text-[#1a1100] font-bold px-3 py-1.5">Save</button>
          <button type="button" onClick={() => setPaying(null)} className="text-faint hover:text-ink">Cancel</button>
        </div>
      )}
      {confirm && (
        <div className="rounded-lg border border-red-500/40 p-2 space-y-1.5">
          <p className="text-muted">Remove this invoice and its file? The prices it dated stay in the cost book’s history{inv.charged ? ', and its charges stay on the job’s cost — remove those there if they should go' : ''}.</p>
          <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-red-500/80 text-white font-bold px-3 py-1.5">Remove</button><button type="button" onClick={() => setConfirm(false)} className="text-faint hover:text-ink">Keep it</button></div>
        </div>
      )}
      {msg && <p className="text-teal">{msg}</p>}
      {err && <p className="text-red-400">{err}</p>}
    </div>
  )
}
