import { LayerDiag } from '@/components/diag/LayerDiag'
import { getCurrentCompany } from '@/lib/db/company'
import { getAssetsWithLocations } from '@/lib/db/assets'

export const dynamic = 'force-dynamic'

/** Hidden ops page: live health of every external map-data source, plus a
 *  dump of EXACTLY what the map page's asset query returns — so "dots
 *  missing" can be blamed on server data vs client rendering in one look. */
export default async function DiagPage() {
  let mapData: { name: string; type: string; hasLoc: boolean; ageMin: number | null; coords: string; color: string }[] = []
  let mapDataErr: string | null = null
  try {
    const company = await getCurrentCompany()
    const assets = await getAssetsWithLocations(company.id)
    mapData = assets.map((a) => ({
      name: a.name,
      type: a.type,
      hasLoc: !!a.location,
      ageMin: a.location ? Math.round((Date.now() - new Date(a.location.timestamp).getTime()) / 60_000) : null,
      coords: a.location ? `${a.location.lat.toFixed(3)}, ${a.location.lng.toFixed(3)}` : '—',
      color: typeof a.metadata?.color === 'string' ? String(a.metadata.color) : '(auto)',
    }))
  } catch (err) {
    mapDataErr = err instanceof Error ? err.message : 'query failed'
  }
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Layer diagnostics</h1>
        <p className="text-[12.5px] text-faint">
          One sample request per external data source, tested from the server AND from this device.
          Flood zones draw from zoom ~11, soils from ~12 — zoom in before judging those on the map.
        </p>
      </div>

      {/* The map page's own asset query, verbatim — if rows here have fresh
          locations but the map shows no dots, the bug is client rendering. */}
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint mb-2">
          Map data (what the live map is fed)
        </p>
        {mapDataErr ? (
          <p className="text-xs text-alert font-mono">{mapDataErr}</p>
        ) : (
          <table className="w-full text-[11.5px] font-mono">
            <thead>
              <tr className="text-faint text-left">
                <th className="pr-2 font-normal">asset</th>
                <th className="pr-2 font-normal">type</th>
                <th className="pr-2 font-normal">location</th>
                <th className="pr-2 font-normal">age</th>
                <th className="pr-2 font-normal">coords</th>
                <th className="font-normal">color</th>
              </tr>
            </thead>
            <tbody>
              {mapData.map((r) => (
                <tr key={r.name} className="text-muted border-t border-navy-800">
                  <td className="pr-2 py-1 text-ink">{r.name}</td>
                  <td className="pr-2">{r.type}</td>
                  <td className={'pr-2 ' + (r.hasLoc ? 'text-teal' : 'text-faint')}>{r.hasLoc ? 'yes' : 'none'}</td>
                  <td className="pr-2">{r.ageMin != null ? `${r.ageMin}m` : '—'}</td>
                  <td className="pr-2">{r.coords}</td>
                  <td>{r.color}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LayerDiag />
    </div>
  )
}
