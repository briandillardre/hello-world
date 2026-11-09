'use client'

/**
 * A finger signature in a 300×100 box, kept as a compact SVG path (M/L only —
 * the server keeps nothing else). Pointer events, so a finger, a stylus and a
 * mouse all draw; `touch-action: none` keeps the page from scrolling under it.
 */
import { useRef, useState } from 'react'

export function SignaturePad({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const svg = useRef<SVGSVGElement | null>(null)
  const drawing = useRef(false)
  const [path, setPath] = useState(value)

  function at(e: React.PointerEvent): [number, number] {
    const r = svg.current!.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * 300), Math.round(((e.clientY - r.top) / r.height) * 100)]
  }
  function add(seg: string) {
    setPath((p) => {
      const next = (p + seg).slice(0, 11_900)
      onChange(next)
      return next
    })
  }
  return (
    <div className="space-y-1">
      <svg ref={svg} viewBox="0 0 300 100" className="w-full max-w-[420px] aspect-[3/1] rounded-xl border border-navy-700 bg-white touch-none select-none cursor-crosshair"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drawing.current = true; const [x, y] = at(e); add(`M${x} ${y}`) }}
        onPointerMove={(e) => { if (!drawing.current) return; const [x, y] = at(e); add(`L${x} ${y}`) }}
        onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }}
        aria-label="Sign here with a finger" role="img">
        <line x1="12" y1="82" x2="288" y2="82" stroke="#cbd5e1" strokeWidth="1" />
        {path && <path d={path} fill="none" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
        {!path && <text x="150" y="56" textAnchor="middle" fill="#94a3b8" fontSize="13">Sign here with a finger</text>}
      </svg>
      {path && <button type="button" className="text-[12px] text-muted hover:text-ink" onClick={() => { setPath(''); onChange('') }}>Clear</button>}
    </div>
  )
}

/** A signature drawn back, small. */
export function SignatureMark({ d }: { d: string | null }) {
  if (!d) return <span className="text-faint text-[11px]">typed</span>
  return (
    <svg viewBox="0 0 300 100" className="h-7 w-[84px] rounded bg-white" aria-hidden>
      <path d={d} fill="none" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
