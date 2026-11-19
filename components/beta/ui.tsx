'use client'

/**
 * The Beta section's shared pieces: the page frame (title, BETA chip, back to
 * the hub, the one-line "what this is"), and the record editor every register
 * uses — built from the kind's schema in lib/beta/registers.ts, so the form
 * and the server's validation can't drift apart.
 */
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Check, FlaskConical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { KINDS, cleanRecord, type BetaKind, type Field } from '@/lib/beta/registers'
import { deleteBetaRecordAction, saveBetaRecordAction } from '@/lib/actions/beta'
import type { BetaRecord } from '@/lib/db/beta'

export const box = 'rounded-lg border border-navy-700 bg-navy-950 px-2 py-2 text-ink outline-none text-[14px] w-full min-w-0'
export const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'
export const primary = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber px-4 py-2.5 font-semibold text-navy-950 disabled:opacity-50 text-[14px]'
export const card = 'rounded-xl border border-navy-800 bg-navy-900/60 p-3'
export const fmtDay = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—')
export const money = (n: number | null | undefined, cents = false) => (n === null || n === undefined ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`)

export function BetaChip() {
  return <span className="rounded-md border border-violet-400/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-violet-200">Beta</span>
}

export function BetaPage({ title, icon, blurb, children, demo, back = true }: { title: string; icon?: ReactNode; blurb: ReactNode; children: ReactNode; demo?: boolean; back?: boolean }) {
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4 text-[13px]">
        {back && <Link href="/beta" className="inline-flex items-center gap-1 text-faint hover:text-ink text-[12px]"><ArrowLeft className="h-3.5 w-3.5" /> Beta</Link>}
        <div>
          <h1 className="font-display font-bold text-xl text-ink flex flex-wrap items-center gap-2">{icon ?? <FlaskConical className="h-5 w-5 text-violet-300" />} {title} <BetaChip /></h1>
          <p className="text-faint mt-1">{blurb}</p>
        </div>
        {demo && <Notice tone="info">Demo mode — sign in to use this with your own company.</Notice>}
        {children}
      </div>
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const cls = tone === 'bad' ? 'border-red-400/40 bg-red-950/30 text-red-200' : tone === 'warn' ? 'border-amber/40 bg-amber/5 text-amber' : tone === 'good' ? 'border-teal/40 bg-teal/5 text-teal' : 'border-navy-700 bg-navy-900/60 text-muted'
  const Icon = tone === 'bad' || tone === 'warn' ? AlertTriangle : tone === 'good' ? Check : FlaskConical
  return <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${cls}`}><Icon className="h-4 w-4 mt-0.5 flex-none" /><div className="min-w-0">{children}</div></div>
}

