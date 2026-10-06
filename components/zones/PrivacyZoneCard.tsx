'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { setPrivacyZoneAction } from '@/lib/actions/privacy-zones'
import { NO_REPLY } from '@/lib/action-reply'
import { isPrivacyKind, OFF_SHIFT_GRID_M } from '@/lib/location-policy'

/**
 * Privacy zone switch on the zone page (132). Admins and the owner turn it
 * on for a Boundary or Vendor zone; everyone else sees a one-line note when
 * a zone is private, so a crew member can tell where nothing is kept.
 */
export function PrivacyZoneCard({ zoneId, on, kind, canManage }: { zoneId: string; on: boolean; kind: string | null; canManage: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState(on)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const allowed = isPrivacyKind(kind)
  // A flag left on a zone that has since become a site or yard does nothing.
  const inert = value && !allowed

  if (!canManage) {
    if (!value || inert) return null
    return (
      <p className="flex items-start gap-2 rounded-xl border border-teal/30 bg-teal/[0.05] p-3 text-[12.5px] text-muted leading-snug">
        <ShieldCheck className="h-4 w-4 text-teal flex-none mt-0.5" />
        <span><span className="font-semibold text-ink">Privacy zone.</span> Crew phones keep no automatic location inside it — a clock-in or clock-out tap, photo or receipt still carries its spot. Company trucks and machines are tracked as usual.</span>
      </p>
    )
  }
  // Sites and yards can't be private — keep their pages free of a switch that can't turn on.
  if (!allowed && !value) return null

  const flip = (next: boolean) => {
    if (pending) return
    const prev = value
    setValue(next)
    setErr(null)
    start(async () => {
      const r = await setPrivacyZoneAction(zoneId, next)
      if (!r?.ok) { setValue(prev); setErr(r?.error ?? NO_REPLY) }
      else router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-2" aria-label="Privacy zone">
      <div className="flex items-start gap-3">
        <ShieldCheck className={'h-5 w-5 flex-none mt-0.5 ' + (value && !inert ? 'text-teal' : 'text-faint')} />
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-sm text-ink">Privacy zone</p>
          {inert ? (
            <p className="text-[12px] text-amber leading-snug">
              This zone is a {kind ?? 'site'} now, so it no longer works as a privacy zone — crews&apos; phones are recorded here like any work place. Turn the switch off, or draw the private place as its own Boundary zone, clear of any site or yard.
            </p>
          ) : (
            <p className="text-[12px] text-muted leading-snug">
              Inside it, and near its edge, crew phones keep no automatic location — no shift points, no tag-listener fixes, no Go Live. A tag heard there keeps only its rough area (~{OFF_SHIFT_GRID_M} m). A clock-in or clock-out tap still saves its spot (the time card says only &ldquo;in a privacy zone&rdquo;), and so does a photo or receipt. A zone over a site or yard can&apos;t be made private. Company trucks and machines are tracked as usual.
            </p>
          )}
          <p className="mt-1 text-[11.5px] text-faint leading-snug">
            For a place others shouldn&apos;t see on the map — someone&apos;s home — draw it as a personal zone (only you see it). It still protects every phone.
          </p>
        </div>
        <button
          type="button" role="switch" aria-checked={value} aria-label="Privacy zone" disabled={pending}
          onClick={() => flip(!value)}
          className={'relative flex-none w-12 h-7 rounded-full border transition-colors disabled:opacity-60 ' + (value ? 'bg-teal border-teal' : 'bg-navy-800 border-navy-600')}
        >
          <span className={'absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ' + (value ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>
      </div>
      {err && <p className="text-[12px] text-red-400">{err}</p>}
    </section>
  )
}
