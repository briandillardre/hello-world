'use client'

/**
 * The site page's "Satellite" card (migration 131): watch this site from
 * space. Free Sentinel-2 every few days at 10 m when the company has the
 * satellite add-on; daily 3 m Planet only once it is set up (PL_API_KEY) —
 * until then it says "ask us to turn it on". Clear pictures land on the photo
 * timeline above and the map's Site imagery layer. The cost line under it is
 * the platform owner's alone (no customer price exists yet).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Satellite } from 'lucide-react'
import { setZoneSatelliteAction } from '@/lib/actions/satellite'
import { NO_REPLY } from '@/lib/action-reply'
import type { ZoneSatelliteState } from '@/lib/db/satellite'
import { PLANET, type SiteEstimate } from '@/lib/satellite/pricing'

type Provider = 'sentinel2' | 'planet'

const FEEDS: { key: Provider; title: string; detail: string }[] = [
  {
    key: 'sentinel2',
    title: 'Every few days · 10 m · Sentinel-2',
    detail: 'Free. Shows clearing, pads and big grading changes — not machines or stakes. Cloudy passes are skipped.',
  },
  {
    key: 'planet',
    title: 'Daily · 3 m · Planet',
    detail: 'A clear picture most days. Shows haul roads, stockpiles and pads taking shape.',
  },
]

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const money = (v: number) => `$${v.toFixed(2)}`

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return ''
  if (mins < 60) return `${Math.max(1, mins)} min ago`
  const h = Math.round(mins / 60)
  if (h < 36) return `${h} h ago`
  return day(iso)
}

export function ZoneSatellite({ zoneId, addon, canEdit, personal, state, planetReady, estimate, siteAcres }: {
  zoneId: string
  addon: boolean
  canEdit: boolean
  personal: boolean
  state: ZoneSatelliteState | null
  planetReady: boolean
  /** Platform owner only: what this site costs us. */
  estimate: SiteEstimate | null
  siteAcres: number | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const on = !!state?.enabled
  const current = on ? state!.provider : null

  async function choose(provider: Provider | null) {
    setBusy(true); setErr(null)
    try {
      const r = await setZoneSatelliteAction(zoneId, provider)
      if (r?.ok) router.refresh()
      else setErr(r?.error ?? NO_REPLY)
    } catch {
      setErr('Couldn’t reach the server — check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
        <Satellite className="h-3.5 w-3.5" /> Satellite
      </h2>
      <div className="space-y-3 rounded-xl border border-navy-800 bg-navy-900 p-4">
        {!addon ? (
          <div className="flex gap-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
            <div>
              <div className="font-semibold text-ink">Pictures of this site from space — an add-on</div>
              <p className="mt-1 text-xs text-muted">
                A clear satellite picture every few days lands on this site&apos;s photo timeline and the map&apos;s
                Site imagery layer, dated, so you can watch the work move between visits. Ask us to turn it on for your company.
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink">
              {on ? (
                <>
                  <span className="font-semibold text-teal">On</span> · {current === 'planet' ? 'daily · 3 m (Planet)' : 'every few days · 10 m (Sentinel-2)'}
                </>
              ) : (
                <span className="text-muted">Off for this site.</span>
              )}
            </p>
            {on && state && (
              // Relative times and local dates differ between the server render and the phone.
              <p className="text-xs text-muted" suppressHydrationWarning>
                {state.lastCheckedAt ? `Last looked ${ago(state.lastCheckedAt)}` : 'First look tonight'}
                {state.lastSceneAt ? ` · newest clear picture ${day(state.lastSceneAt)}` : ''}
                {` · ${state.pictures} picture${state.pictures === 1 ? '' : 's'} so far`}
                {state.cloudy > 0 ? ` · ${state.cloudy} cloudy pass${state.cloudy === 1 ? '' : 'es'} skipped` : ''}
                {state.pending > 0 ? ` · ${state.pending} being made` : ''}
                {!state.lastCheckedAt && current === 'sentinel2' ? '. The last two months fill in over the next few nights.' : ''}
              </p>
            )}
            {on && state?.lastError && (
              <p className="text-xs text-amber">Last check didn&apos;t finish: {state.lastError}</p>
            )}

            {personal ? (
              <p className="text-xs text-muted">This is a personal zone. Make it a company site to watch it from space.</p>
            ) : (
              <div className="space-y-2">
                {FEEDS.map((f) => {
                  const selected = current === f.key
                  const available = f.key === 'sentinel2' || planetReady
                  return (
                    <div key={f.key} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${selected ? 'border-teal/50 bg-teal/5' : 'border-navy-800 bg-navy-950'}`}>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold ${available ? 'text-ink' : 'text-muted'}`}>{f.title}</div>
                        <p className="text-xs text-muted">{available ? f.detail : 'Not set up yet — ask us to turn it on.'}</p>
                      </div>
                      {selected ? (
                        <span className="shrink-0 self-center text-xs font-semibold text-teal">On ✓</span>
                      ) : canEdit && available ? (
                        <button type="button" disabled={busy} onClick={() => choose(f.key)}
                          className="shrink-0 self-center rounded-lg border border-navy-700 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-navy-800 disabled:opacity-50">
                          {busy ? '…' : on ? 'Switch' : 'Turn on'}
                        </button>
                      ) : null}
                    </div>
                  )
                })}
                {on && canEdit && (
                  <button type="button" disabled={busy} onClick={() => choose(null)}
                    className="text-xs font-semibold text-faint hover:text-red-400 disabled:opacity-50">
                    Turn off satellite pictures for this site
                  </button>
                )}
                {!canEdit && !on && (
                  <p className="text-xs text-faint">Someone who can edit sites can turn this on.</p>
                )}
              </div>
            )}
            {err && <p className="text-xs text-amber">{err}</p>}
          </>
        )}

        {estimate && (
          <div className="rounded-lg border border-dashed border-navy-700 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-faint">
            <div className="font-semibold uppercase tracking-[0.1em]">Founder view · our cost, not a price</div>
            <div>
              Site {siteAcres !== null ? `${siteAcres.toFixed(1)} acres` : '—'} · its picture covers {estimate.aoiKm2.toFixed(2)} km²
            </div>
            <div>Sentinel-2: ≈ {money(estimate.sentinel2Usd)}/mo</div>
            <div>
              Planet daily: bills {estimate.planetBilledKm2.toFixed(2)} km² ≈ {money(estimate.planetAreaUsd)}/mo next-day area
              (${PLANET.areaUsdPerKm2Year}/km²/yr) · {money(estimate.planetFlexUsd)}/mo as 30-day-old orders
            </div>
            <div>Cost model + licence: docs/SATELLITE.md</div>
          </div>
        )}
      </div>
    </section>
  )
}
