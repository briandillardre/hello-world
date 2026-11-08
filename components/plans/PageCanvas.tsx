'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PdfDoc } from './pdf'

export type PageSource =
  | { kind: 'pdf'; doc: PdfDoc; page: number }
  | { kind: 'image'; url: string }

export interface Camera { s: number; cx: number; cy: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }

const MAX_DETAIL_PX = 16_000_000

/**
 * The sheet viewer's stage: one page, panned, pinched, wheel-zoomed and
 * turned (North up / Plan up), in PAGE units — overlays (the SUPERSEDED
 * stamp, change clouds, the blue dot) draw in the same units and move with
 * it. A PDF page renders twice: once whole at a modest size, and again as a
 * DETAIL layer covering only what is on screen at full screen resolution
 * once the zoom settles, so the drawing stays sharp at any zoom without
 * holding a 100-megapixel canvas.
 */
export function PageCanvas({ src, pageW, pageH, rotation, base, overlay, focus, onReady, onTap, drawing = false }: {
  src: PageSource | null
  pageW: number
  pageH: number
  rotation: number
  /** A canvas drawn in place of the page (the compare composite). */
  base?: HTMLCanvasElement | null
  overlay?: (cam: Camera) => ReactNode
  /** Fit this page-unit box when it changes (Next change). */
  focus?: Box | null
  onReady?: () => void
  /** A tap (no drag) on the page, in page units — measuring and picking. */
  onTap?: (pt: [number, number], cam: Camera) => void
  /** Drawing: no double-tap zoom, a crosshair. */
  drawing?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const baseHost = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLCanvasElement>(null)
  const [vw, setVw] = useState(0)
  const [vh, setVh] = useState(0)
  const [cam, setCam] = useState<Camera>({ s: 0, cx: pageW / 2, cy: pageH / 2 })
  const [detailBox, setDetailBox] = useState<Box | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const camRef = useRef(cam)
  camRef.current = cam
  const rot = (rotation * Math.PI) / 180
  const cos = Math.cos(rot), sin = Math.sin(rot)

  // ── size ──
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => { setVw(el.clientWidth); setVh(el.clientHeight) })
    ro.observe(el)
    setVw(el.clientWidth); setVh(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const fitScale = useCallback((b: Box, pad = 0.94) => {
    const w = b.x1 - b.x0, h = b.y1 - b.y0
    // The box's footprint on screen after turning.
    const fw = Math.abs(w * cos) + Math.abs(h * sin)
    const fh = Math.abs(w * sin) + Math.abs(h * cos)
    return Math.max(1e-4, Math.min(vw / fw, vh / fh) * pad)
  }, [vw, vh, cos, sin])

  const fitAll = useCallback(() => {
    if (!vw || !vh || !pageW || !pageH) return
    setCam({ s: fitScale({ x0: 0, y0: 0, x1: pageW, y1: pageH }), cx: pageW / 2, cy: pageH / 2 })
  }, [vw, vh, pageW, pageH, fitScale])

  // First fit, and refit when the page or the turn changes — never on a
  // resize alone (opening the scale card or the crop bar keeps your zoom).
  const fitFor = useRef('')
  useEffect(() => {
    if (!vw || !vh || !pageW || !pageH) return
    const key = `${pageW}x${pageH}@${rotation}`
    if (fitFor.current === key) return
    fitFor.current = key
    fitAll()
  }, [fitAll, pageW, pageH, rotation, vw, vh])

  useEffect(() => {
    if (!focus || !vw) return
    const pad = Math.max(focus.x1 - focus.x0, focus.y1 - focus.y0) * 0.6
    const b = { x0: focus.x0 - pad, y0: focus.y0 - pad, x1: focus.x1 + pad, y1: focus.y1 + pad }
    setCam({ s: fitScale(b, 1), cx: (focus.x0 + focus.x1) / 2, cy: (focus.y0 + focus.y1) / 2 })
  }, [focus, fitScale, vw])

  // ── base layer ──
  useEffect(() => {
    const host = baseHost.current
    if (!host) return
    host.replaceChildren()
    setFailed(false)
    if (base) {
      base.style.width = '100%'; base.style.height = '100%'; base.style.display = 'block'
      host.appendChild(base)
      onReady?.()
      return
    }
    if (!src) return
    let alive = true
    if (src.kind === 'image') {
      const img = new Image()
      img.decoding = 'async'
      img.style.width = '100%'; img.style.height = '100%'; img.style.display = 'block'
      img.draggable = false
      img.onload = () => { if (alive) onReady?.() }
      img.onerror = () => { if (alive) setFailed(true) }
      img.src = src.url
      host.appendChild(img)
      return () => { alive = false }
    }
    setLoading(true)
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    void (async () => {
      try {
        const page = await src.doc.getPage(src.page)
        if (!alive) return
        const v1 = page.getViewport({ scale: 1 })
        const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
        const k = Math.min(4, (touch ? 2400 : 3600) / Math.max(v1.width, v1.height))
        const vp = page.getViewport({ scale: k })
        const c = document.createElement('canvas')
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
        c.style.width = '100%'; c.style.height = '100%'; c.style.display = 'block'
        const ctx = c.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
        task = page.render({ canvas: c, canvasContext: ctx, viewport: vp }) as unknown as typeof task
        await task!.promise
        if (!alive) return
        host.appendChild(c)
        onReady?.()
      } catch {
        if (alive) setFailed(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    // A render cut short (Compare started mid-draw) must not leave
    // "Opening the sheet…" up for good.
    return () => { alive = false; task?.cancel(); setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, base])

  // ── detail layer (PDF only): what is on screen, at screen resolution ──
  // It sits in page units, so it stays put through a pan or a pinch; a fresh
  // one replaces it once the camera settles. A new page clears it.
  useEffect(() => { setDetailBox(null) }, [src, base])
  useEffect(() => {
    if (!src || src.kind !== 'pdf' || base || !cam.s || !vw) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    const baseK = Math.min(4, (touch ? 2400 : 3600) / Math.max(pageW, pageH))
    if (cam.s * dpr <= baseK * 1.15) return
    let alive = true
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    const t = setTimeout(async () => {
      // The screen's four corners in page units → their box, on the page.
      const corners = [[0, 0], [vw, 0], [vw, vh], [0, vh]].map(([x, y]) => toPage(x, y, cam, vw, vh, cos, sin))
      const b = {
        x0: Math.max(0, Math.min(...corners.map((p) => p[0]))), y0: Math.max(0, Math.min(...corners.map((p) => p[1]))),
        x1: Math.min(pageW, Math.max(...corners.map((p) => p[0]))), y1: Math.min(pageH, Math.max(...corners.map((p) => p[1]))),
      }
      if (b.x1 - b.x0 < 1 || b.y1 - b.y0 < 1) return
      let r = cam.s * dpr
      const px = (b.x1 - b.x0) * (b.y1 - b.y0) * r * r
      if (px > MAX_DETAIL_PX) r *= Math.sqrt(MAX_DETAIL_PX / px)
      try {
        const page = await src.doc.getPage(src.page)
        if (!alive) return
        const vp = page.getViewport({ scale: r, offsetX: -b.x0 * r, offsetY: -b.y0 * r })
        const c = detail.current
        if (!c) return
        const off = document.createElement('canvas')
        off.width = Math.max(1, Math.ceil((b.x1 - b.x0) * r)); off.height = Math.max(1, Math.ceil((b.y1 - b.y0) * r))
        const ctx = off.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, off.width, off.height)
        task = page.render({ canvas: off, canvasContext: ctx, viewport: vp }) as unknown as typeof task
        await task!.promise
        if (!alive) return
        c.width = off.width; c.height = off.height
        c.getContext('2d')?.drawImage(off, 0, 0)
        off.width = 0; off.height = 0
        setDetailBox(b)
      } catch { /* cancelled or failed: the base layer still shows */ }
    }, 220)
    return () => { alive = false; clearTimeout(t); task?.cancel() }
  }, [src, base, cam, vw, vh, pageW, pageH, cos, sin])

  // ── gestures ──
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const downAt = useRef(new Map<number, { x: number; y: number; t: number; moved: number; multi?: boolean }>())
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null)
  const lastTap = useRef(0)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const zoomAt = (x: number, y: number, factor: number) => {
    setCam((c) => {
      if (!c.s) return c
      const fit = fitScale({ x0: 0, y0: 0, x1: pageW, y1: pageH })
      const s2 = Math.max(fit * 0.5, Math.min(40, c.s * factor))
      const [qx, qy] = toPage(x, y, c, vw, vh, cos, sin)
      const dx = x - vw / 2, dy = y - vh / 2
      return { s: s2, cx: qx - (dx * cos + dy * sin) / s2, cy: qy - (-dx * sin + dy * cos) / s2 }
    })
  }

  function onPointerDown(e: React.PointerEvent) {
    wrap.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    downAt.current.set(e.pointerId, { ...local(e), t: Date.now(), moved: 0 })
    // Every finger down while another is down took part in a pinch — none of them is a tap
    // when it lifts (a still thumb in a pinch used to drop a stray corner; ship-check, Nov 8).
    if (pointers.current.size > 1) for (const d of Array.from(downAt.current.values())) d.multi = true
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values())
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    } else if (pointers.current.size === 1 && !drawing) {
      const now = Date.now()
      if (now - lastTap.current < 300) { const p = local(e); zoomAt(p.x, p.y, 2); lastTap.current = 0 } else lastTap.current = now
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const d0 = downAt.current.get(e.pointerId)
    if (d0) d0.moved = Math.max(d0.moved, Math.hypot(p.x - d0.x, p.y - d0.y))
    if (pointers.current.size === 1) {
      const dx = p.x - prev.x, dy = p.y - prev.y
      if (dx || dy) lastTap.current = 0
      setCam((c) => (c.s ? { ...c, cx: c.cx - (dx * cos + dy * sin) / c.s, cy: c.cy - (-dx * sin + dy * cos) / c.s } : c))
    } else if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = Array.from(pointers.current.values())
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      const pp = pinch.current
      if (pp.d > 0) zoomAt(mx, my, d / pp.d)
      const dx = mx - pp.mx, dy = my - pp.my
      setCam((c) => (c.s ? { ...c, cx: c.cx - (dx * cos + dy * sin) / c.s, cy: c.cy - (-dx * sin + dy * cos) / c.s } : c))
      pinch.current = { d, mx, my }
    }
  }
  /** The OS took the touch back (a gesture, a call): forget it — never a tap. */
  function onPointerCancel(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    downAt.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }
  function onPointerUp(e: React.PointerEvent) {
    const wasOnly = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const d0 = downAt.current.get(e.pointerId)
    downAt.current.delete(e.pointerId)
    // A tap: one finger, barely moved, quick — never the end of a pan or a pinch.
    if (onTap && wasOnly && d0 && !d0.multi && d0.moved < 6 && Date.now() - d0.t < 600 && camRef.current.s) {
      const p = local(e)
      onTap(toPage(p.x, p.y, camRef.current, vw, vh, cos, sin), camRef.current)
    }
  }

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const t = cam.s
    ? `translate(${vw / 2}px, ${vh / 2}px) rotate(${rotation}deg) scale(${cam.s}) translate(${-cam.cx}px, ${-cam.cy}px)`
    : 'scale(0)'

  return (
    <div ref={wrap} className={'relative h-full w-full overflow-hidden bg-[#3b4652] touch-none select-none ' + (drawing ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <div className="absolute left-0 top-0 origin-top-left shadow-2xl" style={{ width: pageW, height: pageH, transform: t }}>
        <div ref={baseHost} className="absolute inset-0 bg-white" />
        <canvas ref={detail} className="absolute" style={detailBox ? {
          left: detailBox.x0, top: detailBox.y0, width: detailBox.x1 - detailBox.x0, height: detailBox.y1 - detailBox.y0,
        } : { display: 'none' }} />
        {overlay?.(cam)}
      </div>
      {loading && <p className="absolute left-3 bottom-3 rounded bg-navy-950/80 px-2 py-1 text-[11px] text-muted">Opening the sheet…</p>}
      {failed && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted">This sheet didn’t open — try again.</p>}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(vw / 2, vh / 2, 1.6)} onPointerDown={(e) => e.stopPropagation()}
          className="h-9 w-9 rounded-lg bg-navy-950/85 border border-navy-700 text-ink text-lg leading-none">+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(vw / 2, vh / 2, 1 / 1.6)} onPointerDown={(e) => e.stopPropagation()}
          className="h-9 w-9 rounded-lg bg-navy-950/85 border border-navy-700 text-ink text-lg leading-none">−</button>
        <button type="button" aria-label="Fit the sheet" onClick={fitAll} onPointerDown={(e) => e.stopPropagation()}
          className="h-9 w-9 rounded-lg bg-navy-950/85 border border-navy-700 text-ink text-[10px] font-bold">FIT</button>
      </div>
    </div>
  )
}

function toPage(x: number, y: number, c: Camera, vw: number, vh: number, cos: number, sin: number): [number, number] {
  const dx = x - vw / 2, dy = y - vh / 2
  return [c.cx + (dx * cos + dy * sin) / c.s, c.cy + (-dx * sin + dy * cos) / c.s]
}
