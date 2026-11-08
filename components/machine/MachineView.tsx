'use client'

/**
 * A site's machine files by revision: the dealer's TP3s, the design LandXML /
 * DXF the dirt takeoff writes, anything the machines run — each with the plan
 * revisions it was built from, and a plain warning the day a newer revision
 * lands ("C-101: built from Rev 1 — Rev 2 is current").
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Cpu, Upload, Download, Trash2, CheckCircle2, AlertTriangle, HelpCircle, Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { KIND_WORDS, MACHINE_KINDS, kindOf, type FileStatus, type MachineKind } from '@/lib/machine/status'
import type { MachineFile } from '@/lib/db/machine'
import { startMachineUploadAction, finishMachineFileAction, machineFileLinkAction, deleteMachineFileAction } from '@/lib/actions/machine'

type Row = MachineFile & { older: boolean; status: FileStatus }
interface Current { sheetId: string; versionId: string; label: string; title: string | null }

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const TONE = {
  current: { cls: 'text-teal-300', Icon: CheckCircle2, word: 'Up to date' },
  behind: { cls: 'text-amber', Icon: AlertTriangle, word: 'Behind the plans' },
  unknown: { cls: 'text-faint', Icon: HelpCircle, word: 'Plans not recorded' },
}

export function MachineView({ zone, files, current, canEdit, canDelete, demo }: {
  zone: { id: string; name: string }; files: Row[]; current: Current[]; canEdit: boolean; canDelete: boolean; demo: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const latest = files.filter((f) => !f.older)
  const behind = latest.filter((f) => f.status.state === 'behind').length

  async function download(f: Row) {
    setBusy(`dl:${f.id}`); setErr(null)
    const r = await machineFileLinkAction(f.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t open the file — try again.'); return }
    window.location.href = r.url
  }
  async function remove(f: Row) {
    if (!confirm(`Remove ${f.filename}?`)) return
    setBusy(`del:${f.id}`); setErr(null)
    const r = await deleteMachineFileAction(f.id).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t remove it — try again.'); return }
    router.refresh()
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href={`/plans/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Plan room</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Cpu className="h-5 w-5 text-amber" /> Machine files · {zone.name}</h1>
          <p className="text-[12.5px] text-faint">What the machines run — the dealer&apos;s TP3s, the design LandXML and DXF from the dirt takeoff — each filed with the plan revisions it was built from, so a new revision says which files need rebuilding.</p>
        </div>

        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Demo mode — sign in to file a site&apos;s machine files.</p>}
        {behind > 0 && (
          <p className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/5 px-3 py-2 text-[12.5px] text-amber">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {behind} file{behind === 1 ? ' was' : 's were'} built from plans that have been revised since — ask for {behind === 1 ? 'a new one' : 'new ones'} before the machines run {behind === 1 ? 'it' : 'them'}.
          </p>
        )}

        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-amber px-3 py-2 text-[12.5px] font-semibold text-navy-950"><Upload className="h-4 w-4" /> Add a file</button>
        )}
        {adding && canEdit && <UploadCard zoneId={zone.id} current={current} onDone={() => { setAdding(false); router.refresh() }} onCancel={() => setAdding(false)} />}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-[12.5px] text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        <section className="space-y-2">
          {!files.length && !demo && <p className="text-[12.5px] text-faint">No machine files yet. Add the dealer&apos;s TP3, or export the design from the site&apos;s dirt takeoff (Results → For the machines).</p>}
          {files.map((f) => {
            const t = TONE[f.status.state]
            return (
              <div key={f.id} className={`rounded-xl border border-navy-800 bg-navy-950 p-2.5 text-[12.5px] ${f.older ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{f.name}</span>
                      <span className="rounded-full border border-navy-700 px-1.5 text-[10.5px] uppercase tracking-wide text-faint">{KIND_WORDS[f.kind] ?? f.kind}</span>
                      {f.older ? <span className="text-[11px] text-faint">older copy</span> : <span className={`inline-flex items-center gap-1 ${t.cls}`}><t.Icon className="h-3.5 w-3.5" /> {t.word}</span>}
                    </div>
                    <div className="text-muted truncate">{f.filename} · {size(f.sizeBytes)}{f.builtBy ? ` · ${f.builtBy}` : ''}{f.builtOn ? ` · ${f.builtOn}` : ''}{f.grid ? ` · ${f.grid}` : ''}</div>
                    {!f.older && f.status.lines.map((l) => <div key={l} className={f.status.state === 'behind' ? 'text-amber' : 'text-faint'}>{l}</div>)}
                    {f.takeoffId && <Link href={`/dirt/${f.takeoffId}`} className="text-[11.5px] text-amber">From the dirt takeoff</Link>}
                    {f.note && <div className="text-faint">{f.note}</div>}
                  </div>
                  <div className="flex items-center gap-1 flex-none">
                    <button onClick={() => download(f)} disabled={busy === `dl:${f.id}`} aria-label={`Download ${f.filename}`} className="p-2 text-ink hover:text-amber disabled:opacity-50">
                      {busy === `dl:${f.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </button>
                    {canDelete && <button onClick={() => remove(f)} disabled={busy === `del:${f.id}`} aria-label={`Remove ${f.filename}`} className="p-2 text-red-300 hover:text-red-200 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}

function UploadCard({ zoneId, current, onDone, onCancel }: { zoneId: string; current: Current[]; onDone: () => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<MachineKind>('tp3')
  const [builtBy, setBuiltBy] = useState('')
  const [builtOn, setBuiltOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<Set<string>>(() => new Set(current.map((c) => c.sheetId)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function pick(f: File | undefined) {
    if (!f) return
    setFile(f)
    setKind(kindOf(f.name))
    if (!name) setName(f.name.replace(/\.[a-z0-9]+$/i, ''))
  }
  async function go() {
    if (!file) { setErr('Pick the file first.'); return }
    setBusy(true); setErr(null)
    try {
      const st = await startMachineUploadAction({ zoneId, filename: file.name, size: file.size }).catch(() => null)
      if (!st?.ok) { setErr(st && !st.ok ? st.error : 'Couldn’t start the upload — try again.'); return }
      const { error } = await createClient().storage.from('machine').uploadToSignedUrl(st.path, st.token, file, { contentType: 'application/octet-stream' })
      if (error) { setErr('The file didn’t upload — try again.'); return }
      const fin = await finishMachineFileAction({
        zoneId, id: st.id, name: name || file.name, filename: file.name, kind, builtBy, builtOn, note,
        builtFrom: current.filter((c) => from.has(c.sheetId)).map((c) => ({ sheetId: c.sheetId, versionId: c.versionId })),
      }).catch(() => null)
      if (!fin?.ok) { setErr(fin && !fin.ok ? fin.error : 'Couldn’t file it — try again.'); return }
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-2xl border border-navy-700 bg-navy-900/60 p-3 space-y-3 text-[12.5px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Add a machine file</h2>
        <button onClick={onCancel} aria-label="Close" className="p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <input ref={input} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button onClick={() => input.current?.click()} className="w-full rounded-lg border border-dashed border-navy-600 px-3 py-3 text-muted hover:text-ink">
        {file ? `${file.name} · ${size(file.size)}` : 'Pick the file — TP3, SVD/SVL, LandXML, DXF, DWG, zip (up to 100 MB)'}
      </button>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="space-y-1 col-span-2"><span className="block text-faint">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Subgrade" className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink" /></label>
        <label className="space-y-1"><span className="block text-faint">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as MachineKind)} className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink">
            {MACHINE_KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
          </select></label>
        <label className="space-y-1"><span className="block text-faint">Built on</span>
          <input type="date" value={builtOn} onChange={(e) => setBuiltOn(e.target.value)} className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink" /></label>
        <label className="space-y-1 col-span-2"><span className="block text-faint">Built by</span>
          <input value={builtBy} onChange={(e) => setBuiltBy(e.target.value)} placeholder="The dealer, or who made it" className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink" /></label>
        <label className="space-y-1 col-span-2"><span className="block text-faint">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink" /></label>
      </div>
      <div className="space-y-1">
        <div className="text-faint">Built from these plan revisions</div>
        {!current.length && <p className="text-faint">No sheets in the plan room yet — the file is filed without them.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
          {current.map((c) => (
            <label key={c.sheetId} className="flex items-center gap-2 text-muted">
              <input type="checkbox" checked={from.has(c.sheetId)} onChange={(e) => setFrom((s) => { const n = new Set(s); if (e.target.checked) n.add(c.sheetId); else n.delete(c.sheetId); return n })} />
              <span className="truncate">{c.label}{c.title ? ` · ${c.title}` : ''}</span>
            </label>
          ))}
        </div>
      </div>
      {err && <p className="text-red-300">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink">Cancel</button>
        <button onClick={go} disabled={busy || !file} className="rounded-xl bg-amber px-4 py-2 font-semibold text-navy-950 disabled:opacity-50">{busy ? 'Uploading…' : 'File it'}</button>
      </div>
    </section>
  )
}
