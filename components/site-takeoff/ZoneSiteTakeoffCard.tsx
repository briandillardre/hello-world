'use client'

/**
 * The site page's "Site takeoff" card: this site's paving / landscaping
 * takeoffs with their totals, and New takeoff (on the newest placed drone
 * shot when there is one). Locked, with the reason, without the add-on.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, Plus, Ruler } from 'lucide-react'
import { createSiteTakeoffAction } from '@/lib/actions/site-takeoff'
import { NO_REPLY } from '@/lib/action-reply'
import { money } from '@/lib/site-takeoff/measure'
import type { SiteTakeoffSummary } from '@/lib/db/site-takeoff'

export function ZoneSiteTakeoffCard({ zoneId, takeoffs, orthoCount, newestOrtho, addon, canEdit }: {
  zoneId: string; takeoffs: SiteTakeoffSummary[]; orthoCount: number; newestOrtho: string | null; addon: boolean; canEdit: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    setBusy(true); setErr(null)
    try {
      const r = await createSiteTakeoffAction(zoneId, newestOrtho)
      if (r?.ok && r.id) router.push(`/takeoff/${r.id}`)
      else setErr(r?.error ?? NO_REPLY)
    } catch {
      setErr('Could not start a takeoff — check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Site takeoff</h2>
      <div className="space-y-3 rounded-xl border border-navy-800 bg-navy-900 p-4">
        {!addon ? (
          <div className="flex gap-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
            <div>
              <div className="font-semibold text-ink">Paving and landscaping quantities — an add-on</div>
              <p className="mt-1 text-xs text-muted">Measure asphalt, concrete, turf and beds, striping, curb and edging, stalls and trees on your own drone picture of this site, with unit prices and a printable sheet. Ask us to turn it on for your company.</p>
            </div>
          </div>
        ) : (
          <>
            {takeoffs.length === 0 && (
              <p className="text-xs text-muted">
                Measure areas, lengths and counts on this site{orthoCount ? ' — on your placed drone shot, with a tap-to-fill assist.' : '. Place a drone shot of the site above to use the assist; without one you trace by hand on the satellite basemap.'}
              </p>
            )}
            {takeoffs.map(t => (
              <Link key={t.id} href={`/takeoff/${t.id}`} className="flex items-center gap-3 rounded-lg border border-navy-800 bg-navy-950 px-3 py-2 hover:border-navy-600">
                <Ruler className="h-4 w-4 shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{t.name}</div>
                  <div className="text-xs text-muted">
                    {t.lines ? `${t.lines} line item${t.lines === 1 ? '' : 's'}` : 'Nothing measured yet'}
                    {t.total ? ` · ${money(t.total)}` : ''}
                  </div>
                </div>
              </Link>
            ))}
            {canEdit && (
              <button onClick={create} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-sm text-ink hover:bg-navy-800 disabled:opacity-60">
                <Plus className="h-4 w-4" /> {busy ? 'Starting…' : 'New site takeoff'}
              </button>
            )}
            {err && <p className="text-xs text-amber">{err}</p>}
          </>
        )}
      </div>
    </section>
  )
}