/** A colored pill for a due / deadline state. */
export function StatePill({ state, children }: { state: 'overdue' | 'urgent' | 'soon' | 'ok' | 'done' | 'moving' | 'waiting' | 'bad' | 'none' | null; children: ReactNode }) {
  const cls = state === 'overdue' || state === 'bad' ? 'bg-red-500/15 text-red-200 border-red-400/40'
    : state === 'urgent' ? 'bg-orange-500/15 text-orange-200 border-orange-400/40'
    : state === 'soon' ? 'bg-amber/10 text-amber border-amber/40'
    : state === 'ok' || state === 'done' ? 'bg-teal/10 text-teal border-teal/40'
    : 'bg-navy-800 text-muted border-navy-700'
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${cls}`}>{children}</span>
}

type Opt = { id: string; name: string }

/**
 * Add / edit a record of a kind. `fixed` pins a link (e.g. the site the page
 * is filtered to); the pickers offer the rest.
 */
export function RecordEditor({ kind, record, sites = [], assets = [], people = [], fixed = {}, withMoney, onDone, defaults = {}, label, derive }: {
  kind: BetaKind
  record?: BetaRecord | null
  sites?: Opt[]; assets?: Opt[]; people?: Opt[]
  fixed?: { siteId?: string; assetId?: string; personId?: string }
  withMoney: boolean
  onDone: () => void
  defaults?: Record<string, unknown>
  label?: string
  /** Fill dependent fields when one changes (e.g. the SC dates from the call date). */
  derive?: (vals: Record<string, unknown>, changed: string) => Record<string, unknown>
}) {
  const router = useRouter()
  const def = KINDS[kind]
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...defaults, ...(record?.data ?? {}) }))
  const [siteId, setSite] = useState(fixed.siteId ?? record?.siteId ?? '')
  const [assetId, setAsset] = useState(fixed.assetId ?? record?.assetId ?? '')
  const [personId, setPerson] = useState(fixed.personId ?? record?.personId ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fields = def.fields.filter((f) => withMoney || !f.money)

  async function save() {
    setErr(null)
    // the same validation the server runs — a refusal shows before the trip
    const local = cleanRecord(kind, Object.fromEntries(fields.map((f) => [f.key, vals[f.key]])), {}, withMoney)
    if (!local.ok) { setErr(local.error); return }
    if (def.links.site === 'required' && !siteId) { setErr('Pick the site.'); return }
    if (def.links.asset === 'required' && !assetId) { setErr('Pick the machine.'); return }
    if (def.links.person === 'required' && !personId) { setErr('Pick the person.'); return }
    setBusy(true)
    const r = await saveBetaRecordAction({ kind, id: record?.id, siteId, assetId, personId, data: Object.fromEntries(fields.map((f) => [f.key, vals[f.key]])) }).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || 'Couldn’t save — check your signal and try again.'); return }
    router.refresh()
    onDone()
  }

  const picker = (which: 'site' | 'asset' | 'person', list: Opt[], value: string, set: (v: string) => void, lbl: string) => {
    const need = def.links[which]
    if (!need) return null
    if ((which === 'site' && fixed.siteId) || (which === 'asset' && fixed.assetId) || (which === 'person' && fixed.personId)) return null
    return (
      <label className="block min-w-0">
        <span className="text-faint text-[12px]">{lbl}{need === 'required' ? '' : ' (optional)'}</span>
        <select className={box} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">{need === 'required' ? 'Pick one…' : '—'}</option>
          {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
    )
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-ink">{label ?? (record ? `Edit ${def.noun}` : `New ${def.noun}`)}</p>
        <button type="button" onClick={onDone} className="text-faint hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {picker('site', sites, siteId, setSite, 'Site')}
        {picker('asset', assets, assetId, setAsset, kind === 'haul_ticket' ? 'Our truck' : kind === 'rental' ? 'Tracked as (if it wears a tracker)' : 'Machine')}
        {picker('person', people, personId, setPerson, 'Person')}
        {fields.map((f) => <FieldInput key={f.key} f={f} value={vals[f.key]} onChange={(v) => setVals((s) => { const next = { ...s, [f.key]: v }; return derive ? derive(next, f.key) : next })} />)}
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className={btn} onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

function FieldInput({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const wide = f.type === 'textarea' ? 'sm:col-span-2' : ''
  const v = value === undefined || value === null ? '' : String(value)
  return (
    <label className={`block min-w-0 ${wide}`}>
      {f.type !== 'bool' && <span className="text-faint text-[12px]">{f.label}{f.required ? '' : ''}</span>}
      {f.type === 'textarea' ? <textarea className={box} rows={3} value={v} maxLength={f.len} onChange={(e) => onChange(e.target.value)} />
        : f.type === 'select' ? (
          <select className={box} value={v} onChange={(e) => onChange(e.target.value)}>
            <option value="">{f.required ? 'Pick one…' : '—'}</option>
            {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : f.type === 'bool' ? (
          <span className="flex items-center gap-2 py-2 text-ink"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-amber" /> {f.label}</span>
        ) : f.type === 'date' ? <input type="date" className={box} value={v} onChange={(e) => onChange(e.target.value)} />
        : f.type === 'number' || f.type === 'money' ? <input inputMode="decimal" className={box} value={v} placeholder={f.type === 'money' ? '$' : ''} onChange={(e) => onChange(e.target.value)} />
        : <input className={box} value={v} maxLength={f.len} onChange={(e) => onChange(e.target.value)} />}
      {f.hint && <span className="block text-faint text-[11px] mt-0.5">{f.hint}</span>}
    </label>
  )
}

/** The small edit / remove buttons on a record row. */
export function RowActions({ onEdit, id, canRemove }: { onEdit?: () => void; id: string; canRemove: boolean }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <span className="flex items-center gap-1">
      {onEdit && <button type="button" className={btn} onClick={onEdit} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>}
      {canRemove && (confirm ? (
        <>
          <button type="button" className={btn + ' text-red-200'} disabled={busy} onClick={async () => { setBusy(true); const r = await deleteBetaRecordAction({ id }).catch(() => null); setBusy(false); if (r?.ok) router.refresh(); setConfirm(false) }}>Remove</button>
          <button type="button" className={btn} onClick={() => setConfirm(false)}>Keep</button>
        </>
      ) : <button type="button" className={btn} onClick={() => setConfirm(true)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>)}
    </span>
  )
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" className={primary} onClick={onClick}><Plus className="h-4 w-4" /> {children}</button>
}

/**
 * Hand a finished file to the person: a download in a browser; in the app
 * (no download door in the WebView) it goes up as a private export link and
 * opens — the pay-app path. Returns an error sentence or null.
 */
export async function deliverDoc(blob: Blob, name: string, kind: 'pdf' | 'xlsx', title: string): Promise<string | null> {
  const { isNativeApp } = await import('@/lib/native')
  if (isNativeApp()) {
    const { publishExport } = await import('@/lib/export-upload')
    const r = await publishExport(blob, name, kind, title)
    if (!r.ok) return r.error
    window.location.href = r.link.fileUrl
    return null
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return null
}

export async function xlsxBlob(sheets: { name: string; rows: (string | number | null)[][] }[]): Promise<Blob> {
  const { buildXlsx } = await import('@/lib/xlsx')
  return new Blob([buildXlsx(sheets) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file'
