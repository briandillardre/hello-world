'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { X, FileUp, Loader2, Check, AlertTriangle, MapPin, Copy } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { busy as globalBusy } from '@/lib/busy'
import {
  createPlanSetAction, startPlanFileUploadAction, finishPlanFileUploadAction, addPlanVersionAction,
  voidPlanSheetsAction, copyPlacementAction, notePlacementAction,
} from '@/lib/actions/plans'
import { createImageryUploadAction, finalizeZoneImageryAction } from '@/lib/actions/imagery'
import {
  SET_KINDS, isFullIssue, verdictFor, numberKey, cleanNumber, commonDate, revLabel, nextRev,
  type PlanSetKind, type PageVerdict, type RoomVersion,
} from '@/lib/plans/room'
import type { PlanSheetRow } from '@/lib/db/plans'
import type { TitleBlock } from '@/lib/plans/title-block'
import { loadPdfjs, readPage, layerNames, renderSheetPng, readImageFile, categoryFor, type PdfDoc } from './pdf'
import type { Corners } from '@/components/zones/OverlayPlacer'

const OverlayPlacer = dynamic(
  () => import('@/components/zones/OverlayPlacer').then((m) => ({ default: m.OverlayPlacer })),
  { ssr: false },
)

const MAX_BYTES = 50 * 1024 * 1024 // mirrors lib/actions/plans.ts + imagery.ts

interface Src { file: File; kind: 'pdf' | 'image'; doc: PdfDoc | null; pages: number }

interface Item {
  key: string
  src: number
  page: number | null
  thumb: string
  width: number
  height: number
  read: TitleBlock | null
  signature: string | null
  ink: [number, number, number, number] | null
  number: string
  title: string
  rev: string
  keep: boolean
  keepTouched: boolean
}

interface Filed {
  key: string
  number: string
  verdict: PageVerdict['kind']
  versionId?: string
  imageId?: string
  imageUrl?: string
  carried?: 'exact' | 'check' | 'none'
  placed?: boolean
  width: number
  height: number
  error?: string
}

const today = () => new Date().toLocaleDateString('en-CA')

/**
 * Add a set to a site's plan room (migration 143). Pick the PDF(s); every
 * page's title block is read ON the device and each page gets a verdict
 * against the plan room — New sheet · Replaces C-101 Rev 0 → Rev 1 ·
 * Unchanged (same drawing, only the title block moved) · Not a sheet. Fix
 * what it guessed wrong, then File: the PDFs go to the private bucket whole,
 * each kept page becomes a picture + a version, and a revision of a placed
 * sheet lands where the old one sat when it is the same plot.
 */
