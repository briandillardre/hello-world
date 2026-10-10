'use client'

/**
 * The site takeoff editor (migration 137): measure paving and landscaping
 * quantities on the site's own drone picture.
 *
 * Tools: Draw (areas / lines by tap, counts one tap each) · Wand (tap inside
 * a surface on the DRONE picture — region growing on its pixels, an assist to
 * check and edit) · Stall row (draw a line across a row of stalls — stripes
 * found from the picture's brightness, an editable count) · Select.
 * On the Esri basemap only hand tracing is offered: its terms allow tracing
 * by a person, not running detection over it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Copy, Download, MousePointer2, PenLine, Plus, Printer, Rows3, Trash2, Undo2, Wand2 } from 'lucide-react'
import { saveSiteTakeoffAction, deleteSiteTakeoffAction } from '@/lib/actions/site-takeoff'
import { NO_REPLY } from '@/lib/action-reply'
import { PRICE_UNITS, UNIT_LABEL, type ItemKind, type PriceUnit, type SiteDesign, type SiteItem, type SiteMark } from '@/lib/site-takeoff/items'
import { computeSite, money, qtyLabel, resultsCsv, frameFor, lineLengthM } from '@/lib/site-takeoff/measure'
import { labImage, magicWand, type Pixels } from '@/lib/site-takeoff/wand'
import { findStripes, sampleProfile } from '@/lib/site-takeoff/stalls'
import { lngLatToUv, makeQuad, pixelRingToLngLat, type Quad } from '@/lib/site-takeoff/quad'
import type { Ortho, SiteTakeoffFull } from '@/lib/db/site-takeoff'

const SiteTakeoffMap = dynamic(() => import('./SiteTakeoffMap'), { ssr: false })

type Tool = 'draw' | 'wand' | 'stall' | 'select'
/** Longest edge the assist reads the picture at (pixels). */
const ASSIST_EDGE = 2048

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

function PriceBox({ value, onValue, disabled }: { value: number | null; onValue: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => { setText(value == null ? '' : String(value)) }, [value])
  const commit = () => {
    const t = text.replace(/[$,\s]/g, '')
    if (t === '') { if (value !== null) onValue(null); return }
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) { if (n !== value) onValue(n) }
    else setText(value == null ? '' : String(value))
  }
  return (
    <input value={text} disabled={disabled} inputMode="decimal" placeholder="$ —" aria-label="Unit price"
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-20 rounded border border-navy-700 bg-navy-950 px-1.5 py-1 text-right text-xs text-ink" />
  )
}

interface Raster { px: Pixels; lab: Float32Array | null; W: number; H: number }

