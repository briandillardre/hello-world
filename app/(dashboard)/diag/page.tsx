import { LayerDiag } from '@/components/diag/LayerDiag'
import { getCurrentCompany } from '@/lib/db/company'
import { getAssetsWithLocations } from '@/lib/db/assets'

export const metadata = { title: 'HammerTrack — Diagnostics' }

export const dynamic = 'force-dynamic'

/** Hidden ops page: live health of every external map-data source, plus a
 *  dump of EXACTLY what the map page's asset query returns — so "dots
 *  missing" can be blamed on server data vs client rendering in one look. */
export default async function DiagPage() {
  let mapData: { name: string; type: string; hasLoc: boolean; ageMin: number | null; coords: string; color: string; ble: string }[] = []
  let mapDataErr: string | null = null
  try {
    const company = await getCurrentCompany()
    const assets = await getAssetsWithLocations(company.id)
    mapData = assets.map((a) => {
      // Beacon truth: does this gateway's latest telemetry carry ANY BLE
      // data? "none" while driving with tags aboard = the tracker isn't
      // configured to report beacons — config problem, not app problem.
      const raw = (a.location?.raw ?? {}) as Record<string, unknown>
      const bleKeys = Object.keys(raw).filter((k) => k.startsWith('ble.'))
      const beacons = Array.isArray(raw['ble.beacons']) ? (raw['ble.beacons'] as unknown[]).length : 0
      return {
        name: a.name,
        type: a.type,
        hasLoc: !!a.location,
        ageMin: a.location ? Math.round((Date.now() - new Date(a.location.timestamp).getTime()) / 60_000) : null,
        coords: a.location ? `${a.location.lat.toFixed(3)}, ${a.location.lng.toFixed(3)}` : '—',
        color: typeof a.metadata?.color === 'string' ? String(a.metadata.color) : '(auto)',
        // Raw beacon entries verbatim (ids truncated) — answers "does the
        // tracker forward tag battery?" without a flespi session.
        ble: a.type === 'vehicle' || a.type === 'equipment'
          ? (beacons > 0
            ? (raw['ble.beacons'] as Record<string, unknown>[]).map((b) => {
                const rest = Object.entries(b).filter(([k]) => k !== 'id' && k !== 'mac')
                  .map(([k, v]) => `${k}:${String(v)}`).join(' ')
                const id = String(b.id ?? b.mac ?? '?')
                return `…${id.slice(-7)} ${rest}`
              }).join(' | ')
            : bleKeys.length ? `${bleKeys.length} ble key${bleKeys.length === 1 ? '' : 's'}` : 'none')
          : '—',
      }
    })
  } catch (err) {
    mapDataErr = err instanceof Error ? err.message : 'query failed'
  }
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Layer diagnostics</h1>
        <p className="text-[12.5px] text-faint">
          One sample request per external data source, tested from the server AND from this device.
          Flood zones draw from zoom ~15 (FEMA renders them at street scale only), soils from ~12 — zoom in before judging those on the map.
        </p>
      </div>

      {/* The map page's own asset query, verbatim — if rows here have fresh
          locations but the map shows no dots, the bug is client rendering. */}
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 overflow-x-auto">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint mb-2">
          Map data (what the live map is fed)
        </p>
        {mapDataErr ? (
          <p className="text-xs text-alert font-mono">{mapDataErr}</p>
        ) : (
          <table className="w-full text-[11.5px] font-mono min-w-[560px]">
            <thead>
              <tr className="text-faint text-left">
                <th className="pr-2 font-normal">asset</th>
                <th className="pr-2 font-normal">type</th>
                <th className="pr-2 font-normal">location</th>
                <th className="pr-2 font-normal">age</th>
                <th className="pr-2 font-normal">coords</th>
                <th className="pr-2 font-normal">color</th>
                <th className="font-normal">ble</th>
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
                  <td className="pr-2">{r.color}</td>
                  <td className={r.ble === 'none' ? 'text-amber' : 'text-teal'}>{r.ble}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LayerDiag />
    </div></div>
  )
}
