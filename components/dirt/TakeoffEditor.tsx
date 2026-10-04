'use client'

/**
 * The dirt takeoff editor — DCG's Kubla process as tabs (Plans · Existing ·
 * Demo · Topsoil · Proposed · Thickness · Results) over the site's real
 * location: the zone's plan sheets sit on the satellite where they belong,
 * lidar fills in the existing ground, and the cut/fill picture redraws live
 * (lib/dirt/worker.ts) as you trace. Save stores the design and the SERVER
 * re-runs it — those are the numbers the company keeps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowLeft, Check, Copy, Eye, EyeOff, Layers, Loader2, Trash2, Undo2, X } from 'lucide-react'
import { saveTakeoffAction, deleteTakeoffAction } from '@/lib/actions/dirt'
import { decodeGround } from '@/lib/dirt/ground-format'
import { boxTooBig, groundBoxFor, type LngLatBox } from '@/lib/dirt/ground-box'
import {
  DEMO_PRESETS, KIND_META, REDUCE_PRESETS, STEPS, TOPSOIL_HINT, allVertices, designGeoJSON, estimateText,
  featureTitle, newId, type Step,
} from '@/lib/dirt/features'
import { CUT_STEPS, FILL_STEPS, NEUTRAL, legendRows } from '@/lib/dirt/heat'
import type { DirtDesign, DirtFeature, DirtKind, DirtResults, GroundGrid } from '@/lib/dirt/takeoff'
import type { PlanSheet, TakeoffFull } from '@/lib/db/dirt'
import type { MapSheet } from './TakeoffMap'

const TakeoffMap = dynamic(() => import('./TakeoffMap'), { ssr: false })

interface Props {
  takeoff: TakeoffFull
  zone: { id: string; name: string; ring: [number, number][] | null }
  sheets: PlanSheet[]
  canEdit: boolean
}

interface Tool {
  kind: DirtKind
  z?: number
  thicknessIn?: number
  label?: string
  offsetIn?: number
}

interface GroundState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  grid: GroundGrid | null
  source?: string
  coverage?: number
  box?: LngLatBox
  error?: string
}

const n0 = (v: number | undefined) => Math.round(Number(v) || 0).toLocaleString()
/** A GeoJSON ring repeats its first point at the end; a traced area doesn't. */
const openRing = (r: [number, number][]): [number, number][] =>
  r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r
const inside = (a: LngLatBox, b: LngLatBox) => a.minLng >= b.minLng && a.minLat >= b.minLat && a.maxLng <= b.maxLng && a.maxLat <= b.maxLat

function normalized(d: DirtDesign | null | undefined): DirtDesign {
  return {
    v: 1,
    features: Array.isArray(d?.features) ? d!.features : [],
    existing: { source: d?.existing?.source === 'traced' ? 'traced' : 'lidar', offsetFt: Number(d?.existing?.offsetFt) || 0 },
    settings: { shrinkPct: Number(d?.settings?.shrinkPct) || 0, truckCy: Number(d?.settings?.truckCy) || 12 },
    ...(d?.sheets ? { sheets: d.sheets } : {}),
  }
}

