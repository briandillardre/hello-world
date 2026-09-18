'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { ASSET_VISIBILITY, type AssetVisibility } from '@/lib/permissions'
import { setAssetVisibilityAction } from '@/lib/actions/assets'

/**
 * Who can see this asset (111). One tap per level; the level takes effect
 * everywhere at once — map, lists, command center, replays, alerts, Ask AI —
 * because it is enforced in the database, not in each screen. Levels above
 * the viewer's own rank are shown but disabled: you cannot hide a machine
 * from yourself, and an Admin cannot promise "owner only".
 */
export function VisibilityCard({ assetId, current, viewerRank }: { assetId: string; current: AssetVisibility; viewerRank: number }) {
  const router = useRouter()
  const [level, setLevel] = useState<AssetVisibility>(current)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const restricted = level !== 'everyone'

  const pick = (k: AssetVisibility) => {
    if (k === level || pending) return
    const prev = level
    setLevel(k)
    setErr(null)
    start(async () => {
      const r = await setAssetVisibilityAction(assetId, k)
      if (!r.ok) { setLevel(prev); setErr(r.error ?? 'Could not save.') }
      else router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-navy-700 bg-navy-900/60 p-4" aria-label="Who can see this asset">
      <div className="flex items-center gap-2">
        {restricted ? <EyeOff className="h-4 w-4 text-amber" /> : <Eye className="h-4 w-4 text-teal" />}
        <h3 className="font-display font-bold text-sm text-ink">Who can see this</h3>
        <span className={'ml-auto text-[11px] font-semibold ' + (restricted ? 'text-amber' : 'text-faint')}>
          {ASSET_VISIBILITY.find((d) => d.key === level)?.label}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted">
        Applies everywhere at once — map, lists, replays, alerts, reports and Ask AI. The tracker keeps recording either way; nothing is lost when you change this.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ASSET_VISIBILITY.map((d) => {
          const locked = d.rank > viewerRank
          const on = d.key === level
          return (
            <button
              key={d.key}
              type="button"
              disabled={locked || pending}
              title={locked ? 'Only the account owner can set this' : d.blurb}
              onClick={() => pick(d.key)}
              className={
                'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ' +
                (on
                  ? 'border-teal bg-teal/15 text-teal'
                  : 'border-navy-700 text-muted hover:text-ink hover:bg-navy-800') +
                (locked ? ' opacity-40 cursor-not-allowed' : '')
              }
            >
              {d.label}
            </button>
          )
        })}
      </div>
      {err && <p className="mt-2 text-[12px] text-red-400">{err}</p>}
    </section>
  )
}
