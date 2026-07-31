'use client'

import type { ReactNode } from 'react'
import { PICKER_COLORS } from '@/lib/colors'

/**
 * The shared color picker — same swatches everywhere a zone or asset takes a
 * color, plus a rainbow "custom" well (native color input) for any color at
 * all. When the current value is off-palette, the custom well wears it and
 * shows the selection ring, so nothing ever looks unselected.
 */
export function ColorSwatches({ value, onChange, leading }: {
  value: string
  onChange: (c: string) => void
  /** Optional chip rendered before the swatches (e.g. the asset form's Auto). */
  leading?: ReactNode
}) {
  const norm = (value || '').toLowerCase()
  const custom = !!norm && !PICKER_COLORS.some((c) => c.toLowerCase() === norm)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {leading}
      {PICKER_COLORS.map((c) => {
        const sel = norm === c.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            aria-label={`Use color ${c}`}
            title={c === '#0a0a0a' ? 'Black outline (boundaries render outline-only)' : c === '#9ca3af' ? 'Gray outline (boundaries render outline-only)' : undefined}
            onClick={() => onChange(c)}
            className={
              'h-7 w-7 rounded-full border-2 transition-transform ' +
              (sel ? 'border-white scale-110' : 'border-transparent hover:scale-105')
            }
            style={{ background: c, boxShadow: sel ? `0 0 8px ${c}` : undefined }}
          />
        )
      })}
      <label
        className={
          'relative h-7 w-7 rounded-full border-2 cursor-pointer transition-transform ' +
          (custom ? 'border-white scale-110' : 'border-navy-600 hover:scale-105')
        }
        title="Custom color — pick anything"
        style={custom
          ? { background: value, boxShadow: `0 0 8px ${value}` }
          : { background: 'conic-gradient(#f87171,#facc15,#4ade80,#22d3ee,#818cf8,#e879f9,#f87171)' }}
      >
        <input
          type="color"
          value={custom && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ff9e16'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
          aria-label="Pick a custom color"
        />
      </label>
    </div>
  )
}
