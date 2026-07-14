'use client'

import { X } from 'lucide-react'

/**
 * ONE minimize button and ONE close button for every floating window in the
 * app — always top-right, always the same glyph. Both draw an X (owner's
 * call, Jul 14: every window dismisses the same way); the tooltip and
 * aria-label say whether the window minimizes back to a pill or closes.
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
      <X className="h-4 w-4" />
    </button>
  )
}

/**
 * X that STRADDLES the window's top edge — half outside the frame, so it's
 * always visible and tappable no matter how tall or busy the window is.
 * Site convention (owner, Jul 14): timeline bar, layers window, map sheets.
 * The parent must be position:relative and must NOT clip overflow — put this
 * OUTSIDE any overflow-hidden/scroll container, as its sibling.
 */
export function ProtrudingClose({ onClick, title = 'Close', className = '' }: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'absolute -top-4 right-3 z-40 grid place-items-center w-8 h-8 rounded-full ' +
        'bg-navy-900 border border-navy-600 shadow-panel text-faint hover:text-ink ' +
        'active:scale-95 transition-colors ' + className
      }
    >
      <X className="h-4 w-4" />
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