export function AddPlanSet({ zoneId, sheets, ring, onClose, onDone }: {
  zoneId: string
  sheets: PlanSheetRow[]
  ring: [number, number][] | null
  onClose: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'pick' | 'reading' | 'review' | 'importing' | 'done'>('pick')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [name, setName] = useState('')
  // A room that already has sheets is most often getting an addendum.
  const [kind, setKind] = useState<PlanSetKind>(sheets.length ? 'addendum' : 'bid')
  const [issuedOn, setIssuedOn] = useState(today())
  const [dateTouched, setDateTouched] = useState(false)
  const [voidIds, setVoidIds] = useState<Set<string>>(new Set())
  const [filed, setFiled] = useState<Filed[]>([])
  const [placing, setPlacing] = useState<Filed | null>(null)
  const [copyOffer, setCopyOffer] = useState<{ from: Filed; to: Filed[] } | null>(null)
  const srcs = useRef<Src[]>([])
  const cancelled = useRef(false)

  // Free every open PDF when the panel goes away.
  useEffect(() => () => {
    cancelled.current = true
    for (const s of srcs.current) void s.doc?.loadingTask.destroy().catch(() => {})
  }, [])

  const versionsBySheet = useMemo(() => new Map<string, RoomVersion[]>(sheets.map((s) => [s.id, s.versions])), [sheets])
  const roomSheets = useMemo(() => sheets.map((s) => ({ id: s.id, numberKey: s.numberKey, pinnedVersionId: s.pinnedVersionId })), [sheets])
  const sheetById = useMemo(() => new Map(sheets.map((s) => [s.id, s])), [sheets])

  const verdicts = useMemo(() => new Map(items.map((it) => [it.key, verdictFor({ number: it.number, signature: it.signature }, issuedOn, roomSheets, versionsBySheet)])), [items, issuedOn, roomSheets, versionsBySheet])

  // Default keep: new / revises / older yes; unchanged / not a sheet no — until the person decides.
  useEffect(() => {
    setItems((xs) => {
      let changed = false
      const next = xs.map((it) => {
        if (it.keepTouched) return it
        const k = verdicts.get(it.key)?.kind
        const keep = k === 'new' || k === 'revises' || k === 'older'
        if (keep === it.keep) return it
        changed = true
        return { ...it, keep }
      })
      return changed ? next : xs
    })
  }, [verdicts])

  const kept = items.filter((it) => it.keep)
  const dupKeys = useMemo(() => {
    const n = new Map<string, number>()
    for (const it of kept) { const c = cleanNumber(it.number); if (c) n.set(numberKey(c), (n.get(numberKey(c)) ?? 0) + 1) }
    return new Set(Array.from(n.entries()).filter(([, c]) => c > 1).map(([k]) => k))
  }, [kept])
  const missingNumber = kept.filter((it) => !cleanNumber(it.number)).length

  // A full re-issue that leaves a live sheet out asks about it.
  const leftOut = useMemo(() => {
    if (!isFullIssue(kind) || phase !== 'review') return []
    const keys = new Set(kept.map((it) => cleanNumber(it.number)).filter((x): x is string => !!x).map(numberKey))
    return sheets.filter((s) => !s.voidedAt && !keys.has(s.numberKey) && !/^P\d+$/.test(s.numberKey))
  }, [kind, kept, sheets, phase])

  async function pick(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const list = Array.from(files).slice(0, 12)
    if (!name) setName(list[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').slice(0, 120))
    setPhase('reading')
    cancelled.current = false
    const done = globalBusy('Reading the set…')
    const out: Item[] = []
    try {
      const pdfjs = list.some((f) => isPdf(f)) ? await loadPdfjs() : null
      for (let si = 0; si < list.length; si++) {
        const f = list[si]
        if (isPdf(f) && pdfjs) {
          let doc: PdfDoc
          try {
            doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise as PdfDoc
          } catch {
            setError(`${f.name} wouldn’t open as a PDF — skipped.`)
            continue
          }
          const idx = srcs.current.push({ file: f, kind: 'pdf', doc, pages: doc.numPages }) - 1
          const names = await layerNames(doc)
          for (let p = 1; p <= doc.numPages; p++) {
            if (cancelled.current) break
            setProgress(`${f.name.slice(0, 40)} · page ${p} of ${doc.numPages}`)
            try {
              const r = await readPage(pdfjs, doc, p, names)
              out.push(toItem(`${idx}:${p}`, idx, p, r.thumb, r.width, r.height, r.tb, r.signature, r.ink))
            } catch {
              out.push(toItem(`${idx}:${p}`, idx, p, '', 0, 0, null, null, null))
            }
            setItems([...out])
            await new Promise((res) => setTimeout(res, 0))
          }
        } else if (/^image\//.test(f.type)) {
          try {
            const r = await readImageFile(f)
            const idx = srcs.current.push({ file: f, kind: 'image', doc: null, pages: 1 }) - 1
            out.push(toItem(`${idx}:img`, idx, null, r.thumb, r.width, r.height, null, null, null))
            setItems([...out])
          } catch {
            setError(`${f.name} isn’t a picture we can read — skipped.`)
          }
        }
      }
    } finally {
      done()
    }
    if (!out.length) { setPhase('pick'); setError((e) => e ?? 'Nothing to file in those — pick the set’s PDF.'); return }
    const d = commonDate(out.map((it) => it.read?.date ?? null))
    if (d && !dateTouched) setIssuedOn(d)
    setItems(out)
    setPhase('review')
  }

  function edit(key: string, patch: Partial<Item>) {
    setItems((xs) => xs.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  async function fileIt() {
    if (!kept.length) { setError('Keep at least one page.'); return }
    if (missingNumber) { setError('Every kept page needs a sheet number.'); return }
    if (dupKeys.size) { setError('Two kept pages have the same sheet number — keep one of them.'); return }
    if (!name.trim()) { setError('Name the set.'); return }
    setError(null)
    setPhase('importing')
    const done = globalBusy('Filing the set…')
    const results: Filed[] = []
    try {
      const set = await createPlanSetAction({ zoneId, name, kind, issuedOn }).catch(() => null)
      if (!set?.ok) { setError(set && !set.ok ? set.error : 'Couldn’t start the set — check signal and try again.'); setPhase('review'); return }
      const setId = set.setId
      const sb = createClient()
      // The original PDFs, whole, into the private bucket (the viewer reads them).
      const fileIds = new Map<number, string>()
      for (let i = 0; i < srcs.current.length; i++) {
        const s = srcs.current[i]
        if (s.kind !== 'pdf' || !kept.some((it) => it.src === i)) continue
        if (s.file.size > MAX_BYTES) { setError(`${s.file.name} is over 50 MB — its pages file as pictures only.`); continue }
        setProgress(`Uploading ${s.file.name.slice(0, 40)}…`)
        const st = await startPlanFileUploadAction({ setId, name: s.file.name, size: s.file.size }).catch(() => null)
        if (!st?.ok) continue
        const up = await sb.storage.from('plans').uploadToSignedUrl(st.path, st.token, s.file, { contentType: 'application/pdf' })
        if (up.error) continue
        const fin = await finishPlanFileUploadAction({ setId, path: st.path, name: s.file.name, pages: s.pages }).catch(() => null)
        if (fin?.ok) fileIds.set(i, fin.fileId)
      }
      for (let i = 0; i < kept.length; i++) {
        const it = kept[i]
        const number = cleanNumber(it.number)!
        const v = verdicts.get(it.key)?.kind ?? 'new'
        const label = `${number} — sheet ${i + 1} of ${kept.length}`
        setProgress(`${label} · converting…`)
        const s = srcs.current[it.src]
        let blob: Blob
        try {
          blob = s.kind === 'pdf' && s.doc && it.page ? await renderSheetPng(s.doc, it.page) : s.file
        } catch {
          results.push({ key: it.key, number, verdict: v, width: it.width, height: it.height, error: 'wouldn’t convert' })
          continue
        }
        if (blob.size > MAX_BYTES) { results.push({ key: it.key, number, verdict: v, width: it.width, height: it.height, error: 'over 50 MB' }); continue }
        setProgress(`${label} · uploading…`)
        const type = blob.type || 'image/png'
        const pre = await createImageryUploadAction(zoneId, type, blob.size).catch(() => null)
        if (!pre?.ok || !pre.path || !pre.token) { setError(pre?.error ?? 'Upload didn’t go through — check signal and try again.'); break }
        const up = await sb.storage.from('field-photos').uploadToSignedUrl(pre.path, pre.token, blob, { contentType: type })
        if (up.error) { setError('Upload didn’t go through — check signal and try again.'); break }
        const title = it.title.trim()
        const img = await finalizeZoneImageryAction({
          zoneId, path: pre.path, takenOn: issuedOn, caption: `${number}${title ? ` · ${title}` : ''}`,
          kind: 'plan', planCategory: categoryFor(title, number),
        }).catch(() => null)
        if (!img?.ok || !img.image) { setError(img?.error ?? 'Upload didn’t go through — try again.'); break }
        setProgress(`${label} · filing…`)
        const fileId = fileIds.get(it.src) ?? null
        const r = await addPlanVersionAction({
          setId, fileId, page: fileId ? it.page : null, imageId: img.image.id,
          number, title: title || null, rev: it.rev.trim() || null,
          signature: it.signature, pageW: it.width || null, pageH: it.height || null, inkBox: it.ink,
          feetPerInch: it.read?.feetPerInch ?? null, scaleText: it.read?.scaleText ?? null,
          titleRead: it.read ? { ...it.read } : null,
        }).catch(() => null)
        if (!r?.ok) { results.push({ key: it.key, number, verdict: v, width: it.width, height: it.height, error: r && !r.ok ? r.error : 'didn’t file' }); continue }
        results.push({
          key: it.key, number, verdict: v, versionId: r.versionId, imageId: img.image.id, imageUrl: img.image.url,
          carried: r.carried, placed: r.placed, width: it.width, height: it.height,
        })
        setFiled([...results])
      }
      if (voidIds.size) await voidPlanSheetsAction(setId, Array.from(voidIds)).catch(() => null)
    } finally {
      done()
    }
    setFiled(results)
    setPhase('done')
  }

  // After placing one sheet by hand: offer its corners to the others of this
  // upload printed on the same paper (civil sets share scale and origin).
  function afterPlaced(f: Filed, b: Corners | null) {
    setFiled((xs) => xs.map((x) => (x.key === f.key ? { ...x, placed: !!b, carried: 'none' } : x)))
    setPlacing(null)
    if (!b || !f.versionId) return
    void notePlacementAction(f.versionId, 'manual').catch(() => {})
    const to = filed.filter((x) => x.key !== f.key && !x.placed && x.versionId && Math.abs(x.width - f.width) <= 1 && Math.abs(x.height - f.height) <= 1)
    if (to.length) setCopyOffer({ from: f, to })
  }

  async function copyToOthers() {
    if (!copyOffer?.from.versionId) return
    const ids = copyOffer.to.map((x) => x.versionId!).filter(Boolean)
    const r = await copyPlacementAction(copyOffer.from.versionId, ids).catch(() => null)
    if (r?.ok) {
      const done = new Set(copyOffer.to.map((x) => x.key))
      setFiled((xs) => xs.map((x) => (done.has(x.key) ? { ...x, placed: true, carried: 'check' } : x)))
    } else setError(r && !r.ok ? r.error : 'Couldn’t copy the placement — try again.')
    setCopyOffer(null)
  }

  const counts = {
    newer: filed.filter((f) => !f.error && f.verdict === 'new').length,
    revised: filed.filter((f) => !f.error && f.verdict === 'revises').length,
    exact: filed.filter((f) => f.carried === 'exact').length,
    check: filed.filter((f) => f.carried === 'check').length,
    unplaced: filed.filter((f) => !f.error && !f.placed).length,
    failed: filed.filter((f) => f.error).length,
  }

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/95 backdrop-blur-sm flex flex-col"
      style={{ paddingTop: 'var(--ht-safe-top, 0px)', paddingBottom: 'var(--ht-safe-bottom, 0px)' }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-navy-800">
        <FileUp className="h-5 w-5 text-amber" />
        <h2 className="font-display font-bold text-ink flex-1">Add a set</h2>
        {phase !== 'importing' && (
          <button type="button" onClick={() => { if (phase === 'done') onDone(); onClose() }} aria-label="Close" className="rounded-lg p-2 text-faint hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {(phase === 'pick' || phase === 'reading') && (
            <>
              <p className="text-[13px] text-muted">
                Pick the set’s PDF — the whole thing, or several. Each page’s title block is read here on your device
                (sheet number, title, revision, date), and every page is checked against the sheets already in this plan room.
              </p>
              <label className={'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 cursor-pointer ' +
                (phase === 'reading' ? 'border-navy-700 opacity-60 pointer-events-none' : 'border-navy-600 hover:border-amber/60')}>
                {phase === 'reading' ? <Loader2 className="h-7 w-7 text-amber animate-spin" /> : <FileUp className="h-7 w-7 text-amber" />}
                <span className="font-display font-bold text-ink">{phase === 'reading' ? 'Reading…' : 'Choose PDF files'}</span>
                <span className="text-[12px] text-faint">{phase === 'reading' ? progress : 'Up to 50 MB each · pictures of sheets work too'}</span>
                <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => void pick(e.target.files)} />
              </label>
              {phase === 'reading' && items.length > 0 && (
                <div className="flex items-center gap-3">
                  <p className="text-[12px] text-faint flex-1">{items.length} page{items.length === 1 ? '' : 's'} read</p>
                  <button type="button" onClick={() => { cancelled.current = true }} className="text-[12px] text-muted hover:text-ink underline">Stop and review what’s read</button>
                </div>
              )}
            </>
          )}

          {phase === 'review' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 rounded-xl border border-navy-800 bg-navy-900 p-3">
                <label className="block sm:col-span-1">
                  <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-faint">Set name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Bid set"
                    className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-2 text-sm text-ink" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-faint">Kind</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as PlanSetKind)}
                    className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-2 py-2 text-sm text-ink">
                    {SET_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-faint">Issued</span>
                  <input type="date" value={issuedOn} onChange={(e) => { setIssuedOn(e.target.value); setDateTouched(true) }}
                    className="mt-1 w-full rounded-lg bg-navy-950 border border-navy-700 px-2 py-2 text-sm text-ink" />
                </label>
              </div>

              <Tally items={items} verdicts={verdicts} />

              <div className="space-y-2">
                {items.map((it) => {
                  const v = verdicts.get(it.key)!
                  const dup = it.keep && cleanNumber(it.number) && dupKeys.has(numberKey(cleanNumber(it.number)!))
                  return (
                    <div key={it.key} className={'flex gap-3 rounded-xl border p-2.5 ' + (it.keep ? 'border-navy-700 bg-navy-900' : 'border-navy-800 bg-navy-950 opacity-70')}>
                      <label className="flex flex-col items-center gap-1 cursor-pointer">
                        {it.thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={it.thumb} alt={`Page ${it.page ?? ''}`} className="w-24 sm:w-32 rounded bg-white border border-navy-700" />
                          : <div className="w-24 sm:w-32 aspect-[3/2] rounded bg-navy-800 grid place-items-center text-[10px] text-faint">no preview</div>}
                        <span className="flex items-center gap-1 text-[11px] text-muted">
                          <input type="checkbox" checked={it.keep} onChange={(e) => edit(it.key, { keep: e.target.checked, keepTouched: true })} className="accent-amber" />
                          Keep
                        </span>
                      </label>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <VerdictChip v={v} sheetNumber={(id) => sheetById.get(id)?.number ?? ''} />
                          {it.page != null && <span className="text-[10.5px] text-faint">{srcs.current[it.src]?.file.name.slice(0, 32)} · p{it.page}</span>}
                          {it.read && it.read.confidence < 0.4 && it.read.number && <span className="text-[10.5px] text-amber">unsure read — check the number</span>}
                        </div>
                        <div className="grid grid-cols-[6.5rem_1fr_4rem] gap-1.5">
                          <input value={it.number} onChange={(e) => edit(it.key, { number: e.target.value.toUpperCase().slice(0, 24), keep: it.keepTouched ? it.keep : true })}
                            placeholder="C-101" aria-label="Sheet number"
                            className={'rounded-lg bg-navy-950 border px-2 py-1.5 text-sm font-mono text-ink ' + (dup || (it.keep && !cleanNumber(it.number)) ? 'border-red-500/70' : 'border-navy-700')} />
                          <input value={it.title} onChange={(e) => edit(it.key, { title: e.target.value.slice(0, 200) })}
                            placeholder="Title" aria-label="Sheet title"
                            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm text-ink min-w-0" />
                          <input value={it.rev} onChange={(e) => edit(it.key, { rev: e.target.value.slice(0, 8) })}
                            placeholder="Rev" aria-label="Revision"
                            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-sm font-mono text-ink" />
                        </div>
                        {dup && <p className="text-[11px] text-red-400">This number is on another kept page too.</p>}
                        {v.kind === 'revises' && !it.rev.trim() && nextRev(v.from.rev) && (
                          <button type="button" onClick={() => edit(it.key, { rev: nextRev(v.from.rev)! })} className="text-[11px] text-teal underline">
                            No revision mark read — call it {revLabel(nextRev(v.from.rev))}?
                          </button>
                        )}
                        {it.read?.scaleText && <p className="text-[10.5px] text-faint">Scale read: {it.read.scaleText}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>

              {leftOut.length > 0 && (
                <div className="rounded-xl border border-amber/40 bg-amber/5 p-3 space-y-2">
                  <p className="text-[12.5px] text-ink font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber" />
                    {leftOut.length === 1 ? `${leftOut[0].number} isn’t in this set. Void it?` : `${leftOut.length} sheets aren’t in this set. Void any?`}
                  </p>
                  <p className="text-[11.5px] text-faint">A {SET_KINDS.find((k) => k.key === kind)?.label.toLowerCase()} usually carries every sheet. A voided sheet stays in the history, leaves the map and reads VOID.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {leftOut.map((s) => (
                      <label key={s.id} className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] cursor-pointer ' + (voidIds.has(s.id) ? 'border-red-500/60 text-red-300' : 'border-navy-700 text-muted')}>
                        <input type="checkbox" className="accent-red-500" checked={voidIds.has(s.id)} onChange={(e) => setVoidIds((cur) => {
                          const n = new Set(cur); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n
                        })} />
                        <span className="font-mono">{s.number}</span>{s.title ? <span className="truncate max-w-[10rem]">{s.title}</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {phase === 'importing' && (
            <div className="rounded-xl border border-navy-700 bg-navy-900 p-4 space-y-2">
              <div className="h-[3px] rounded-full bg-navy-800 overflow-hidden">
                <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${Math.round(100 * filed.length / Math.max(1, kept.length))}%` }} />
              </div>
              <p className="text-[12.5px] text-muted">{progress}</p>
              <p className="text-[11px] text-faint">Keep this screen open until it finishes.</p>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-teal/40 bg-teal/5 p-3">
                <p className="font-display font-bold text-ink flex items-center gap-2"><Check className="h-4 w-4 text-teal" /> Filed {filed.length - counts.failed} sheet{filed.length - counts.failed === 1 ? '' : 's'}</p>
                <ul className="mt-1 text-[12.5px] text-muted space-y-0.5">
                  {counts.newer > 0 && <li>{counts.newer} new sheet{counts.newer === 1 ? '' : 's'}</li>}
                  {counts.revised > 0 && <li>{counts.revised} revised — the new version is current</li>}
                  {counts.exact > 0 && <li>{counts.exact} landed exactly where the last version sat (same plot)</li>}
                  {counts.check > 0 && <li className="text-amber">{counts.check} carried their placement but the drawing moved on the paper — check them on the map</li>}
                  {counts.unplaced > 0 && <li>{counts.unplaced} aren’t on the map yet — place one below and the rest can copy it</li>}
                  {counts.failed > 0 && <li className="text-red-400">{counts.failed} didn’t file — see below</li>}
                  {voidIds.size > 0 && <li>{voidIds.size} voided</li>}
                </ul>
              </div>
              {copyOffer && (
                <div className="rounded-xl border border-amber/40 bg-amber/5 p-3 flex items-center gap-3 flex-wrap">
                  <p className="text-[12.5px] text-ink flex-1">Copy {copyOffer.from.number}’s placement to the other {copyOffer.to.length} sheet{copyOffer.to.length === 1 ? '' : 's'} on the same paper?</p>
                  <button type="button" onClick={() => void copyToOthers()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  <button type="button" onClick={() => setCopyOffer(null)} className="text-xs text-faint hover:text-ink">No</button>
                </div>
              )}
              <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
                {filed.map((f) => (
                  <div key={f.key} className="flex items-center gap-2.5 px-3 py-2">
                    <span className="font-mono text-sm text-ink w-20 truncate">{f.number}</span>
                    <span className="text-[11.5px] text-faint flex-1">
                      {f.error ? <span className="text-red-400">{f.error}</span>
                        : f.carried === 'exact' ? 'On the map where the last version sat'
                        : f.carried === 'check' ? <span className="text-amber">Placed from the last version — check it</span>
                        : f.placed ? 'Placed' : 'Not on the map yet'}
                    </span>
                    {!f.error && !f.placed && f.imageId && f.imageUrl && (
                      <button type="button" onClick={() => setPlacing(f)} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink">
                        <MapPin className="h-3 w-3" /> Place
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {phase === 'review' && (
        <div className="border-t border-navy-800 px-4 py-3 flex items-center gap-3 bg-navy-950">
          <p className="text-[12px] text-faint flex-1">{kept.length} of {items.length} page{items.length === 1 ? '' : 's'} kept</p>
          <button type="button" onClick={onClose} className="text-sm text-faint hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void fileIt()} disabled={!kept.length}
            className="rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2 disabled:opacity-40">
            File {kept.length} sheet{kept.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
      {phase === 'done' && (
        <div className="border-t border-navy-800 px-4 py-3 flex justify-end bg-navy-950">
          <button type="button" onClick={() => { onDone(); onClose() }} className="rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2">Done</button>
        </div>
      )}

      {placing?.imageId && placing.imageUrl && (
        <OverlayPlacer
          zoneId={zoneId}
          imageId={placing.imageId}
          imageUrl={placing.imageUrl}
          ring={ring}
          initialBounds={null}
          hint={`Line ${placing.number}’s property corners up with the satellite view.`}
          onClose={() => setPlacing(null)}
          onSaved={(b) => afterPlaced(placing, b)}
        />
      )}
    </div>
  )
}

function isPdf(f: File) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name) }

function toItem(key: string, src: number, page: number | null, thumb: string, width: number, height: number,
  read: TitleBlock | null, signature: string | null, ink: [number, number, number, number] | null): Item {
  return {
    key, src, page, thumb, width, height, read, signature, ink,
    number: read?.number ?? '', title: read?.title ?? '', rev: read?.rev ?? '',
    keep: !!read?.number, keepTouched: false,
  }
}

function VerdictChip({ v, sheetNumber }: { v: PageVerdict; sheetNumber: (id: string) => string }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border '
  switch (v.kind) {
    case 'new': return <span className={base + 'border-teal/50 text-teal bg-teal/10'}>New sheet</span>
    case 'revises': return <span className={base + 'border-amber/50 text-amber bg-amber/10'}>Replaces {sheetNumber(v.sheetId)} {revLabel(v.from.rev)}</span>
    case 'unchanged': return <span className={base + 'border-navy-600 text-muted'}>Unchanged — same drawing as {revLabel(v.same.rev)}</span>
    case 'older': return <span className={base + 'border-navy-600 text-muted'}>Older than {sheetNumber(v.sheetId)}’s {revLabel(v.current.rev)} — files into history</span>
    default: return <span className={base + 'border-navy-700 text-faint'}>Not a sheet — type a number to keep it</span>
  }
}

function Tally({ items, verdicts }: { items: Item[]; verdicts: Map<string, PageVerdict> }) {
  const n = (k: PageVerdict['kind']) => items.filter((it) => verdicts.get(it.key)?.kind === k).length
  const parts = [
    [n('new'), 'new'], [n('revises'), 'revised'], [n('unchanged'), 'unchanged'], [n('older'), 'older'], [n('not-sheet'), 'not sheets'],
  ].filter(([c]) => (c as number) > 0).map(([c, w]) => `${c} ${w}`)
  return <p className="text-[12.5px] text-muted">{items.length} page{items.length === 1 ? '' : 's'}: {parts.join(' · ')}</p>
}
