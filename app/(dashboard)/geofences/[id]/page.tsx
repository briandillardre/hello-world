import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Hexagon, MapPin, CornerDownRight } from 'lucide-react'
import { getGeofence, getGeofences, getZoneEvents } from '@/lib/db/geofences'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { pointInPolygon } from '@/lib/alerts-engine'
import { zoneAssetUsage, type ZoneAssetUsage } from '@/lib/costs'
import type { AssetType } from '@/lib/types'
import { GeofenceEditor } from '@/components/geofences/GeofenceEditor'
import { ZoneUsage } from '@/components/geofences/ZoneUsage'
import { ZoneVisits } from '@/components/geofences/ZoneVisits'
import { ZoneWeather, type SiteWeatherRow } from '@/components/geofences/ZoneWeather'
import { ZoneNotes } from '@/components/geofences/ZoneNotes'
import { FolderLink } from '@/components/ui/FolderLink'
import { segmentVisits, type Visit } from '@/lib/visits'
import { DEFAULT_TZ } from '@/lib/dates'
import { cookies } from 'next/headers'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const USAGE_DAYS = 30

export default async function GeofenceDetailPage({ params }: { params: { id: string } }) {
  const companyId = await getCurrentCompanyId()
  const [fence, allFences, assets, perms, zoneEvents] = await Promise.all([
    getGeofence(params.id),
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
    getMyPermissions(),
    getZoneEvents(params.id),
  ])
  if (!fence) notFound()

  const fmtDay = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const activeFrom = fmtDay(fence.active_from)
  const activeUntil = fmtDay(fence.active_until)
  const archived = !!fence.active_until && Date.parse(fence.active_until) < Date.now()
  const ACTION_LABEL: Record<string, string> = { created: 'Created', edited: 'Edited', reshaped: 'Boundary reshaped', archived: 'Archived', reactivated: 'Reactivated' }

  const ring = fence.geometry?.coordinates?.[0] as [number, number][] | undefined
  const inside = !ring ? [] : assets.filter((a) => a.location && pointInPolygon([a.location.lng, a.location.lat], ring))
  const parent = fence.parent_id ? allFences.find((g) => g.id === fence.parent_id) : null
  const subZones = allFences.filter((g) => g.parent_id === fence.id)

  // Job cockpit: what happened inside this zone over the window — same accrual
  // engine that prices QBO invoices, so the table IS the invoice preview.
  const isBoundary = (fence.kind ?? (fence.color === '#0a0a0a' || fence.color === '#9ca3af' ? 'boundary' : 'site')) === 'boundary'
  let usage: ZoneAssetUsage[] | null = null
  let visits: Visit[] | null = null
  let weather: SiteWeatherRow[] = []
  if (!isMock && !isBoundary && ring && ring.length >= 3) {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const from = Date.now() - USAGE_DAYS * 86_400_000
    // Page NEWEST-first so recent visits survive the cap. A bare
    // .order(ascending).limit(40k) returned the OLDEST 40k rows for a busy
    // fleet — dropping yesterday's trucks and showing "no activity" on a zone
    // that was clearly used. Reverse to chronological for the accrual engines.
    const PAGE = 1000, CAP = 40_000
    const fetched: { asset_id: string; lat: number; lng: number; speed: number | null; timestamp: string }[] = []
    while (fetched.length < CAP) {
      const { data } = await supabase
        .from('asset_locations')
        .select('asset_id, lat, lng, speed, timestamp')
        .eq('company_id', companyId)
        .gte('timestamp', new Date(from).toISOString())
        .order('timestamp', { ascending: false })
        .range(fetched.length, fetched.length + PAGE - 1)
      if (!data || data.length === 0) break
      fetched.push(...data)
      if (data.length < PAGE) break
    }
    const rows = fetched.reverse() // chronological — zoneAssetUsage tracks last-per-asset in order
    usage = zoneAssetUsage(ring, assets, rows, from, Date.now())
    visits = segmentVisits(rows, ring)
    // Weather log (migration 019 + nightly cron) — tolerate the table missing.
    const { data: wx } = await supabase
      .from('site_weather')
      .select('day, temp_hi, temp_lo, rain_in, wind_max')
      .eq('geofence_id', fence.id)
      .order('day', { ascending: false })
      .limit(14)
    weather = (wx ?? []) as SiteWeatherRow[]
  }
  const assetMeta = Object.fromEntries(assets.map((a) => [a.id, { name: a.name, type: a.type }]))
  // Vercel renders in UTC — format times in the viewer's zone (ht_tz cookie).
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)

  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <Link href="/geofences" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3">
          <ArrowLeft className="h-4 w-4" /> All zones
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl grid place-items-center flex-none" style={{ backgroundColor: fence.color + '22', border: `2px solid ${fence.color}` }}>
            <Hexagon className="h-6 w-6" style={{ color: fence.color }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{fence.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              {parent && (
                <Link href={`/geofences/${parent.id}`} className="text-xs text-faint hover:text-amber">
                  Sub-zone of {parent.name}
                </Link>
              )}
              {fence.owner_id && <span className="rounded-full bg-[#a78bfa]/15 border border-[#a78bfa]/35 text-[#c4b5fd] text-[10px] font-semibold px-2 py-0.5">🔒 Personal</span>}
              {(activeFrom || activeUntil) && (
                <span className="rounded-full bg-navy-800 border border-navy-700 text-[10px] text-muted px-2 py-0.5">
                  {activeFrom ?? '—'} → {activeUntil ?? 'ongoing'}
                </span>
              )}
              {archived && <span className="rounded-full bg-faint/15 border border-navy-600 text-[10px] text-faint px-2 py-0.5">Archived</span>}
            </div>
          </div>
          <Link href="/map" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm px-3.5 py-2 hover:bg-amber-600 transition-colors">
            <MapPin className="h-4 w-4" /> View on map
          </Link>
        </div>
      </div>

      <div className="p-4 max-w-3xl space-y-6">
        {ring && ring.length >= 3 && (
          <GeofenceEditor
            id={fence.id} name={fence.name} color={fence.color} parentId={fence.parent_id ?? null}
            kind={isBoundary ? 'boundary' : 'site'} ring={ring}
            ownerId={fence.owner_id ?? null}
            isOwnedByMe={!!fence.owner_id /* RLS only returns your own personal zones */}
            activeFrom={fence.active_from ?? null}
            activeUntil={fence.active_until ?? null}
          />
        )}

        {isBoundary && (
          <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
            This is a <span className="text-teal font-semibold">boundary</span> — an outline-only perimeter for
            exit and after-hours alerts. Usage hours, invoicing, and the site log are tracked on job-site zones.
          </p>
        )}

        {usage !== null && (
          <ZoneUsage
            usage={usage}
            days={USAGE_DAYS}
            showCosts={perms.canViewCosts}
            canInvoice={perms.canManageBilling}
          />
        )}

        {visits !== null && (
          <ZoneVisits visits={visits} assetMeta={assetMeta} days={USAGE_DAYS} zoneName={fence.name} tz={tz} />
        )}

        {!isMock && <ZoneNotes id={fence.id} initial={fence.notes ?? ''} />}

        {!isMock && <FolderLink kind="zone" id={fence.id} initial={fence.folder_url ?? null} />}

        <ZoneWeather rows={weather} />

        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Assets inside ({inside.length})</h2>
          {inside.length === 0 ? (
            <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">No assets currently inside this zone.</p>
          ) : (
            <div className="space-y-2">
              {inside.map((a) => (
                <Link key={a.id} href={`/assets/${a.id}`} className="flex items-center gap-3 rounded-xl border border-navy-800 bg-navy-900 p-3 hover:bg-navy-800 transition-colors">
                  <span className="text-2xl">{TYPE_EMOJI[a.type]}</span>
                  <span className="flex-1 font-medium text-ink truncate">{a.name}</span>
                  {a.tracker_id && <span className="font-mono text-xs text-faint">{a.tracker_id}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>

        {zoneEvents.length > 0 && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Change history</h2>
            <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
              {zoneEvents.map((ev) => {
                const changed = ev.detail?.changed as string[] | undefined
                const by = ev.detail?.by as string | undefined
                return (
                  <div key={ev.id} className="flex items-start gap-3 p-3">
                    <span className="mt-0.5 w-2 h-2 rounded-full bg-teal flex-none" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {ACTION_LABEL[ev.action] ?? ev.action}
                        {changed?.length ? <span className="text-faint"> · {changed.join(', ')}</span> : null}
                      </p>
                      <p className="text-[11px] text-faint">{fmtWhen(ev.created_at)}{by ? ` · ${by}` : ''}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {subZones.length > 0 && (
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2">Sub-zones ({subZones.length})</h2>
            <div className="space-y-2">
              {subZones.map((s) => (
                <Link key={s.id} href={`/geofences/${s.id}`} className="flex items-center gap-2 rounded-xl border border-navy-800 bg-navy-900 p-3 hover:bg-navy-800 transition-colors">
                  <CornerDownRight className="h-4 w-4 text-faint" />
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span className="flex-1 font-medium text-ink truncate">{s.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
