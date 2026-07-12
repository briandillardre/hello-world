'use client'

import { useEffect, useState } from 'react'
import { Maximize2, History } from 'lucide-react'

/**
 * "Map opens to" — a preference, not a layer, so it lives in Settings (moved
 * out of the map's layers panel per the layers spec). Writes the same
 * device-local key the map reads on open.
 */
const LS_KEY = 'ht_map_open_view'

export function MapPrefs() {
  const [openView, setOpenView] = useState<'fit' | 'last'>('fit')
  useEffect(() => {
    try { if (localStorage.getItem(LS_KEY) === 'last') setOpenView('last') } catch { /* private mode */ }
  }, [])
  const pick = (v: 'fit' | 'last') => {
    setOpenView(v)
    try { localStorage.setItem(LS_KEY, v) } catch { /* private mode */ }
  }
  return (
    <div className="p-4 space-y-2">
      <p className="text-xs text-muted">
        What the map shows when you open it, on this device. Default: exactly where you left it —
        camera, tilt, zoom, and layers all come back (map and command center remember separately).
      </p>
      <div className="flex items-center gap-0.5 bg-navy-950 rounded-lg p-0.5 border border-navy-800 max-w-xs">
        <button
          onClick={() => pick('fit')}
          className={'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors ' + (openView === 'fit' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')}
        >
          <Maximize2 className="h-3.5 w-3.5" /> Whole fleet
        </button>
        <button
          onClick={() => pick('last')}
          className={'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors ' + (openView === 'last' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')}
        >
          <History className="h-3.5 w-3.5" /> Last view
        </button>
      </div>
    </div>
  )
}
