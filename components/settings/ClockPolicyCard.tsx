'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { saveClockPolicyAction } from '@/lib/actions/company'
import type { ClockPolicy } from '@/lib/clock-policy'

/**
 * Settings → Time clock (migration 120). Two answers to buddy punching and
 * ghost shifts a company can switch on: a photo at clock-in / clock-out, and
 * clock-in only at the site (or the yard). Off by default; autosaves like
 * the daily-log builder. The reads on /timecards ("arrived 19 min after
 * clocking in", "never on site", "same phone as …") need no switch at all.
 */
const RADIUS: { m: number; label: string }[] = [
  { m: 50, label: '150 ft' },
  { m: 150, label: '500 ft' },
  { m: 300, label: '1,000 ft' },
  { m: 400, label: '¼ mile' },
  { m: 800, label: '½ mile' },
  { m: 1600, label: '1 mile' },
]

export function ClockPolicyCard({ initial, editable }: { initial: ClockPolicy; editable: boolean }) {
  const [pol, setPol] = useState<ClockPolicy>(initial)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  function save(next: ClockPolicy) {
    setPol(next)
    if (!editable) return
    setSaved('saving')
    start(async () => {
      const r = await saveClockPolicyAction(next).catch(() => ({ ok: false as const, error: 'Save failed' }))
      if (r.ok) { setSaved('saved'); setError(null) }
      else { setSaved('error'); setError(r.error ?? 'Save failed') }
    })
  }
  const radiusChoice = RADIUS.reduce((best, r) => (Math.abs(r.m - pol.siteRadiusM) < Math.abs(best.m - pol.siteRadiusM) ? r : best), RADIUS[1])

  const row = (key: 'photoIn' | 'photoOut' | 'atSite', title: string, hint: string) => (
    <label className="flex items-start gap-3 py-2.5 cursor-pointer">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-ink">{title}</p>
        <p className="text-[11.5px] text-faint leading-snug">{hint}</p>
      </div>
      <Switch checked={pol[key]} disabled={!editable} onCheckedChange={(v) => save({ ...pol, [key]: v })} aria-label={title} />
    </label>
  )

  return (
    <section className="bg-navy-900 rounded-xl border border-navy-800 p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4 text-amber" />
        <h2 className="font-display font-bold text-ink text-sm flex-1">Time clock</h2>
        <span className="text-[10.5px] text-faint">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved ✓' : ''}</span>
      </div>
      <p className="text-[12px] text-faint mb-2 max-w-[62ch]">
        Time cards already read every shift against the phone&apos;s own record — clocked in away from the
        site, on site twenty minutes after clocking in, never on site, the same phone clocking two people.
        These two go further: proof of who held the phone, and no clocking in from the road.
      </p>
      <div className="divide-y divide-navy-800">
        {row('photoIn', 'Photo at clock-in', 'The front camera opens when they tap Clock in; the picture sits on the time card. Nobody is recognised by a computer — a person looks.')}
        {row('photoOut', 'Photo at clock-out', 'Same at clock-out, inside the daily log.')}
        {row('atSite', 'Clock in only at the site', 'Clocking in is refused until the phone is at the chosen site, or inside any yard you have drawn — crews that meet at the yard still clock in there.')}
      </div>
      {pol.atSite && (
        <label className="mt-2 flex items-center gap-3 text-[12.5px] text-muted">
          <span className="flex-1">Counts as “at the site” within</span>
          <select
            value={radiusChoice.m}
            disabled={!editable}
            onChange={(e) => save({ ...pol, siteRadiusM: Number(e.target.value) })}
            className="bg-navy-950 border border-navy-700 rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-amber/50 disabled:opacity-60"
          >
            {RADIUS.map((r) => <option key={r.m} value={r.m}>{r.label} of its edge</option>)}
          </select>
        </label>
      )}
      {error && <p className="mt-2 text-[12px] text-alert">{error}</p>}
      {!editable && <p className="mt-2 text-[11.5px] text-faint">Admins change these.</p>}
    </section>
  )
}
