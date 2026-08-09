'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { thumbUrl, fallbackToRaw } from '@/lib/img'

/**
 * Full-screen photo viewer with pinch/pan/wheel zoom. The zone hero caps at
 * 420px with object-contain, so a tall stitched drone pano rendered as a
 * finger-width sliver with no way to actually SEE it ("full images not
 * showing", Aug 9). Same engine the plan aligner settled on after the iPad
 * wars: a plain <img> under a CSS transform — no WebGL, no canvas.
 */
export function PhotoLightbox({ url, caption, onClose }: {
  url: string
  caption?: string | null
  onClose: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const t = useRef({ s: 1, tx: 0, ty: 0, fit: 1 })
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null)

  function apply() {
    const img = imgRef.current
    if (img) img.style.transform = `translate(${t.current.tx}px, ${t.current.ty}px) scale(${t.current.s})`
  }
  function fit() {
    const wrap = wrapRef.current, img = imgRef.current
    if (!wrap || !img || !img.naturalWidth) return
    const s = Math.min(wrap.clientWidth / img.naturalWidth, wrap.clientHeight / img.naturalHeight)
    t.current = { s, fit: s, tx: (wrap.clientWidth - img.naturalWidth * s) / 2, ty: (wrap.clientHeight - img.naturalHeight * s) / 2 }
    apply()
  }
  function zoomAt(cx: number, cy: number, factor: number) {
    const { s, tx, ty, fit: f } = t.current
    const s2 = Math.min(Math.max(s * factor, f * 0.5), Math.max(f * 12, 12))
    t.current.tx = cx - (cx - tx) * (s2 / s)
    t.current.ty = cy - (cy - ty) * (s2 / s)
    t.current.s = s2
    apply()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] bg-black/95 flex flex-col">
      <div className="flex-none flex items-center gap-2 px-4 py-3">
        <p className="flex-1 min-w-0 truncate text-[12.5px] text-white/70">{caption ?? ''}</p>
        <button type="button" onClick={onClose} aria-label="Close photo"
          className="rounded-lg border border-white/20 p-1.5 text-white/80 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div
        ref={wrapRef}
        className="relative flex-1 min-h-0 overflow-hidden touch-none cursor-grab"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          const ps = Array.from(ptrs.current.values())
          if (ps.length === 2) {
            pinch.current = {
              dist: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
              midX: (ps[0].x + ps[1].x) / 2, midY: (ps[0].y + ps[1].y) / 2,
            }
          }
        }}
        onPointerMove={(e) => {
          const prev = ptrs.current.get(e.pointerId)
          if (!prev) return
          ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          const ps = Array.from(ptrs.current.values())
          if (ps.length === 2 && pinch.current) {
            const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
            const midX = (ps[0].x + ps[1].x) / 2, midY = (ps[0].y + ps[1].y) / 2
            const rect = wrapRef.current!.getBoundingClientRect()
            if (pinch.current.dist > 0) zoomAt(midX - rect.left, midY - rect.top, dist / pinch.current.dist)
            t.current.tx += midX - pinch.current.midX
            t.current.ty += midY - pinch.current.midY
            apply()
            pinch.current = { dist, midX, midY }
          } else if (ps.length === 1) {
            t.current.tx += e.clientX - prev.x
            t.current.ty += e.clientY - prev.y
            apply()
          }
        }}
        onPointerUp={(e) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null }}
        onPointerCancel={(e) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null }}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15)
        }}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (t.current.s <= t.current.fit * 1.05) zoomAt(e.clientX - rect.left, e.clientY - rect.top, 3)
          else fit()
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={thumbUrl(url, 2400, 82)}
          onError={(e) => fallbackToRaw(e, url)}
          onLoad={fit}
          alt={caption ?? 'Site photo'}
          draggable={false}
          className="absolute left-0 top-0 max-w-none select-none"
          style={{ transformOrigin: '0 0' }}
        />
      </div>
      <p className="flex-none px-4 py-2 text-center text-[10.5px] text-white/40">
        Pinch or double-tap to zoom · drag to pan
      </p>
    </div>
  )
}
