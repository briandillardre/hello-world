'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A number box that keeps what's being typed. A type=number box reads '' for a
 * lone '-' (or a cleared box), so coercing every keystroke turned "-10" into
 * +10 and an emptied box into 0. Only a whole number reaches onValue — as it's
 * typed (live) or when the box is left / Enter is pressed (one undo step per
 * edit, never a half-typed elevation in the design).
 */
export default function NumField({ value, onValue, live = false, min, max, step, disabled, placeholder, className, ariaLabel }: {
  value: number | undefined; onValue: (n: number) => void; live?: boolean
  min?: number; max?: number; step?: number; disabled?: boolean; placeholder?: string; className?: string; ariaLabel?: string
}) {
  const shown = value === undefined || !Number.isFinite(value) ? '' : String(value)
  const [text, setText] = useState(shown)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setText(shown) }, [shown])
  const parse = (t: string): number | null => {
    if (t.trim() === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)) : null
  }
  const leave = () => {
    editing.current = false
    const n = parse(text)
    if (n !== null && n !== value) onValue(n)
    setText(n !== null ? String(n) : shown)
  }
  return (
    <input type="number" step={step} min={min} max={max} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel}
      value={text} className={className}
      onFocus={() => { editing.current = true }}
      onChange={e => {
        setText(e.target.value)
        const n = live ? parse(e.target.value) : null
        if (n !== null && n !== value) onValue(n)
      }}
      onBlur={leave}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

