'use client'

/**
 * The job's documents (migration 156): every paper the job collects, by type
 * — the contract, COIs, permits, submittals, RFIs, inspections, lien
 * waivers, warranties, as-builts. Files go straight to private storage and
 * open as 10-minute downloads; insurance, permits and bonds warn before they
 * run out. The money papers show only to logins that can see costs.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FolderOpen, Upload, Download, Pencil, Trash2, AlertTriangle, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import {
  costsOnly, DOC_KIND_WORDS, DOC_KINDS, EXPIRING_KINDS, expiryState, expiryWords, kindFromName, MAX_DOC_BYTES, sizeWords,
  type DocKind, type JobDocument,
} from '@/lib/jobs/documents'
import type { Member } from '@/lib/db/jobs'
import { deleteDocAction, docLinkAction, finishDocAction, saveDocAction, startDocUploadAction } from '@/lib/actions/jobdocs'

const inp = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'
const btn = 'inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-50'
const fmtDay = (d: string | null) => {
  if (!d) return ''
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

interface Meta { kind: DocKind; title: string; docDate: string; expiresOn: string; note: string; payAppId: string }
const metaOf = (d: JobDocument): Meta => ({ kind: d.kind, title: d.title, docDate: d.docDate ?? '', expiresOn: d.expiresOn ?? '', note: d.note ?? '', payAppId: d.payAppId ?? '' })

function MetaFields({ meta, set, kinds, apps }: { meta: Meta; set: (m: Meta) => void; kinds: DocKind[]; apps: { id: string; appNo: number }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label className="space-y-0.5 col-span-2"><span className="block text-[11.5px] text-faint">Type</span>
        <select className={inp} value={meta.kind} onChange={(e) => set({ ...meta, kind: e.target.value as DocKind })}>{kinds.map((k) => <option key={k} value={k}>{DOC_KIND_WORDS[k]}</option>)}</select></label>
      <label className="space-y-0.5 col-span-2"><span className="block text-[11.5px] text-faint">Title</span>
        <input className={inp} value={meta.title} onChange={(e) => set({ ...meta, title: e.target.value })} maxLength={200} /></label>
      <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Dated</span>
        <input type="date" className={inp} value={meta.docDate} onChange={(e) => set({ ...meta, docDate: e.target.value })} /></label>
      {EXPIRING_KINDS.includes(meta.kind) && (
        <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">Expires</span>
          <input type="date" className={inp} value={meta.expiresOn} onChange={(e) => set({ ...meta, expiresOn: e.target.value })} /></label>
      )}
      {(meta.kind === 'lien_waiver' || meta.kind === 'invoice') && apps.length > 0 && (
        <label className="space-y-0.5"><span className="block text-[11.5px] text-faint">For application</span>
          <select className={inp} value={meta.payAppId} onChange={(e) => set({ ...meta, payAppId: e.target.value })}><option value="">—</option>{apps.map((a) => <option key={a.id} value={a.id}>#{a.appNo}</option>)}</select></label>
      )}
      <label className="space-y-0.5 col-span-2 sm:col-span-4"><span className="block text-[11.5px] text-faint">Note</span>
        <input className={inp} value={meta.note} onChange={(e) => set({ ...meta, note: e.target.value })} maxLength={500} /></label>
    </div>
  )
}

export function DocumentsView({ zone, docs, available, apps, members, today, canEdit, canManage, canCosts, demo }: {
  zone: { id: string; name: string }; docs: JobDocument[]; available: boolean; apps: { id: string; appNo: number }[]; members: Member[]
  today: string; canEdit: boolean; canManage: boolean; canCosts: boolean; demo: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [adding, setAdding] = useState(false)
  const [meta, setMeta] = useState<Meta>({ kind: 'other', title: '', docDate: '', expiresOn: '', note: '', payAppId: '' })
  const [editing, setEditing] = useState<{ id: string; meta: Meta } | null>(null)
  const kinds = DOC_KINDS.filter((k) => canCosts || !costsOnly(k))
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? null : null)
  const groups = DOC_KINDS.map((k) => ({ kind: k, list: docs.filter((d) => d.kind === k) })).filter((g) => g.list.length)
  const warn = docs.filter((d) => { const s = expiryState(d.expiresOn, today); return s === 'expired' || s === 'soon' }).sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))

  function pick(f: File | undefined) {
    if (!f) return
    if (f.size > MAX_DOC_BYTES) { setErr('Documents go up to 50 MB.'); return }
    setErr(null); setFile(f)
    const guess = kindFromName(f.name)
    setMeta((m) => ({ ...m, kind: canCosts || !costsOnly(guess) ? guess : 'other', title: m.title || f.name.replace(/\.[a-z0-9]{1,6}$/i, '') }))
  }

  async function upload() {
    if (!file) { setErr('Pick the file first.'); return }
    setBusy('up'); setErr(null)
    try {
      const st = await startDocUploadAction({ zoneId: zone.id, filename: file.name, size: file.size }).catch(() => null)
      if (!st?.ok) { setErr(st && !st.ok ? st.error : 'Couldn’t start the upload — try again.'); return }
      const { error } = await createClient().storage.from('jobdocs').uploadToSignedUrl(st.path, st.token, file, { contentType: 'application/octet-stream' })
      if (error) { setErr('The file didn’t upload — try again.'); return }
      const fin = await finishDocAction({ zoneId: zone.id, id: st.id, filename: file.name, meta: { ...meta, docDate: meta.docDate || null, expiresOn: meta.expiresOn || null, payAppId: meta.payAppId || null } }).catch(() => null)
      if (!fin?.ok) { setErr(fin && !fin.ok ? fin.error : 'Couldn’t file it — try again.'); return }
      setFile(null); setAdding(false); setMeta({ kind: 'other', title: '', docDate: '', expiresOn: '', note: '', payAppId: '' })
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function open(d: JobDocument) {
    setBusy(`dl:${d.id}`); setErr(null)
    const r = await docLinkAction(d.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t open the document — try again.'); return }
    window.location.href = r.url
  }

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>, fail: string, after?: () => void) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || fail); return }
    after?.(); router.refresh()
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4 text-[12.5px]">
        <div>
          <Link href={`/jobs/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> The job</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><FolderOpen className="h-5 w-5 text-amber flex-none" /> <span className="truncate">Documents · {zone.name}</span></h1>
          <p className="text-faint">Every paper the job collects, by type. Plans live in the plan room, photos on the site page.{canCosts ? '' : ' Contracts, change orders, lien waivers, invoices, W-9s and bonds are for logins that can see costs.'}</p>
        </div>
        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-muted">Demo mode — sign in to file documents.</p>}
        {!available && !demo && <p className="rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-amber">Documents are being set up — try again in a minute.</p>}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        {warn.length > 0 && (
          <section className="rounded-xl border border-amber/40 bg-amber/5 p-3 space-y-1">
            {warn.map((d) => (
              <p key={d.id} className={'flex items-center gap-1.5 ' + (expiryState(d.expiresOn, today) === 'expired' ? 'text-red-300' : 'text-amber')}>
                <AlertTriangle className="h-4 w-4 flex-none" /> {d.title} — {d.expiresOn ? expiryWords(d.expiresOn, today) : ''}
              </p>
            ))}
          </section>
        )}

        {canEdit && !adding && <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950"><Upload className="h-4 w-4" /> File a document</button>}
        {adding && (
          <section className="rounded-xl border border-navy-700 bg-navy-900 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-ink font-semibold text-[14px]">File a document</h2>
              <button type="button" onClick={() => { setAdding(false); setFile(null) }} aria-label="Close" className="p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <input type="file" onChange={(e) => pick(e.target.files?.[0])} className="block w-full text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-3 file:py-1.5 file:text-ink" />
            {file && <p className="text-faint">{file.name} · {sizeWords(file.size)}</p>}
            <MetaFields meta={meta} set={setMeta} kinds={kinds} apps={apps} />
            <button type="button" disabled={!!busy || !file} onClick={() => void upload()} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy === 'up' ? 'Uploading…' : 'File it'}</button>
          </section>
        )}

        {groups.map((g) => (
          <section key={g.kind} className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-1">
            <h2 className="text-ink font-semibold text-[13.5px]">{DOC_KIND_WORDS[g.kind]} <span className="text-faint font-normal">({g.list.length})</span></h2>
            <div className="divide-y divide-navy-800">
              {g.list.map((d) => {
                const st = expiryState(d.expiresOn, today)
                return (
                  <div key={d.id} className="py-1.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-ink">{d.title}</span>
                        <span className="block truncate text-[11.5px] text-faint">{[fmtDay(d.docDate), d.filename, sizeWords(d.sizeBytes), nameOf(d.createdBy), d.note].filter(Boolean).join(' · ')}</span>
                      </span>
                      {st && st !== 'ok' && d.expiresOn && <span className={'flex-none rounded-full px-2 py-0.5 text-[11px] ' + (st === 'expired' ? 'bg-red-500/15 text-red-300' : 'bg-amber/15 text-amber')}>{expiryWords(d.expiresOn, today)}</span>}
                      {st === 'ok' && d.expiresOn && <span className="flex-none text-[11px] text-faint">to {fmtDay(d.expiresOn)}</span>}
                      <button type="button" aria-label="Open" disabled={!!busy} onClick={() => void open(d)} className="rounded p-1 text-teal hover:text-ink"><Download className="h-4 w-4" /></button>
                      {canEdit && <button type="button" aria-label="Edit" onClick={() => setEditing({ id: d.id, meta: metaOf(d) })} className="rounded p-1 text-faint hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>}
                      {canManage && <button type="button" aria-label="Remove" onClick={() => { if (window.confirm(`Remove ${d.title}?`)) void run(`del:${d.id}`, () => deleteDocAction(zone.id, d.id), 'Couldn’t remove it — try again.') }} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    {editing?.id === d.id && (
                      <div className="rounded-lg border border-navy-700 bg-navy-900 p-2 space-y-2">
                        <MetaFields meta={editing.meta} set={(m) => setEditing({ id: d.id, meta: m })} kinds={kinds} apps={apps} />
                        <div className="flex gap-2">
                          <button type="button" disabled={!!busy} onClick={() => void run(`ed:${d.id}`, () => saveDocAction(zone.id, d.id, { ...editing.meta, docDate: editing.meta.docDate || null, expiresOn: editing.meta.expiresOn || null, payAppId: editing.meta.payAppId || null }), 'Couldn’t save — try again.', () => setEditing(null))} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">Save</button>
                          <button type="button" onClick={() => setEditing(null)} className={btn}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        {!docs.length && available && <p className="text-faint">Nothing filed yet.</p>}
      </div>
    </div>
  )
}