export default function TakeoffEditor({ takeoff, zone, sheets, canEdit }: Props) {
  const [design, setDesign] = useState<DirtDesign>(() => normalized(takeoff.design))
  const [history, setHistory] = useState<DirtDesign[]>([])
  const [name, setName] = useState(takeoff.name)
  const [dirty, setDirty] = useState(false)
  const [step, setStep] = useState<Step>(sheets.length ? 'plans' : 'existing')
  const [tool, setTool] = useState<Tool | null>(null)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [egZ, setEgZ] = useState<number>(800)
  const [fgZ, setFgZ] = useState<number>(800)
  const [interval, setInterval_] = useState(1)
  const [goingUp, setGoingUp] = useState(true)
  const [sheetState, setSheetState] = useState<Record<string, { visible: boolean; opacity: number }>>(() =>
    Object.fromEntries(sheets.map((s, i) => [s.id, { visible: s.active || i === 0, opacity: 0.8 }])))
  const [ground, setGround] = useState<GroundState>({ status: 'idle', grid: null })
  const [live, setLive] = useState<{ results: DirtResults; heat: { url: string; corners: [number, number][]; bandFt: number } | null } | null>(null)
  const [running, setRunning] = useState(false)
  const [saved, setSaved] = useState<{ results: DirtResults | null; heatUrl: string | null; heatCorners: [number, number][] | null; at: string | null }>({
    results: takeoff.results, heatUrl: takeoff.heatUrl, heatCorners: takeoff.heatCorners, at: takeoff.computedAt,
  })
  const [heatVisible, setHeatVisible] = useState(true)
  const [heatOpacity, setHeatOpacity] = useState(0.75)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [frame, setFrame] = useState<{ key: number; coords: [number, number][] } | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  // ── Design edits ──
  const designRef = useRef(design)
  designRef.current = design
  const commit = useCallback((next: DirtDesign) => {
    setHistory(h => [...h.slice(-59), designRef.current])
    setDesign(next)
    setDirty(true)
  }, [])
  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h
      setDesign(h[h.length - 1])
      setDirty(true)
      return h.slice(0, -1)
    })
  }, [])
  const update = (id: string, patch: Partial<DirtFeature>) =>
    commit({ ...design, features: design.features.map(f => (f.id === id ? { ...f, ...patch } : f)) })
  const remove = (id: string) => {
    commit({ ...design, features: design.features.filter(f => f.id !== id) })
    if (selected === id) setSelected(null)
  }

  // ── Worker: live results ──
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    const w = new Worker(new URL('../../lib/dirt/worker.ts', import.meta.url))
    worker.current = w
    w.onmessage = (e: MessageEvent<{ type: string; seq: number; results?: DirtResults; heat?: { width: number; height: number; rgba: Uint8ClampedArray; corners: [number, number][]; bandFt: number } | null; error?: string }>) => {
      const m = e.data
      if (m.seq !== seq.current) return
      setRunning(false)
      if (m.type !== 'done' || !m.results) return
      let heat: { url: string; corners: [number, number][]; bandFt: number } | null = null
      if (m.heat) {
        const c = document.createElement('canvas')
        c.width = m.heat.width
        c.height = m.heat.height
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.putImageData(new ImageData(new Uint8ClampedArray(m.heat.rgba), m.heat.width, m.heat.height), 0, 0)
          heat = { url: c.toDataURL('image/png'), corners: m.heat.corners, bandFt: m.heat.bandFt }
        }
      }
      setLive({ results: m.results, heat })
    }
    return () => { w.terminate(); worker.current = null }
  }, [])
  useEffect(() => {
    worker.current?.postMessage({ type: 'ground', ground: ground.grid })
  }, [ground.grid])
  useEffect(() => {
    const w = worker.current
    if (!w) return
    const t = setTimeout(() => {
      seq.current++
      setRunning(true)
      w.postMessage({ type: 'run', seq: seq.current, design })
    }, 300)
    return () => clearTimeout(t)
  }, [design, ground.grid])

  // ── Lidar ground ──
  const needBox = useMemo(() => {
    const coords = design.features.flatMap(f => f.coords)
    if (zone.ring) coords.push(...zone.ring)
    return groundBoxFor(coords)
  }, [design.features, zone.ring])
  useEffect(() => {
    if (design.existing.source !== 'lidar' || !needBox) return
    if (ground.box && inside(needBox, ground.box) && ground.status === 'ready') return
    if (boxTooBig(needBox)) { setGround(g => ({ ...g, status: 'error', error: 'This site is more than about 3 km across — trace the existing contours instead.' })); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setGround(g => ({ ...g, status: 'loading', error: undefined }))
      try {
        const r = await fetch(`/api/dirt/ground?bbox=${[needBox.minLng, needBox.minLat, needBox.maxLng, needBox.maxLat].map(v => v.toFixed(6)).join(',')}`, { signal: ctl.signal })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          setGround(g => ({ ...g, status: 'error', error: j.error ?? `Lidar didn't load (${r.status}).` }))
          return
        }
        const d = decodeGround(await r.arrayBuffer())
        if (!d) { setGround(g => ({ ...g, status: 'error', error: "Lidar didn't load — try again." })); return }
        setGround({ status: 'ready', grid: d.header.coverage > 0 ? d.grid : null, source: d.header.source, coverage: d.header.coverage, box: needBox })
      } catch {
        if (!ctl.signal.aborted) setGround(g => ({ ...g, status: 'error', error: "Lidar didn't load — check the connection." }))
      }
    }, 600)
    return () => { clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needBox, design.existing.source])

  // ── Drawing ──
  const toolMeta = tool ? KIND_META[tool.kind] : null
  const startTool = (t: Tool) => { setTool(t); setDraft([]); setSelected(null) }
  const stopTool = () => { setTool(null); setDraft([]) }
  const finish = useCallback(() => {
    if (!tool) return
    const shape = KIND_META[tool.kind].shape
    const pts = draft.filter((p, i) => i === 0 || Math.abs(p[0] - draft[i - 1][0]) > 1e-9 || Math.abs(p[1] - draft[i - 1][1]) > 1e-9)
    if (shape === 'line' && pts.length < 2) return
    if (shape === 'area' && pts.length < 3) return
    const f: DirtFeature = { id: newId(), kind: tool.kind, coords: pts }
    if (tool.z !== undefined) f.z = tool.z
    if (tool.thicknessIn !== undefined) f.thicknessIn = tool.thicknessIn
    if (tool.label) f.label = tool.label
    if (tool.offsetIn !== undefined) f.offsetIn = tool.offsetIn
    // One set of grading limits: a new one replaces the old.
    const keep = tool.kind === 'boundary' ? design.features.filter(x => x.kind !== 'boundary') : design.features
    commit({ ...design, features: [...keep, f] })
    setDraft([])
    if (tool.kind === 'eg_contour' || tool.kind === 'fg_contour') {
      const next = Math.round(((tool.z ?? 0) + (goingUp ? interval : -interval)) * 100) / 100
      setTool({ ...tool, z: next })
      if (tool.kind === 'eg_contour') setEgZ(next); else setFgZ(next)
    }
    if (tool.kind === 'boundary' || tool.kind === 'platform') setTool(null)
  }, [tool, draft, design, commit, goingUp, interval])
  const onMapClick = useCallback((p: [number, number], meta: { closesRing: boolean }) => {
    if (!tool) return
    const shape = KIND_META[tool.kind].shape
    if (shape === 'point') {
      const f: DirtFeature = { id: newId(), kind: tool.kind, coords: [p], z: tool.z }
      commit({ ...designRef.current, features: [...designRef.current.features, f] })
      return
    }
    if (shape === 'area' && meta.closesRing) { finish(); return }
    setDraft(d => [...d, p])
  }, [tool, commit, finish])

  // Keyboard: Esc, Backspace, Enter, Ctrl+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') { if (draft.length) setDraft([]); else if (tool) stopTool(); else setSelected(null) }
      else if (e.key === 'Enter' && tool) finish()
      else if ((e.key === 'Backspace' || e.key === 'Delete') && draft.length) { e.preventDefault(); setDraft(d => d.slice(0, -1)) }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selected && canEdit) { e.preventDefault(); remove(selected) }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && canEdit) { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Unsaved changes guard.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // ── Save ──
  async function save() {
    if (!canEdit || saving) return
    setSaving(true); setMsg(null)
    try {
      const r = await saveTakeoffAction(takeoff.id, { name, design })
      if (!r.ok) { setMsg({ tone: 'warn', text: r.error ?? 'Could not save.' }); return }
      setDirty(false)
      if (r.results) setSaved({ results: r.results, heatUrl: r.heatUrl ?? null, heatCorners: r.heatCorners ?? null, at: r.results.computedAt })
      setMsg(r.error ? { tone: 'warn', text: r.error } : { tone: 'ok', text: 'Saved — the numbers below are the server run.' })
    } catch {
      setMsg({ tone: 'warn', text: 'Could not save — check the connection and try again.' })
    } finally {
      setSaving(false)
    }
  }
  async function del() {
    if (!canEdit) return
    if (!window.confirm(`Delete "${name}"? This can't be undone from here.`)) return
    const r = await deleteTakeoffAction(takeoff.id)
    if (r.ok) window.location.href = `/zones/${zone.id}`
    else setMsg({ tone: 'warn', text: r.error ?? 'Could not delete.' })
  }

  // ── Derived ──
  const fc = useMemo(() => designGeoJSON(design, selected), [design, selected])
  const snapTo = useMemo(() => allVertices(design), [design])
  const mapSheets: MapSheet[] = useMemo(() => sheets.map(s => ({ id: s.id, url: s.url, corners: s.corners, visible: !!sheetState[s.id]?.visible, opacity: sheetState[s.id]?.opacity ?? 0.8 })), [sheets, sheetState])
  const results = live?.results ?? saved.results
  const heat = live?.heat ?? (saved.heatUrl && saved.heatCorners ? { url: saved.heatUrl, corners: saved.heatCorners, bandFt: saved.results?.heatBandFt ?? 1 } : null)
  const sel = design.features.find(f => f.id === selected) ?? null
  const boundary = design.features.find(f => f.kind === 'boundary')
  const byKind = (k: DirtKind) => design.features.filter(f => f.kind === k)
  const legend = heat ? legendRows(heat.bandFt) : null

  const draftColor = toolMeta?.color ?? '#ffffff'
  const toolWords = tool ? `${KIND_META[tool.kind].label}${tool.z !== undefined ? ` at ${tool.z} ft` : ''}${tool.thicknessIn !== undefined ? ` · ${tool.thicknessIn}"` : ''}` : ''

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-navy-950 text-ink" style={{ paddingTop: 'var(--ht-safe-top, 0px)', paddingBottom: 'var(--ht-safe-bottom, 0px)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-navy-800 bg-navy-900 px-3 py-2">
        <Link href={`/zones/${zone.id}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-navy-800 hover:text-ink" aria-label="Back to the site">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={e => { setName(e.target.value); setDirty(true) }}
            disabled={!canEdit}
            maxLength={120}
            aria-label="Takeoff name"
            className="w-full truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink hover:border-navy-700 focus:border-amber focus:outline-none"
          />
          <div className="px-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            {zone.name} · dirt takeoff{running ? ' · running…' : ''}{dirty ? ' · unsaved changes' : saved.at ? ` · saved ${new Date(saved.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
          </div>
        </div>
        {canEdit && (
          <>
            <button onClick={undo} disabled={!history.length} className="hidden h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-navy-800 disabled:opacity-40 sm:flex" title="Undo (Ctrl+Z)">
              <Undo2 className="h-4 w-4" /> Undo
            </button>
            <button onClick={save} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-lg bg-amber px-3 text-sm font-semibold text-navy-950 hover:brightness-110 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? 'Running…' : 'Save'}
            </button>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Map */}
        <div className="relative min-h-[45vh] flex-1">
          <TakeoffMap
            ring={zone.ring}
            sheets={mapSheets}
            features={fc}
            draft={tool && KIND_META[tool.kind].shape !== 'point' ? { shape: KIND_META[tool.kind].shape, coords: draft, color: draftColor } : null}
            heat={heat ? { url: heat.url, corners: heat.corners } : null}
            heatVisible={heatVisible}
            heatOpacity={heatOpacity}
            drawing={!!tool}
            snapTo={snapTo}
            onClick={onMapClick}
            onDblClick={finish}
            onPick={id => { setSelected(id); if (id) { const f = design.features.find(x => x.id === id); if (f) setStep(KIND_META[f.kind].step) } }}
            frame={frame}
          />
          {tool && (
            <div className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-navy-700 bg-navy-900/95 px-3 py-2 text-xs shadow-lg">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: draftColor }} />
              <span className="font-semibold">{toolWords}</span>
              <span className="text-muted">
                {KIND_META[tool.kind].shape === 'point' ? 'Tap to place · change the elevation between taps' : `Tap to add points · ${KIND_META[tool.kind].shape === 'area' ? 'tap the first point or ' : ''}double-tap to finish`}
              </span>
              {KIND_META[tool.kind].shape !== 'point' && (
                <>
                  <button onClick={() => setDraft(d => d.slice(0, -1))} disabled={!draft.length} className="rounded-md px-2 py-1 text-muted hover:bg-navy-800 disabled:opacity-40">Back a point</button>
                  <button onClick={finish} disabled={draft.length < (KIND_META[tool.kind].shape === 'area' ? 3 : 2)} className="rounded-md bg-amber/90 px-2 py-1 font-semibold text-navy-950 disabled:opacity-40">Finish</button>
                </>
              )}
              <button onClick={stopTool} className="rounded-md px-2 py-1 text-muted hover:bg-navy-800" aria-label="Stop drawing"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {heat && heatVisible && legend && (
            <div className="pointer-events-none absolute bottom-9 right-2 z-10 w-[min(15rem,calc(100%-1rem))] rounded-lg border border-navy-700 bg-navy-900/90 px-2.5 py-1.5 text-[10px] shadow">
              <div className="flex gap-0.5" aria-hidden>
                {[...legend.cut].reverse().map(([l, c]) => <span key={`c${l}`} className="h-2 flex-1 rounded-sm" style={{ background: c }} title={`Cut ${l}`} />)}
                <span className="h-2 flex-1 rounded-sm" style={{ background: NEUTRAL }} title="Within 0.1 ft" />
                {legend.fill.map(([l, c]) => <span key={`f${l}`} className="h-2 flex-1 rounded-sm" style={{ background: c }} title={`Fill ${l}`} />)}
              </div>
              <div className="mt-0.5 flex justify-between text-muted">
                <span><b className="text-ink">Cut</b> {legend.cut[4][0]}</span>
                <span>each step {heat.bandFt} ft</span>
                <span><b className="text-ink">Fill</b> {legend.fill[4][0]}</span>
              </div>
            </div>
          )}
        </div>

        {/* Panel */}
        <div className="flex max-h-[55vh] min-h-0 w-full flex-col border-t border-navy-800 bg-navy-900 md:max-h-none md:w-[390px] md:border-l md:border-t-0">
          <div className="flex gap-1 overflow-x-auto border-b border-navy-800 px-2 py-2 md:flex-wrap md:overflow-visible" role="tablist">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={step === s.key}
                onClick={() => setStep(s.key)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs ${step === s.key ? 'bg-amber text-navy-950 font-semibold' : 'text-muted hover:bg-navy-800'}`}
              >
                <span className="mr-1 font-mono opacity-60">{i + 1}</span>{s.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm">
            {msg && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${msg.tone === 'ok' ? 'border-teal-700 bg-teal-950/40 text-teal-200' : 'border-amber/50 bg-amber/10 text-amber'}`}>{msg.text}</div>
            )}
            {!canEdit && <div className="rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-xs text-muted">View only — your role can see this takeoff but not change it.</div>}

            {sel && (
              <SelectedCard f={sel} canEdit={canEdit} onChange={p => update(sel.id, p)} onDelete={() => remove(sel.id)} onClose={() => setSelected(null)} />
            )}

            {step === 'plans' && (
              <Section title="Plan sheets on the map" hint="Sheets placed on the site show here in their real location. Trace on top of them.">
                {sheets.length === 0 && (
                  <p className="text-xs text-muted">No plan sheets placed for this site yet. <Link className="text-amber underline" href={`/zones/${zone.id}`}>Add the PDF on the site page</Link>, place it once, and it lines up here.</p>
                )}
                {sheets.map(s => (
                  <div key={s.id} className="rounded-lg border border-navy-800 bg-navy-950 p-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSheetState(st => ({ ...st, [s.id]: { ...(st[s.id] ?? { opacity: 0.8 }), visible: !st[s.id]?.visible } }))} className="text-muted hover:text-ink" aria-label="Show or hide">
                        {sheetState[s.id]?.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1 truncate text-xs">{s.caption || s.category || 'Plan sheet'}{s.category && s.caption ? <span className="text-faint"> · {s.category}</span> : null}</div>
                      <button onClick={() => setFrame({ key: Date.now(), coords: s.corners })} className="text-[11px] text-amber">Zoom</button>
                    </div>
                    <input type="range" min={0.1} max={1} step={0.05} value={sheetState[s.id]?.opacity ?? 0.8}
                      onChange={e => setSheetState(st => ({ ...st, [s.id]: { visible: st[s.id]?.visible ?? true, opacity: Number(e.target.value) } }))}
                      className="mt-1 w-full accent-amber" aria-label="Sheet opacity" />
                  </div>
                ))}
                <p className="text-[11px] text-faint">Kubla needs each sheet scaled and stacked by hand; here a placed sheet is already where it belongs, so the existing topo, grading and site plans line up with each other and with the lidar.</p>
              </Section>
            )}

            {step === 'existing' && (
              <Section title="Existing ground" hint="Lidar fills this in by itself. Trace the plan's existing contours when the plan uses its own datum or the site changed since the flight.">
                <div className="flex gap-1 rounded-lg bg-navy-950 p-1">
                  {(['lidar', 'traced'] as const).map(src => (
                    <button key={src} disabled={!canEdit}
                      onClick={() => commit({ ...design, existing: { ...design.existing, source: src } })}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs ${design.existing.source === src ? 'bg-navy-700 font-semibold text-ink' : 'text-muted'}`}>
                      {src === 'lidar' ? 'USGS lidar (auto)' : 'Traced contours'}
                    </button>
                  ))}
                </div>
                {design.existing.source === 'lidar' && (
                  <div className="space-y-2 rounded-lg border border-navy-800 bg-navy-950 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      {ground.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber" />}
                      <span className={ground.status === 'error' ? 'text-amber' : 'text-ink'}>
                        {ground.status === 'loading' ? 'Reading USGS lidar under the site…' : ground.status === 'error' ? ground.error : ground.source ?? 'Waiting for the site outline…'}
                      </span>
                    </div>
                    {ground.status === 'ready' && ground.coverage !== undefined && ground.coverage < 0.99 && (
                      <div className="text-amber">Covers {Math.round(ground.coverage * 100)}% of the site.</div>
                    )}
                    <label className="flex items-center gap-2">
                      <span className="text-muted">Datum offset</span>
                      <input type="number" step="0.1" disabled={!canEdit} value={design.existing.offsetFt}
                        onChange={e => commit({ ...design, existing: { ...design.existing, offsetFt: Number(e.target.value) || 0 } })}
                        className="w-24 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" />
                      <span className="text-muted">ft</span>
                    </label>
                    {results?.datum.planExistingMinusLidarFt != null && Math.abs(results.datum.planExistingMinusLidarFt - design.existing.offsetFt) > 0.5 && canEdit && (
                      <button className="text-left text-amber underline"
                        onClick={() => commit({ ...design, existing: { ...design.existing, offsetFt: results.datum.planExistingMinusLidarFt as number } })}>
                        Your traced existing grades say {results.datum.planExistingMinusLidarFt.toFixed(1)} ft — use that offset
                      </button>
                    )}
                    <p className="text-faint">Lidar is NAVD88 feet, flown before construction. Plans on an assumed datum need the offset: trace two or three existing spot grades below and it measures it for you.</p>
                  </div>
                )}
                {canEdit && (
                  <ElevationTools z={egZ} setZ={setEgZ} interval={interval} setInterval={setInterval_} goingUp={goingUp} setGoingUp={setGoingUp}
                    onContour={() => startTool({ kind: 'eg_contour', z: egZ })}
                    onSpot={() => startTool({ kind: 'eg_spot', z: egZ })}
                    active={tool?.kind === 'eg_contour' || tool?.kind === 'eg_spot'} kindWord="existing" />
                )}
                <FeatureList items={[...byKind('eg_contour'), ...byKind('eg_spot')]} selected={selected} onPick={setSelected} />
              </Section>
            )}

            {step === 'demo' && (
              <Section title="Demo" hint="Lower existing by the assumed thickness of each demo type. Write down what you assumed — it rides along in the copied numbers.">
                {canEdit && <PresetButtons presets={DEMO_PRESETS} onPick={p => startTool({ kind: 'demo', label: p.label, thicknessIn: p.thicknessIn })} activeLabel={tool?.kind === 'demo' ? tool.label : undefined} />}
                <FeatureList items={byKind('demo')} selected={selected} onPick={setSelected} />
              </Section>
            )}

            {step === 'topsoil' && (
              <Section title="Topsoil strip" hint={TOPSOIL_HINT}>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 5, 6].map(t => (
                      <button key={t} onClick={() => startTool({ kind: 'topsoil', thicknessIn: t })}
                        className={`rounded-lg border px-3 py-1.5 text-xs ${tool?.kind === 'topsoil' && tool.thicknessIn === t ? 'border-amber text-amber' : 'border-navy-700 text-ink hover:bg-navy-800'}`}>
                        {`${t}" area`}
                      </button>
                    ))}
                  </div>
                )}
                <FeatureList items={byKind('topsoil')} selected={selected} onPick={setSelected} />
              </Section>
            )}

            {step === 'proposed' && (
              <Section title="Proposed grading" hint="Draw the grading limits where the proposed grading meets existing, then trace the proposed contours and spot grades inside them.">
                {canEdit && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => startTool({ kind: 'boundary' })} className={`rounded-lg border px-3 py-1.5 text-xs ${tool?.kind === 'boundary' ? 'border-amber text-amber' : 'border-navy-700 hover:bg-navy-800'}`}>
                        {boundary ? 'Redraw grading limits' : 'Draw grading limits'}
                      </button>
                      {zone.ring && zone.ring.length >= 3 && (
                        <button onClick={() => commit({ ...design, features: [...design.features.filter(f => f.kind !== 'boundary'), { id: newId('b'), kind: 'boundary', coords: openRing(zone.ring!) }] })}
                          className="rounded-lg border border-navy-700 px-3 py-1.5 text-xs hover:bg-navy-800">Use the site zone</button>
                      )}
                    </div>
                    <ElevationTools z={fgZ} setZ={setFgZ} interval={interval} setInterval={setInterval_} goingUp={goingUp} setGoingUp={setGoingUp}
                      onContour={() => startTool({ kind: 'fg_contour', z: fgZ })}
                      onSpot={() => startTool({ kind: 'fg_spot', z: fgZ })}
                      active={tool?.kind === 'fg_contour' || tool?.kind === 'fg_spot'} kindWord="proposed" />
                    <PadTool onStart={(z, off, label) => startTool({ kind: 'platform', z, offsetIn: off, label })} active={tool?.kind === 'platform'} />
                  </div>
                )}
                {!boundary && <p className="text-xs text-amber">No grading limits yet — cut and fill need them.</p>}
                <FeatureList items={[...byKind('boundary'), ...byKind('platform'), ...byKind('fg_contour'), ...byKind('fg_spot')]} selected={selected} onPick={setSelected} />
              </Section>
            )}

            {step === 'thickness' && (
              <Section title="Construction thickness" hint="Paving, sidewalks and slabs sit on a section — the dirt stops at its bottom. Each edge is an exact vertical wall (Kubla's 0:0.01 batter, without the sliver). The one drawn last wins where areas overlap.">
                {canEdit && <PresetButtons presets={REDUCE_PRESETS} onPick={p => startTool({ kind: 'reduce', label: p.label, thicknessIn: p.thicknessIn })} activeLabel={tool?.kind === 'reduce' ? tool.label : undefined} />}
                <FeatureList items={byKind('reduce')} selected={selected} onPick={setSelected} />
              </Section>
            )}

            {step === 'results' && (
              <Results results={results} live={!!live} dirty={dirty} saved={saved.results} name={name}
                design={design} canEdit={canEdit} onSettings={s => commit({ ...design, settings: { ...design.settings, ...s } })}
                heatVisible={heatVisible} setHeatVisible={setHeatVisible} heatOpacity={heatOpacity} setHeatOpacity={setHeatOpacity}
                copied={copied} onCopy={async (text) => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ } }} />
            )}

            {step !== 'results' && results && (
              <button onClick={() => setStep('results')} className="w-full rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 text-left text-xs">
                <span className="font-mono uppercase tracking-[0.1em] text-faint">Live</span>{' '}
                <span className="text-ink">Cut {n0(results.cutCy)} · Fill {n0(results.fillCy)} · {results.exportCy > 0 ? `Export ${n0(results.exportCy)}` : `Import ${n0(results.importCy)}`} CY</span>
                <span className="text-muted"> · Topsoil {n0(results.topsoil.cy)} CY</span>
              </button>
            )}

            {canEdit && (
              <div className="flex items-center justify-between border-t border-navy-800 pt-3 text-xs">
                <span className="text-faint">{design.features.length} traced feature{design.features.length === 1 ? '' : 's'}</span>
                <button onClick={del} className="flex items-center gap-1 text-red-300 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /> Delete takeoff</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{title}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {children}
    </section>
  )
}

