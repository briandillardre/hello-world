'use client'

import { Minus, X } from 'lucide-react'

/**
 * ONE minimize button and ONE close button for every floating window in the
 * app — Microsoft-style: always top-right, always the same glyph, so nobody
 * hunts for the chevron-of-the-day. Minus = minimize (comes back from a pill
 * or edge tab), X = close (dismisses the thing).
 */

const BASE =
  'flex-none grid place-items-center w-7 h-7 rounded-lg border bg-navy-900 border-navy-800 ' +
  'text-faint hover:text-ink hover:border-navy-600 transition-colors'

export function MinimizeButton({ onClick, title = 'Minimize', className = '' }: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={`${BASE} ${className}`}>
      <Minus className="h-4 w-4" />
    </button>
  )
}

export function CloseButton({ onClick, title = 'Close', className = '' }: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={`${BASE} ${className}`}>
      <X className="h-4 w-4" />
    </button>
  )
}
