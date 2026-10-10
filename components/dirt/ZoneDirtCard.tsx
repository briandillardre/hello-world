'use client'

/**
 * The site page's "Dirt takeoff" card: this site's takeoffs with their
 * headline numbers, and New takeoff. Locked (with the reason) for a company
 * without the add-on.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, Mountain, Plus, Triangle } from 'lucide-react'
import { createTakeoffAction } from '@/lib/actions/dirt'
import { NO_REPLY } from '@/lib/action-reply'
import type { StockpileSummary, TakeoffSummary } from '@/lib/db/dirt'
import { pileHistory } from '@/lib/dirt/pile-history'

const n0 = (v: number | undefined) => Math.round(Number(v) || 0).toLocaleString()

export function ZoneDirtCard({ zoneId, takeoffs, piles = [], addon, canEdit }: { zoneId: string; takeoffs: TakeoffSummary[]; piles?: StockpileSummary[]; addon: boolean; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    setBusy(true); setErr(null)
    try {
      const r = await createTakeoffAction(zoneId)
      if (r?.ok && r.id) router.push(`/dirt/${r.id}`)
      else setErr(r?.error ?? NO_REPLY)
    } catch {
      setErr('Could not start a takeoff — check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Dirt takeoff</h2>
      <div className="space-y-3 rounded-xl border border-navy-800 bg-navy-900 p-4">
        {!addon ? (
          <div className="flex gap-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
            <div>
              <div className="font-semibold text-ink">Cut / fill from your plans — an add-on</div>
              <p className="mt-1 text-xs text-muted">Trace the grading plan over this site&apos;s real location, existing ground from USGS lidar, and get topsoil, cut, fill and import/export yards with the cut/fill drawn on the map. Ask us to turn it on for your company.</p>
            </div>
          </div>
        ) : (
          <>
            {takeoffs.length === 0 && (
              <p className="text-xs text-muted">Trace this site&apos;s grading plan to get topsoil, cut, fill and import/export yards — existing ground comes from USGS lidar.</p>
            )}
            {takeoffs.map(t => (
              <Link key={t.id} href={`/dirt/${t.id}`} className="flex items-center gap-3 rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 hover:border-navy-600">
                <Mountain className="h-4 w-4 shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{t.name}</div>
                  <div className="text-xs text-muted">
                    {t.results
                      ? <>Topsoil {n0(t.results.topsoil?.cy)} · Cut {n0(t.results.cutCy)} · Fill {n0(t.results.fillCy)} · {t.results.exportCy > 0 ? `Export ${n0(t.results.exportCy)}` : `Import ${n0(t.results.importCy)}`} CY</>
                      : 'Not run yet'}
                    {t.stale && t.results ? <span className="text-amber"> · changed since the last run</span> : null}
                  </div>
                </div>
              </Link>
            ))}
            {canEdit && (
              <button onClick={create} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-sm text-ink hover:bg-navy-800 disabled:opacity-60">
                <Plus className="h-4 w-4" /> {busy ? 'Starting…' : 'New takeoff'}
              </button>
            )}
            {err && <p className="text-xs text-amber">{err}</p>}
            <div className="border-t border-navy-800 pt-3">
              <div className="mb-2 text-xs font-semibold text-ink">Stockpiles</div>
              {pileHistory(piles).slice(0, 8).map(h => (
                <div key={h.latest.id} className="flex items-center gap-3 py-1 text-xs">
                  <Triangle className="h-3.5 w-3.5 shrink-0 text-amber" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{h.name}</span>
                    <span className="text-muted"> · {n0(h.latest.results.cy)} CY · {n0(h.latest.results.tons)} tons · {h.latest.measuredOn}</span>
                    {h.changeCy !== null && <span className={h.changeCy >= 0 ? 'text-teal' : 'text-amber'}> · {h.changeCy >= 0 ? '+' : '−'}{n0(Math.abs(h.changeCy))} CY since {h.prevOn}</span>}
                    {h.latest.source === 'lidar' && <span className="text-amber"> · old lidar</span>}
                  </div>
                </div>
              ))}
              {!piles.length && <p className="text-xs text-muted">Draw a pile&apos;s toe over this site&apos;s drone survey to get its volume and tons.</p>}
              <Link href={`/dirt/stockpiles/${zoneId}`} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-sm text-ink hover:bg-navy-800">
                <Triangle className="h-4 w-4" /> {canEdit ? 'Measure a stockpile' : 'Stockpiles'}
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
