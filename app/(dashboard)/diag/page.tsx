import { LayerDiag } from '@/components/diag/LayerDiag'

export const dynamic = 'force-dynamic'

/** Hidden ops page: live health of every external map-data source. */
export default function DiagPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Layer diagnostics</h1>
        <p className="text-[12.5px] text-faint">
          One sample request per external data source, tested from the server AND from this device.
          Flood zones draw from zoom ~11, soils from ~12 — zoom in before judging those on the map.
        </p>
      </div>
      <LayerDiag />
    </div>
  )
}