function PresetButtons({ presets, onPick, activeLabel }: { presets: { label: string; thicknessIn: number; note?: string }[]; onPick: (p: { label: string; thicknessIn: number }) => void; activeLabel?: string }) {
  const [custom, setCustom] = useState({ label: '', t: 6 })
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {presets.map(p => (
          <button key={p.label} onClick={() => onPick(p)} title={p.note}
            className={`rounded-lg border px-2.5 py-2 text-left text-xs ${activeLabel === p.label ? 'border-amber text-amber' : 'border-navy-700 hover:bg-navy-800'}`}>
            <div className="font-semibold">{p.label}</div>
            <div className="text-muted">{`${p.thicknessIn}"${p.note ? ` · ${p.note}` : ''}`}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <input value={custom.label} onChange={e => setCustom(c => ({ ...c, label: e.target.value }))} placeholder="Other type" maxLength={40}
          className="min-w-0 flex-1 rounded border border-navy-700 bg-navy-950 px-2 py-1.5" />
        <input type="number" min={0} max={240} step={0.5} value={custom.t} onChange={e => setCustom(c => ({ ...c, t: Number(e.target.value) || 0 }))}
          className="w-16 rounded border border-navy-700 bg-navy-950 px-2 py-1.5 text-right" aria-label="Thickness, inches" />
        <span className="text-muted">in</span>
        <button onClick={() => onPick({ label: custom.label.trim() || 'Custom', thicknessIn: custom.t })} className="rounded-lg border border-navy-700 px-2.5 py-1.5 hover:bg-navy-800">Draw</button>
      </div>
    </div>
  )
}

function ElevationTools(p: {
  z: number; setZ: (n: number) => void; interval: number; setInterval: (n: number) => void; goingUp: boolean; setGoingUp: (b: boolean) => void
  onContour: () => void; onSpot: () => void; active: boolean; kindWord: string
}) {
  return (
    <div className={`space-y-2 rounded-lg border p-2 ${p.active ? 'border-amber/60' : 'border-navy-800'} bg-navy-950`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted">Elevation</span>
          <input type="number" step="0.1" value={p.z} onChange={e => p.setZ(Number(e.target.value) || 0)}
            className="w-24 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" />
          <span className="text-muted">ft</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">then</span>
          <select value={p.goingUp ? 'up' : 'down'} onChange={e => p.setGoingUp(e.target.value === 'up')} className="rounded border border-navy-700 bg-navy-900 px-1 py-1">
            <option value="up">+</option><option value="down">−</option>
          </select>
          <input type="number" min={0.1} step={0.5} value={p.interval} onChange={e => p.setInterval(Math.max(0.1, Number(e.target.value) || 1))}
            className="w-14 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" aria-label="Contour interval" />
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={p.onContour} className="flex-1 rounded-lg bg-navy-800 px-2 py-1.5 text-xs hover:bg-navy-700">Trace {p.kindWord} contour</button>
        <button onClick={p.onSpot} className="flex-1 rounded-lg bg-navy-800 px-2 py-1.5 text-xs hover:bg-navy-700">Place spot grade</button>
      </div>
      <p className="text-[11px] text-faint">After each contour the elevation steps by the interval, so you can trace them one after another.</p>
    </div>
  )
}

function PadTool({ onStart, active }: { onStart: (z: number, offsetIn: number, label: string) => void; active: boolean }) {
  const [z, setZ] = useState(800)
  const [off, setOff] = useState(-8)
  return (
    <div className={`space-y-2 rounded-lg border p-2 ${active ? 'border-amber/60' : 'border-navy-800'} bg-navy-950 text-xs`}>
      <div className="font-semibold">Building pad</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5"><span className="text-muted">Finished floor</span>
          <input type="number" step="0.01" value={z} onChange={e => setZ(Number(e.target.value) || 0)} className="w-24 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" /> ft</label>
        <label className="flex items-center gap-1.5"><span className="text-muted">Subgrade</span>
          <input type="number" step="0.5" value={off} onChange={e => setOff(Number(e.target.value) || 0)} className="w-16 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" /> in</label>
      </div>
      <button onClick={() => onStart(z, off, 'Building')} className="w-full rounded-lg bg-navy-800 px-2 py-1.5 hover:bg-navy-700">Draw the pad</button>
      <p className="text-[11px] text-faint">{'Slab + stone under the finished floor — −8" when the plans don\'t say.'}</p>
    </div>
  )
}

function FeatureList({ items, selected, onPick }: { items: DirtFeature[]; selected: string | null; onPick: (id: string) => void }) {
  if (!items.length) return null
  return (
    <ul className="divide-y divide-navy-800 rounded-lg border border-navy-800">
      {items.map(f => (
        <li key={f.id}>
          <button onClick={() => onPick(f.id)} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${selected === f.id ? 'bg-navy-800' : 'hover:bg-navy-800/60'}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_META[f.kind].color }} />
            <span className="min-w-0 flex-1 truncate">{featureTitle(f)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SelectedCard({ f, canEdit, onChange, onDelete, onClose }: { f: DirtFeature; canEdit: boolean; onChange: (p: Partial<DirtFeature>) => void; onDelete: () => void; onClose: () => void }) {
  const meta = KIND_META[f.kind]
  const hasZ = f.kind === 'eg_contour' || f.kind === 'fg_contour' || f.kind === 'eg_spot' || f.kind === 'fg_spot' || f.kind === 'platform'
  const hasT = f.kind === 'demo' || f.kind === 'topsoil' || f.kind === 'reduce'
  const hasLabel = f.kind === 'demo' || f.kind === 'reduce' || f.kind === 'platform'
  return (
    <div className="space-y-2 rounded-lg border border-amber/50 bg-navy-950 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
        <span className="flex-1 font-semibold">{meta.label}</span>
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
      </div>
      {hasLabel && (
        <label className="flex items-center gap-2"><span className="w-20 text-muted">Type</span>
          <input value={f.label ?? ''} disabled={!canEdit} maxLength={60} onChange={e => onChange({ label: e.target.value })} className="min-w-0 flex-1 rounded border border-navy-700 bg-navy-900 px-2 py-1" /></label>
      )}
      {hasZ && (
        <label className="flex items-center gap-2"><span className="w-20 text-muted">{f.kind === 'platform' ? 'Finished floor' : 'Elevation'}</span>
          <input type="number" step="0.01" disabled={!canEdit} value={f.z ?? ''} onChange={e => onChange({ z: Number(e.target.value) })} className="w-28 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" /> ft</label>
      )}
      {f.kind === 'platform' && (
        <label className="flex items-center gap-2"><span className="w-20 text-muted">Subgrade</span>
          <input type="number" step="0.5" disabled={!canEdit} value={f.offsetIn ?? -8} onChange={e => onChange({ offsetIn: Number(e.target.value) })} className="w-20 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" /> in</label>
      )}
      {hasT && (
        <label className="flex items-center gap-2"><span className="w-20 text-muted">Thickness</span>
          <input type="number" step="0.5" min={0} max={240} disabled={!canEdit} value={f.thicknessIn ?? ''} onChange={e => onChange({ thicknessIn: Number(e.target.value) })} className="w-20 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" /> in</label>
      )}
      <div className="text-faint">{f.coords.length} point{f.coords.length === 1 ? '' : 's'}</div>
      {canEdit && <button onClick={onDelete} className="flex items-center gap-1 text-red-300 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
    </div>
  )
}

function Results(p: {
  results: DirtResults | null; live: boolean; dirty: boolean; saved: DirtResults | null; name: string; design: DirtDesign; canEdit: boolean
  onSettings: (s: Partial<DirtDesign['settings']>) => void
  heatVisible: boolean; setHeatVisible: (b: boolean) => void; heatOpacity: number; setHeatOpacity: (n: number) => void
  copied: boolean; onCopy: (t: string) => void
}) {
  const r = p.results
  if (!r) return <p className="text-xs text-muted">Trace the grading limits and proposed grades — the numbers show up here as you go.</p>
  const big = (label: string, v: number, sub?: string) => (
    <div className="rounded-lg border border-navy-800 bg-navy-950 p-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{n0(v)} <span className="text-xs font-normal text-muted">CY</span></div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-faint">{p.dirty ? 'Live preview — Save to keep these numbers' : p.saved ? 'Saved run (server)' : 'Live preview'}</span>
        <button onClick={() => p.onCopy(estimateText(r, p.name))} className="flex items-center gap-1 text-amber"><Copy className="h-3.5 w-3.5" />{p.copied ? 'Copied' : 'Copy for estimate'}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {big('Topsoil', r.topsoil.cy, `${n0(r.topsoil.sf)} SF`)}
        {big('Onsite', r.onsiteCy, 'cut placed back as fill')}
        {big('Cut', r.cutCy, `deepest ${r.maxCutFt.toFixed(1)} ft`)}
        {big('Fill', r.fillCy, `${r.shrinkPct ? `${n0(r.fillAdjCy)} CY with ${r.shrinkPct}% shrink · ` : ''}deepest ${r.maxFillFt.toFixed(1)} ft`)}
      </div>
      <div className={`rounded-lg border p-2.5 ${r.exportCy > 0 ? 'border-red-400/40 bg-red-950/20' : 'border-sky-400/40 bg-sky-950/20'}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{r.exportCy > 0 ? 'Export' : 'Import'}</div>
        <div className="text-xl font-semibold tabular-nums">{n0(r.exportCy > 0 ? r.exportCy : r.importCy)} <span className="text-xs font-normal text-muted">CY · {r.loads} loads @ {r.truckCy} CY</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5"><span className="text-muted">Shrink</span>
          <input type="number" min={0} max={60} step={1} disabled={!p.canEdit} value={p.design.settings.shrinkPct} onChange={e => p.onSettings({ shrinkPct: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} className="w-14 rounded border border-navy-700 bg-navy-950 px-2 py-1 text-right" />%</label>
        <label className="flex items-center gap-1.5"><span className="text-muted">Truck</span>
          <input type="number" min={1} max={40} step={1} disabled={!p.canEdit} value={p.design.settings.truckCy} onChange={e => p.onSettings({ truckCy: Math.max(1, Math.min(40, Number(e.target.value) || 12)) })} className="w-14 rounded border border-navy-700 bg-navy-950 px-2 py-1 text-right" />CY</label>
      </div>
      {(r.demo.length > 0 || r.reduce.length > 0 || r.platforms.length > 0) && (
        <table className="w-full text-xs">
          <tbody className="divide-y divide-navy-800">
            {r.demo.map(d => <tr key={`d${d.label}${d.thicknessIn}`}><td className="py-1 text-muted">{`Demo ${d.label} ${d.thicknessIn}"`}</td><td className="py-1 text-right tabular-nums">{n0(d.sf)} SF</td><td className="py-1 text-right tabular-nums">{n0(d.cy)} CY</td></tr>)}
            {r.reduce.map(d => <tr key={`r${d.label}${d.thicknessIn}`}><td className="py-1 text-muted">{`${d.label} ${d.thicknessIn}"`}</td><td className="py-1 text-right tabular-nums">{n0(d.sf)} SF</td><td /></tr>)}
            {r.platforms.map((d, i) => <tr key={`p${i}`}><td className="py-1 text-muted">{d.label} pad · FFE {d.ffeFt}</td><td className="py-1 text-right tabular-nums">{n0(d.sf)} SF</td><td className="py-1 text-right tabular-nums">sub {d.subgradeFt}</td></tr>)}
          </tbody>
        </table>
      )}
      <div className="space-y-1.5 rounded-lg border border-navy-800 bg-navy-950 p-2 text-xs">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-muted" />
          <span className="flex-1">Cut / fill on the map</span>
          <button onClick={() => p.setHeatVisible(!p.heatVisible)} className="text-amber">{p.heatVisible ? 'Hide' : 'Show'}</button>
        </div>
        <input type="range" min={0.2} max={1} step={0.05} value={p.heatOpacity} onChange={e => p.setHeatOpacity(Number(e.target.value))} className="w-full accent-amber" aria-label="Cut/fill opacity" />
        <div className="flex gap-0.5">{[...CUT_STEPS].reverse().map(c => <span key={c} className="h-2 flex-1 rounded-sm" style={{ background: c }} />)}<span className="h-2 flex-1 rounded-sm" style={{ background: NEUTRAL }} />{FILL_STEPS.map(c => <span key={c} className="h-2 flex-1 rounded-sm" style={{ background: c }} />)}</div>
        <div className="flex justify-between text-[10px] text-faint"><span>deep cut</span><span>no change</span><span>deep fill</span></div>
      </div>
      <div className="text-[11px] text-faint">
        Grading limits {n0(r.boundarySf)} SF · existing: {r.existing.detail}{r.existing.offsetFt ? ` (offset ${r.existing.offsetFt} ft)` : ''}
        {r.datum.proposedMinusExistingFt != null ? ` · proposed sits ${r.datum.proposedMinusExistingFt > 0 ? '+' : ''}${r.datum.proposedMinusExistingFt.toFixed(1)} ft from existing on average` : ''}
      </div>
      {r.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber/40 bg-amber/5 p-2 text-xs text-amber">
          {r.warnings.map(w => <li key={w}>• {w}</li>)}
        </ul>
      )}
    </div>
  )
}
