'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Maximize2, RotateCcw } from 'lucide-react'
import { subCorners, type Crop } from '@/lib/plans/crop'
import { pageUpBearing } from '@/lib/plans/north'
import { toLocal, type LngLat, type Corners4 } from '@/lib/plans/match'

export interface StitchSheet {
  id: string
  number: string
  title: string | null
  discipline: string | null
  url: string
  bounds: Corners4
  crop: Crop | null
  /** Placed by a guess ("check it") rather than by its drawing, a grid or a hand. */
  check: boolean
}

type P = [number, number]

/**
 * Every placed sheet of a site, cut to its drawing and laid where it sits —
 * one continuous plan (Brian, Nov 9: the Haywood quadrants, the Clemson road
 * sheets). Pictures are multiplied onto white, so overlapping sheets show
 * through each other at the matchlines like a light table. Plan up = the
 * biggest sheet reads upright; North up turns it to the compass.
 */
export function StitchView({ zone, sheets }: { zone: { id: string; name: string }; sheets: StitchSheet[] }) {
  const disciplines = useMemo(() => Array.from(new Set(sheets.map((s) => s.discipline ?? '—'))).sort(), [sheets])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [northUp, setNorthUp] = useState(false)
  const shown = sheets.filter((s) => !hidden.has(s.id))

  // Ground frame: local metres around the sheets' middle.
  const origin = useMemo<LngLat>(() => {
    const all = sheets.flatMap((s) => s.bounds)
    return all.length ? [all.reduce((t, p) => t + p[0], 0) / all.length, all.reduce((t, p) => t + p[1], 0) / all.length] : [0, 0]
  }, [sheets])
  // Plan up: the turn that stands the biggest sheet upright.
  const planTurn = useMemo(() => {
    const big = [...sheets].sort((a, b) => area(b.bounds, origin) - area(a.bounds, origin))[0]
    return big ? (pageUpBearing(big.bounds) * Math.PI) / 180 : 0
  }, [sheets, origin])
  const turn = northUp ? 0 : planTurn

  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const imgs = useRef(new Map<string, HTMLImageElement>())
  const [loaded, setLoaded] = useState(0)
  const [view, setView] = useState<{ s: number; x: number; y: number } | null>(null)

  // Quads in the turned ground frame (metres, y up).
  const quads = useMemo(() => shown.map((s) => {
    const c = s.crop?.on !== false && s.crop ? subCorners(s.bounds, s.crop) : s.bounds
    const rot = (p: LngLat): P => {
      const [x, y] = toLocal(origin, p)
      const ct = Math.cos(turn), st = Math.sin(turn)
      return [ct * x - st * y, st * x + ct * y]
    }
    return { s, q: c.map(rot) as [P, P, P, P] }
  }), [shown, origin, turn])

  // Load pictures once.
  useEffect(() => {
    for (const s of sheets) {
      if (imgs.current.has(s.id)) continue
      const im = new Image()
      im.onload = () => setLoaded((n) => n + 1)
      im.src = s.url
      imgs.current.set(s.id, im)
    }
  }, [sheets])

  function fit() {
    const el = wrap.current
    if (!el || !quads.length) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const { q } of quads) for (const [x, y] of q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    const W = el.clientWidth, H = el.clientHeight
    const s = 0.92 * Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0))
    setView({ s, x: W / 2 - s * (x0 + x1) / 2, y: H / 2 + s * (y0 + y1) / 2 })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit() }, [northUp, sheets.length])

  // Draw.
  useEffect(() => {
    const el = wrap.current, cv = canvas.current
    if (!el || !cv || !view) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = el.clientWidth, H = el.clientHeight
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    cv.style.width = `${W}px`; cv.style.height = `${H}px`
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    const scr = ([x, y]: P): P => [view.x + view.s * x, view.y - view.s * y]
    ctx.globalCompositeOperation = 'multiply'
    for (const { s, q } of quads) {
      const im = imgs.current.get(s.id)
      if (!im?.complete || !im.naturalWidth) continue
      const iw = im.naturalWidth, ih = im.naturalHeight
      const cr = s.crop?.on !== false && s.crop ? s.crop : { x0: 0, y0: 0, x1: 1, y1: 1 }
      const sx0 = cr.x0 * iw, sy0 = cr.y0 * ih, sx1 = cr.x1 * iw, sy1 = cr.y1 * ih
      const [tl, tr, br, bl] = q.map(scr)
      // Affine: image px → screen, fixed by TL, TR, BL of the crop.
      const ax = (tr[0] - tl[0]) / (sx1 - sx0), ay = (tr[1] - tl[1]) / (sx1 - sx0)
      const bx = (bl[0] - tl[0]) / (sy1 - sy0), by = (bl[1] - tl[1]) / (sy1 - sy0)
      ctx.save()
      ctx.beginPath(); ctx.moveTo(tl[0], tl[1]); ctx.lineTo(tr[0], tr[1]); ctx.lineTo(br[0], br[1]); ctx.lineTo(bl[0], bl[1]); ctx.closePath(); ctx.clip()
      ctx.setTransform(dpr * ax, dpr * ay, dpr * bx, dpr * by, dpr * (tl[0] - ax * sx0 - bx * sy0), dpr * (tl[1] - ay * sx0 - by * sy0))
      ctx.globalAlpha = s.check ? 0.55 : 1
      ctx.drawImage(im, 0, 0)
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'source-over'
    // Sheet outlines + numbers (thin, so matchlines read).
    ctx.font = '600 11px ui-monospace, monospace'
    for (const { s, q } of quads) {
      const pts = q.map(scr)
      ctx.strokeStyle = s.check ? 'rgba(255,158,22,0.9)' : 'rgba(20,110,160,0.55)'
      ctx.lineWidth = 1
      ctx.setLineDash(s.check ? [5, 4] : [])
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke()
      const [x, y] = pts[0]
      ctx.fillStyle = 'rgba(0,21,35,0.85)'
      const label = s.number + (s.check ? ' · check' : '')
      const w = ctx.measureText(label).width + 8
      ctx.fillRect(x + 2, y + 2, w, 16)
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + 6, y + 14)
    }
    ctx.setLineDash([])
  }, [view, quads, loaded])

  // Pan / pinch / wheel.
  const ptrs = useRef(new Map<number, P>())
  const last = useRef<{ d: number; c: P } | null>(null)
  function onDown(e: React.PointerEvent) { (e.target as Element).setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, [e.clientX, e.clientY]); last.current = null }
  function onUp(e: React.PointerEvent) { ptrs.current.delete(e.pointerId); last.current = null }
  function onMove(e: React.PointerEvent) {
    if (!view || !ptrs.current.has(e.pointerId)) return
    const prev = ptrs.current.get(e.pointerId)!
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    const all = Array.from(ptrs.current.values())
    if (all.length === 1) { setView({ ...view, x: view.x + e.clientX - prev[0], y: view.y + e.clientY - prev[1] }); return }
    const [a, b] = all
    const r = wrap.current!.getBoundingClientRect()
    const c: P = [(a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top], d = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (last.current) zoomAt(c, d / last.current.d, [c[0] - last.current.c[0], c[1] - last.current.c[1]])
    last.current = { d, c }
  }
  function zoomAt(c: P, k: number, pan: P = [0, 0]) {
    setView((v) => {
      if (!v) return v
      const s = Math.max(0.01, Math.min(400, v.s * k)), f = s / v.s
      return { s, x: c[0] - (c[0] - v.x) * f + pan[0], y: c[1] - (c[1] - v.y) * f + pan[1] }
    })
  }
  function onWheel(e: React.WheelEvent) {
    const r = wrap.current!.getBoundingClientRect()
    zoomAt([e.clientX - r.left, e.clientY - r.top], Math.exp(-e.deltaY * 0.0015))
  }

  const scaleWords = view ? (() => { const ft = 100 / view.s * 3.2808; const nice = [10, 20, 50, 100, 200, 500, 1000, 2000].find((n) => n >= ft) ?? 5000; return { ft: nice, px: nice / 3.2808 * view.s } })() : null

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--ht-safe-top,0px)-54px-var(--ht-safe-bottom,0px))] md:h-[calc(100dvh-40px)]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-navy-800 flex-wrap">
        <Link href={`/plans/${zone.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {zone.name}</Link>
        <span className="font-display font-bold text-ink text-sm">· Whole site</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setNorthUp((x) => !x)} className="rounded-lg border border-navy-700 px-2 py-1 text-[12px] text-muted hover:text-ink">
          {northUp ? 'Plan up' : 'North up'}
        </button>
        <button type="button" onClick={fit} aria-label="Fit" className="rounded-lg border border-navy-700 p-1.5 text-muted hover:text-ink"><Maximize2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-navy-800 overflow-x-auto text-[11.5px]">
        {disciplines.length > 1 && disciplines.map((d) => {
          const ids = sheets.filter((s) => (s.discipline ?? '—') === d).map((s) => s.id)
          const on = ids.some((id) => !hidden.has(id))
          return (
            <button key={d} type="button" onClick={() => setHidden((h) => { const n = new Set(h); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n })}
              className={'flex-none rounded-full border px-2 py-0.5 font-mono ' + (on ? 'border-teal/50 text-teal' : 'border-navy-700 text-faint')}>{d}</button>
          )
        })}
        {sheets.map((s) => (
          <button key={s.id} type="button" onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })}
            className={'flex-none rounded-full border px-2 py-0.5 font-mono ' + (hidden.has(s.id) ? 'border-navy-700 text-faint line-through' : s.check ? 'border-amber/60 text-amber' : 'border-navy-600 text-ink')}>
            {s.number}
          </button>
        ))}
        {hidden.size > 0 && <button type="button" onClick={() => setHidden(new Set())} className="flex-none inline-flex items-center gap-1 text-faint hover:text-ink"><RotateCcw className="h-3 w-3" /> all</button>}
      </div>
      <div ref={wrap} className="relative flex-1 min-h-0 overflow-hidden bg-white touch-none select-none"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <canvas ref={canvas} className="absolute inset-0" />
        {!sheets.length && (
          <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-600">No sheets are on the map yet — place one in the plan room and the sheets drawn from it follow.</p>
        )}
        {scaleWords && (
          <div className="absolute left-3 bottom-3 rounded bg-white/90 px-1.5 py-1 text-[10px] font-mono text-slate-700 shadow">
            <div className="h-1 border-x border-b border-slate-700" style={{ width: scaleWords.px }} />
            {scaleWords.ft} ft
          </div>
        )}
        {sheets.some((s) => s.check) && (
          <div className="absolute right-3 bottom-3 rounded bg-white/90 px-2 py-1 text-[11px] text-amber-700 shadow">Dashed amber = placed by a guess — check it</div>
        )}
      </div>
    </div>
  )
}

function area(b: Corners4, o: LngLat): number {
  const [tl, tr, , bl] = b.map((p) => toLocal(o, p))
  return Math.abs((tr[0] - tl[0]) * (bl[1] - tl[1]) - (tr[1] - tl[1]) * (bl[0] - tl[0]))
}