export default function SiteTakeoffEditor({ takeoff, zone, orthos, canEdit }: {
  takeoff: SiteTakeoffFull
  zone: { id: string; name: string; ring: [number, number][] | null }
  orthos: Ortho[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(takeoff.name)
  const [design, setDesign] = useState<SiteDesign>(() => ({
    v: 1,
    imageryId: takeoff.design?.imageryId ?? takeoff.imageryId ?? null,
    items: Array.isArray(takeoff.design?.items) && takeoff.design.items.length ? takeoff.design.items : [],
    marks: Array.isArray(takeoff.design?.marks) ? takeoff.design.marks : [],
  }))
  const [history, setHistory] = useState<SiteDesign[]>([])
  const [dirty, setDirty] = useState(false)
  const [since, setSince] = useState(takeoff.updatedAt)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [tool, setTool] = useState<Tool>('draw')
  const [active, setActive] = useState<string>(design.items[0]?.id ?? '')
  const [draft, setDraft] = useState<[number, number][]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [tolerance, setTolerance] = useState(30)
  const [opacity, setOpacity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [raster, setRaster] = useState<Raster | null>(null)
  const [rasterErr, setRasterErr] = useState<string | null>(null)
  const lastWand = useRef<{ markId: string; at: [number, number] } | null>(null)

  const ortho = useMemo(() => orthos.find(o => o.id === design.imageryId) ?? null, [orthos, design.imageryId])
  const quad: Quad | null = useMemo(() => (ortho ? makeQuad(ortho.corners) : null), [ortho])
  const item = design.items.find(i => i.id === active) ?? null
  const results = useMemo(() => computeSite(design), [design])
  const selMark = design.marks.find(m => m.id === sel) ?? null
  const assistOk = !!ortho && !!raster

  const designRef = useRef(design)
  designRef.current = design
  const change = useCallback((fn: (d: SiteDesign) => SiteDesign) => {
    const d = designRef.current
    const next = fn(d)
    designRef.current = next
    setHistory(h => [...h.slice(-49), d])
    setDesign(next)
    setDirty(true)
  }, [])

  // Leaving with unsaved work asks first.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Read the picked drone picture's pixels for the assist.
  useEffect(() => {
    setRaster(null); setRasterErr(null)
    if (!ortho) return
    let gone = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (gone) return
      try {
        const s = Math.min(1, ASSIST_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
        const W = Math.max(1, Math.round(img.naturalWidth * s)), H = Math.max(1, Math.round(img.naturalHeight * s))
        const c = document.createElement('canvas')
        c.width = W; c.height = H
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('no 2d')
        ctx.drawImage(img, 0, 0, W, H)
        const data = ctx.getImageData(0, 0, W, H).data
        setRaster({ px: { width: W, height: H, data }, lab: null, W, H })
      } catch {
        setRasterErr('This picture can’t be read for the assist — trace it by hand.')
      }
    }
    img.onerror = () => { if (!gone) setRasterErr('The picture did not load — trace on the map by hand.') }
    img.src = ortho.url
    return () => { gone = true }
  }, [ortho])

  // Wand / stall need the drone picture; fall back to Draw when it's gone.
  useEffect(() => { if (!assistOk && (tool === 'wand' || tool === 'stall')) setTool('draw') }, [assistOk, tool])

  function undo() {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(h => h.slice(0, -1))
    designRef.current = prev
    setDesign(prev); setDirty(true); setDraft([])
  }

  function addMark(m: SiteMark) {
    change(d => ({ ...d, marks: [...d.marks, m] }))
  }

  function finishDraft() {
    if (!item) return
    const need = item.kind === 'area' ? 3 : 2
    // A double-tap also lands as two taps on the same spot — drop repeats.
    const pts = draft.filter((p, i) => i === 0 || Math.abs(p[0] - draft[i - 1][0]) > 1e-8 || Math.abs(p[1] - draft[i - 1][1]) > 1e-8)
    if (tool === 'draw' && item.kind !== 'count' && pts.length >= need) {
      const m: SiteMark = { id: uid('m'), item: item.id, coords: pts, src: 'hand' }
      addMark(m); setSel(m.id)
    }
    setDraft([])
  }

  function toPx(p: [number, number], r: Raster): [number, number] | null {
    if (!quad) return null
    const uv = lngLatToUv(quad, p[0], p[1])
    if (!uv || uv[0] < 0 || uv[0] > 1 || uv[1] < 0 || uv[1] > 1) return null
    return [uv[0] * r.W, uv[1] * r.H]
  }

  function runWand(at: [number, number], replaceId?: string) {
    if (!raster || !quad || !item) return
    if (item.kind !== 'area') { setMsg({ tone: 'warn', text: 'The wand fills AREAS — pick an area line item (asphalt, turf, beds…).' }); return }
    const px = toPx(at, raster)
    if (!px) { setMsg({ tone: 'warn', text: 'That tap is off the drone picture.' }); return }
    setBusy(true)
    setTimeout(() => {
      try {
        const lab = raster.lab ?? labImage(raster.px)
        if (!raster.lab) setRaster(r => (r ? { ...r, lab } : r))
        const res = magicWand(raster.px, px[0], px[1], { tolerance }, lab)
        if (!res) { setMsg({ tone: 'warn', text: 'Nothing grew there — raise the tolerance or trace it by hand.' }); return }
        const coords = pixelRingToLngLat(quad, res.ring, raster.W, raster.H)
        const id = replaceId ?? uid('w')
        const m: SiteMark = { id, item: item.id, coords, src: 'wand' }
        change(d => ({ ...d, marks: replaceId ? d.marks.map(x => (x.id === replaceId ? m : x)) : [...d.marks, m] }))
        lastWand.current = { markId: id, at }
        setSel(id)
        setMsg({
          tone: res.capped ? 'warn' : 'ok',
          text: res.capped
            ? 'Assist ran out of room — it probably leaked past an edge. Lower the tolerance and re-run, or delete it.'
            : `Assist: ${coords.length} corners. Check the outline — re-run at a new tolerance, delete it, or trace by hand.`,
        })
      } finally {
        setBusy(false)
      }
    }, 10)
  }

  function runStall(a: [number, number], b: [number, number]) {
    if (!raster || !quad || !item) return
    const pa = toPx(a, raster), pb = toPx(b, raster)
    if (!pa || !pb) { setMsg({ tone: 'warn', text: 'Both ends of the row have to be on the drone picture.' }); return }
    const f = frameFor([a, b])
    const metres = f ? lineLengthM(f, [a, b]) : 0
    const pixels = Math.hypot(pb[0] - pa[0], pb[1] - pa[1])
    if (!(metres > 1) || !(pixels > 4)) { setMsg({ tone: 'warn', text: 'Draw the row line longer.' }); return }
    const mpp = metres / pixels
    const prof = sampleProfile(raster.px, pa[0], pa[1], pb[0], pb[1], 1, Math.max(2, Math.round(0.3 / mpp)))
    const s = findStripes(prof, { maxWidth: Math.max(3, Math.ceil(0.45 / mpp) + 2), minGap: Math.max(2, Math.ceil(0.3 / mpp)) })
    const m: SiteMark = { id: uid('s'), item: item.id, coords: [a, b], count: s.stalls, src: 'stall' }
    addMark(m); setSel(m.id)
    setMsg({
      tone: s.irregular || s.stalls === 0 ? 'warn' : 'ok',
      text: s.stalls === 0
        ? 'No painted stripes found along that line — type the count in.'
        : `Assist: ${s.stripes.length} stripes → ${s.stalls} stalls${s.irregular ? ' — the spacing is uneven (a car over a stripe?)' : ''}. Check the count and correct it.`,
    })
  }

  function onMapClick(p: [number, number]) {
    if (!canEdit || !item || busy) return
    setMsg(null)
    if (tool === 'wand') { runWand(p); return }
    if (tool === 'stall') {
      if (item.kind !== 'count') { setMsg({ tone: 'warn', text: 'Stall rows count — pick a count line item (parking stalls, ADA…).' }); return }
      if (draft.length === 0) { setDraft([p]); return }
      const a = draft[0]; setDraft([]); runStall(a, p); return
    }
    if (tool === 'draw') {
      if (item.kind === 'count') { const m: SiteMark = { id: uid('c'), item: item.id, coords: [p], src: 'hand' }; addMark(m); return }
      setDraft(d => [...d, p])
    }
  }

  const marksFc = useMemo<GeoJSON.FeatureCollection>(() => {
    const fs: GeoJSON.Feature[] = []
    for (const m of design.marks) {
      const it = design.items.find(i => i.id === m.item)
      if (!it) continue
      const props = { id: m.id, color: it.color, sel: m.id === sel ? 1 : 0, minus: m.minus ? 1 : 0 }
      if (it.kind === 'area' && m.coords.length >= 3) fs.push({ type: 'Feature', properties: { ...props, g: 'ar' }, geometry: { type: 'Polygon', coordinates: [[...m.coords, m.coords[0]]] } })
      else if (it.kind === 'line' && m.coords.length >= 2) fs.push({ type: 'Feature', properties: { ...props, g: 'ln' }, geometry: { type: 'LineString', coordinates: m.coords } })
      else if (it.kind === 'count') {
        if (m.count != null && m.coords.length >= 2) fs.push({ type: 'Feature', properties: { ...props, g: 'ln' }, geometry: { type: 'LineString', coordinates: m.coords } })
        else for (const c of m.coords) fs.push({ type: 'Feature', properties: { ...props, g: 'pt' }, geometry: { type: 'Point', coordinates: c } })
      }
    }
    return { type: 'FeatureCollection', features: fs }
  }, [design, sel])

  async function save() {
    if (!canEdit || saving) return
    setSaving(true); setMsg(null)
    try {
      const r = await saveSiteTakeoffAction(takeoff.id, { name, design, since })
      if (r?.ok) {
        setDirty(false)
        if (r.savedAt) setSince(r.savedAt)
        setMsg({ tone: 'ok', text: 'Saved.' })
      } else setMsg({ tone: 'warn', text: r?.error ?? NO_REPLY })
    } catch {
      setMsg({ tone: 'warn', text: 'Could not save — check the connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!canEdit || !confirm('Delete this takeoff?')) return
    const r = await deleteSiteTakeoffAction(takeoff.id).catch(() => null)
    if (r?.ok) { setDirty(false); router.push(zone.id ? `/zones/${zone.id}` : '/zones') }
    else setMsg({ tone: 'warn', text: r?.error ?? NO_REPLY })
  }

  function setItem(id: string, patch: Partial<SiteItem>) {
    change(d => ({ ...d, items: d.items.map(i => (i.id === id ? { ...i, ...patch } : i)) }))
  }

  function addItem(kind: ItemKind) {
    const id = uid('i')
    const it: SiteItem = { id, name: kind === 'area' ? 'New area' : kind === 'line' ? 'New line' : 'New count', kind, priceUnit: PRICE_UNITS[kind][0], price: null, color: '#f43f5e' }
    change(d => ({ ...d, items: [...d.items, it] }))
    setActive(id)
  }

  function removeItem(id: string) {
    const n = design.marks.filter(m => m.item === id).length
    if (n && !confirm(`Delete this line item and its ${n} mark${n === 1 ? '' : 's'}?`)) return
    change(d => ({ ...d, items: d.items.filter(i => i.id !== id), marks: d.marks.filter(m => m.item !== id) }))
    if (active === id) setActive(design.items.find(i => i.id !== id)?.id ?? '')
  }

  const csv = () => resultsCsv(name, results)
  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([csv()], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${name.replace(/[^\w -]+/g, '').trim() || 'site-takeoff'}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  async function copyCsv() {
    try { await navigator.clipboard.writeText(csv().replace(/,/g, '\t')); setMsg({ tone: 'ok', text: 'Copied — paste into your estimate sheet.' }) }
    catch { setMsg({ tone: 'warn', text: 'Copy was blocked — use Download CSV.' }) }
  }

  const toolBtn = (t: Tool, label: string, Icon: typeof PenLine, disabled = false, why = '') => (
    <button key={t} onClick={() => { setTool(t); setDraft([]) }} disabled={disabled} title={disabled ? why : label}
      className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs ${tool === t ? 'bg-amber text-navy-950 font-semibold' : 'border border-navy-700 text-ink hover:bg-navy-800'} disabled:opacity-40`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )
  const noAssistWhy = !ortho ? 'Assist runs only on your own drone picture of the site — pick one above.' : rasterErr ?? 'Loading the picture…'

  return (
    <div className="flex h-[calc(100dvh-var(--ht-safe-bottom,0px))] flex-col bg-navy-950 md:flex-row">
      <aside className="order-2 flex max-h-[55dvh] w-full flex-col overflow-y-auto border-t border-navy-800 md:order-1 md:max-h-none md:w-[380px] md:border-r md:border-t-0">
        <div className="space-y-3 p-3 ht-page-inset md:pt-3">
          <div className="flex items-center gap-2">
            <Link href={zone.id ? `/zones/${zone.id}` : '/zones'} className="rounded p-1 text-muted hover:text-ink" aria-label="Back to the site"><ArrowLeft className="h-4 w-4" /></Link>
            <input value={name} disabled={!canEdit} onChange={e => { setName(e.target.value.slice(0, 120)); setDirty(true) }}
              className="min-w-0 flex-1 rounded border border-navy-800 bg-transparent px-2 py-1 text-sm font-semibold text-ink" aria-label="Takeoff name" />
          </div>
          <div className="text-xs text-muted">{zone.name}</div>

          <div className="space-y-1.5 rounded-lg border border-navy-800 p-2">
            <label className="text-[11px] uppercase tracking-wider text-faint">Picture</label>
            <select value={design.imageryId ?? ''} disabled={!canEdit}
              onChange={e => change(d => ({ ...d, imageryId: e.target.value || null }))}
              className="w-full rounded border border-navy-700 bg-navy-950 px-2 py-1 text-sm text-ink">
              {orthos.map(o => <option key={o.id} value={o.id}>{o.takenOn} · {o.caption || (o.source === 'drone' ? 'Drone shot' : 'Site picture')}</option>)}
              <option value="">Satellite basemap — trace by hand only</option>
            </select>
            {orthos.length === 0 && <p className="text-xs text-muted">No placed drone shot on this site yet. Upload one on the site page and place it on the map to use the assist.</p>}
            {ortho && (
              <label className="flex items-center gap-2 text-xs text-muted">Opacity
                <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="flex-1" />
              </label>
            )}
            {!ortho && <p className="text-xs text-muted">On the basemap you trace by hand — the assist runs only on your own drone pictures.</p>}
            {rasterErr && <p className="text-xs text-amber">{rasterErr}</p>}
          </div>

          {canEdit && (
            <div className="space-y-2 rounded-lg border border-navy-800 p-2">
              <div className="flex gap-1">
                {toolBtn('draw', 'Draw', PenLine)}
                {toolBtn('wand', 'Wand', Wand2, !assistOk, noAssistWhy)}
                {toolBtn('stall', 'Stall row', Rows3, !assistOk, noAssistWhy)}
                {toolBtn('select', 'Select', MousePointer2)}
              </div>
              <p className="text-xs text-muted">
                {tool === 'draw' && (item?.kind === 'count' ? 'Tap each one to count it.' : 'Tap the corners; double-tap or Finish to close.')}
                {tool === 'wand' && 'Tap inside a surface (asphalt, turf, a bed). Assist — check and edit what it finds.'}
                {tool === 'stall' && 'Tap the two ends of a line running ACROSS the stall stripes. Assist — check the count.'}
                {tool === 'select' && 'Tap a mark to pick it.'}
              </p>
              {tool === 'wand' && (
                <label className="flex items-center gap-2 text-xs text-muted">Tolerance
                  <input type="range" min={0} max={100} value={tolerance} onChange={e => setTolerance(Number(e.target.value))} className="flex-1" />
                  <span className="w-6 text-right text-ink">{tolerance}</span>
                </label>
              )}
              {tool === 'wand' && lastWand.current && sel === lastWand.current.markId && (
                <button onClick={() => runWand(lastWand.current!.at, lastWand.current!.markId)} disabled={busy}
                  className="w-full rounded-md border border-navy-700 px-2 py-1 text-xs text-ink hover:bg-navy-800">Re-run at tolerance {tolerance}</button>
              )}
              <div className="flex gap-1">
                {draft.length > 0 && tool === 'draw' && <button onClick={finishDraft} className="flex-1 rounded-md bg-teal px-2 py-1 text-xs font-semibold text-navy-950"><Check className="mr-1 inline h-3.5 w-3.5" />Finish</button>}
                {draft.length > 0 && <button onClick={() => setDraft([])} className="flex-1 rounded-md border border-navy-700 px-2 py-1 text-xs text-ink">Cancel</button>}
                <button onClick={undo} disabled={!history.length} className="flex-1 rounded-md border border-navy-700 px-2 py-1 text-xs text-ink disabled:opacity-40"><Undo2 className="mr-1 inline h-3.5 w-3.5" />Undo</button>
              </div>
              {busy && <p className="text-xs text-muted">Reading the picture…</p>}
            </div>
          )}

          {selMark && (() => {
            const it = design.items.find(i => i.id === selMark.item)
            return (
              <div className="space-y-1.5 rounded-lg border border-white/30 p-2 text-xs text-ink">
                <div className="font-semibold">{it?.name} · {selMark.src === 'wand' ? 'wand assist' : selMark.src === 'stall' ? 'stall assist' : 'traced'}</div>
                {it?.kind === 'count' && selMark.count != null && (
                  <label className="flex items-center gap-2">Count
                    <input type="number" min={0} max={10000} value={selMark.count} disabled={!canEdit}
                      onChange={e => { const n = Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))); change(d => ({ ...d, marks: d.marks.map(m => (m.id === selMark.id ? { ...m, count: n } : m)) })) }}
                      className="w-20 rounded border border-navy-700 bg-navy-950 px-1.5 py-1 text-right" />
                  </label>
                )}
                {it?.kind === 'area' && (
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!selMark.minus} disabled={!canEdit}
                    onChange={e => change(d => ({ ...d, marks: d.marks.map(m => (m.id === selMark.id ? { ...m, minus: e.target.checked || undefined } : m)) }))} />
                    Subtract (an island or hole inside)</label>
                )}
                {canEdit && <button onClick={() => { change(d => ({ ...d, marks: d.marks.filter(m => m.id !== selMark.id) })); setSel(null) }} className="text-amber"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Delete mark</button>}
              </div>
            )
          })()}

          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-faint">Line items</div>
            {design.items.map(it => {
              const r = results.items.find(x => x.id === it.id)
              return (
                <div key={it.id} onClick={() => setActive(it.id)}
                  className={`cursor-pointer rounded-lg border px-2 py-1.5 ${active === it.id ? 'border-amber bg-navy-900' : 'border-navy-800 hover:border-navy-600'}`}>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: it.color }} />
                    <input value={it.name} disabled={!canEdit} onChange={e => setItem(it.id, { name: e.target.value.slice(0, 60) })}
                      className="min-w-0 flex-1 bg-transparent text-sm text-ink" aria-label="Line item name" />
                    <span className="text-[10px] uppercase text-faint">{it.kind}</span>
                  </div>
                  {r && r.marks > 0 && <div className="pl-5 text-xs text-muted">{qtyLabel(r)}{r.total != null ? ` · ${money(r.total)}` : ''}</div>}
                  {active === it.id && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted" onClick={e => e.stopPropagation()}>
                      <PriceBox value={it.price} disabled={!canEdit} onValue={v => setItem(it.id, { price: v })} />
                      <span>per</span>
                      <select value={it.priceUnit} disabled={!canEdit}
                        onChange={e => { const u = e.target.value as PriceUnit; setItem(it.id, { priceUnit: u, ...(u === 'cy' && !it.depthIn ? { depthIn: 3 } : {}) }) }}
                        className="rounded border border-navy-700 bg-navy-950 px-1 py-1 text-ink">
                        {PRICE_UNITS[it.kind].map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                      </select>
                      {it.kind === 'area' && (
                        <label className="flex items-center gap-1">depth
                          <input type="number" min={0} max={48} step={0.5} value={it.depthIn ?? ''} disabled={!canEdit}
                            onChange={e => setItem(it.id, { depthIn: e.target.value === '' ? null : Math.max(0, Math.min(48, Number(e.target.value))) })}
                            className="w-14 rounded border border-navy-700 bg-navy-950 px-1 py-1 text-right text-ink" />in
                        </label>
                      )}
                      <input type="color" value={it.color} disabled={!canEdit} onChange={e => setItem(it.id, { color: e.target.value })} className="h-6 w-6 rounded border-0 bg-transparent" aria-label="Colour" />
                      {canEdit && <button onClick={() => removeItem(it.id)} className="text-faint hover:text-amber" aria-label="Delete line item"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  )}
                </div>
              )
            })}
            {canEdit && (
              <div className="flex gap-1 pt-1">
                {(['area', 'line', 'count'] as ItemKind[]).map(k => (
                  <button key={k} onClick={() => addItem(k)} className="flex-1 rounded-md border border-navy-700 px-2 py-1 text-xs text-ink hover:bg-navy-800"><Plus className="mr-0.5 inline h-3 w-3" />{k}</button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1 rounded-lg border border-navy-800 p-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wider text-faint">Total</span>
              <span className="text-lg font-semibold text-ink">{money(results.total)}</span>
            </div>
            {results.unpriced > 0 && <p className="text-xs text-muted">{results.unpriced} line item{results.unpriced === 1 ? ' has' : 's have'} quantities but no price.</p>}
            <div className="flex flex-wrap gap-1 pt-1">
              <button onClick={copyCsv} className="rounded-md border border-navy-700 px-2 py-1 text-xs text-ink hover:bg-navy-800"><Copy className="mr-1 inline h-3.5 w-3.5" />Copy for estimate</button>
              <button onClick={downloadCsv} className="rounded-md border border-navy-700 px-2 py-1 text-xs text-ink hover:bg-navy-800"><Download className="mr-1 inline h-3.5 w-3.5" />CSV</button>
              <Link href={`/takeoff/${takeoff.id}/print`} onClick={e => { if (dirty && !confirm('The printable page shows the last SAVED takeoff. Open it anyway?')) e.preventDefault() }}
                className="rounded-md border border-navy-700 px-2 py-1 text-xs text-ink hover:bg-navy-800"><Printer className="mr-1 inline h-3.5 w-3.5" />Printable</Link>
            </div>
            <p className="text-[11px] text-faint">Measured on the ground (UTM, scale-corrected). Wand and stall counts are assists — check every one.</p>
          </div>

          {canEdit && (
            <div className="flex gap-2 pb-3">
              <button onClick={save} disabled={saving || !dirty} className="flex-1 rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-navy-950 disabled:opacity-50">{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
              <button onClick={remove} className="rounded-lg border border-navy-700 px-3 py-2 text-sm text-muted hover:text-amber" aria-label="Delete takeoff"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
          {msg && <p className={`pb-3 text-xs ${msg.tone === 'ok' ? 'text-teal' : 'text-amber'}`}>{msg.text}</p>}
        </div>
      </aside>
      <main className="relative order-1 min-h-[45dvh] flex-1 md:order-2">
        <SiteTakeoffMap
          ring={zone.ring}
          ortho={ortho ? { url: ortho.url, corners: ortho.corners } : null}
          orthoOpacity={opacity}
          marks={marksFc}
          draft={draft.length ? { coords: draft, color: item?.color ?? '#ffffff', closed: item?.kind === 'area' } : null}
          onClick={onMapClick}
          onDblClick={finishDraft}
          onPick={setSel}
          picking={tool === 'select' || !canEdit}
        />
      </main>
    </div>
  )
}
