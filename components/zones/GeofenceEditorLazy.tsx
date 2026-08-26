'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import { SweepBar, SkeletonBlock } from '@/components/ui/loading'

/**
 * Lazy shell for the zone editor — GeofenceEditor imports maplibre-gl
 * directly, and a static import dragged the ~1 MB map chunk into the
 * zones/[id] server route's client bundle. Same next/dynamic ssr:false
 * dance as MapPageClient's MapView; the fallback mirrors the editor's real
 * layout (320px mini-map + form rows) in the branded loading language.
 */
const GeofenceEditorInner = dynamic(
  () => import('./GeofenceEditor').then((m) => ({ default: m.GeofenceEditor })),
  {
    ssr: false,
    loading: () => (
      <section aria-busy="true">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Edit zone</h2>
        <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
          <div className="relative">
            <div className="h-[320px] w-full skeleton-shimmer" />
            <div className="absolute top-0 inset-x-0">
              <SweepBar className="h-[3px] rounded-none" />
            </div>
          </div>
          <div className="p-3 space-y-3">
            <SkeletonBlock className="h-3.5 w-2/3" />
            <SkeletonBlock className="h-9 w-full rounded-lg" />
            <SkeletonBlock className="h-9 w-1/2 rounded-lg" />
          </div>
        </div>
      </section>
    ),
  }
)

export function GeofenceEditorLazy(props: ComponentProps<typeof GeofenceEditorInner>) {
  return <GeofenceEditorInner {...props} />
}
