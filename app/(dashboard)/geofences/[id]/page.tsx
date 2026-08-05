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
import { ProjectHub } from '@/components/geofences/ProjectHub'
import { ZoneImagery } from '@/components/geofences/ZoneImagery'
import { ZonePlans } from '@/components/geofences/ZonePlans'
import type { ZoneImage } from '@/lib/actions/imagery'
import { getProjectHubData } from '@/lib/db/projects'
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
  // Parent candidates for the editor: every other zone that isn't this one or
  // one of its descendants (nesting a zone under its own child would orphan it).
  const descendants = new Set<string>([fence.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const g of allFences) {
      if (g.parent_id && descendants.has(g.parent_id) && !descendants.has(g.id)) { descendants.add(g.id); grew = true }
    }
  }
  const parentOptions = allFences
    .filter((g) => !descendants.has(g.id))
    .map((g) => ({ id: g.id, name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Job cockpit: what happened inside this zone over the window — same accrual
  // engine that prices QBO invoices, so the table IS the invoice preview.
  const isBoundary = (fence.kind ?? (fence.color === '#0a0a0a' || fence.color === '#9ca3af' ? 'boundary' : 'site')) === 'boundary'
  // Vendors: real places worth a visit log, but NEVER job time — no usage,
  // no invoicing, no Project Hub.
  const isVendor = fence.kind === 'vendor'
  let usage: ZoneAssetUsage[] | null = null
  let visits: Visit[] | null = null
  const wantActivity = !isMock && !isBoundary && !!ring && ring.length >= 3

  // The four data families load CONCURRENTLY. This page used to await a
  // 40-round-trip SERIAL page loop over asset_locations, then weather, then
  // the hub, then imagery — with live trackers streaming every few seconds,
  // a month of data made the page take 10s+ ("taking forever", Brian Aug 5).
  const [sweepRows, weather, hub, imageryRes] = await Promise.all([
    // 30-day location sweep: one cheap COUNT sizes the job, then pages fetch
    // in parallel batches. NEWEST-first so recent visits survive the cap
    // (a bare ascending .limit(40k) once hid yesterday's trucks); reversed to
    // chronological for the accrual engines. Rows inserted mid-fetch can
    // shift ranges by a handful of rows — immaterial to 30-day accruals.
    (async () => {
      if (!wantActivity) return null
      const { createClient } = await import('@/lib/supabase-server')
      const supabase = createClient()
      const fromIso = new Date(Date.now() - USAGE_DAYS * 86_400_000).toISOString()
      const PAGE = 1000, CAP = 40_000, BATCH = 8
      const head = await supabase
        .from('asset_locations')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('timestamp', fromIso)
      const total = Math.min(head.count ?? 0, CAP)
      const pages = Math.ceil(total / PAGE)
      const fetched: { asset_id: string; lat: number; lng: number; speed: number | null; timestamp: string }[] = []
      for (let p = 0; p < pages; p += BATCH) {
        const chunk = await Promise.all(
          Array.from({ length: Math.min(BATCH, pages - p) }, (_, i) => {
            const start = (p + i) * PAGE
            return supabase
              .from('asset_locations')
              .select('asset_id, lat, lng, speed, timestamp')
              .eq('company_id', companyId)
              .gte('timestamp', fromIso)
              .order('timestamp', { ascending: false })
              .range(start, Math.min(start + PAGE, total) - 1)
          })
        )
        for (const r of chunk) fetched.push(...(r.data ?? []))
      }
      return fetched.reverse() // chronological — zoneAssetUsage tracks last-per-asset in order
    })(),
    // Weather log (migration 019 + nightly cron) — tolerate the table missing.
    (async () => {
      if (!wantActivity) return [] as SiteWeatherRow[]
      const { createClient } = await import('@/lib/supabase-server')
      const { data: wx } = await createClient()
        .from('site_weather')
        .select('day, temp_hi, temp_lo, rain_in, wind_max')
        .eq('geofence_id', fence.id)
        .order('day', { ascending: false })
        .limit(14)
      return (wx ?? []) as SiteWeatherRow[]
    })(),
    // Project Hub (punch list / milestones / budget) — site zones only.
    !isBoundary && !isVendor ? getProjectHubData(companyId, fence.id) : Promise.resolve(null),
    // Site imagery timeline (052) + Scaled Plans (055) — tolerate older
    // schemas: pre-055 gets photos only, pre-053 gets no placement state.
    (async () => {
      if (isMock || isBoundary) return { images: [] as ZoneImage[], plans: [] as ZoneImage[], available: isMock, plansAvailable: false }
      try {
        const { createClient } = await import('@/lib/supabase-server')
        const supabase = createClient()
        const q = (cols: string) => supabase
          .from('zone_imagery')
          .select(cols)
          .eq('geofence_id', fence.id)
          .order('taken_on', { ascending: false })
          .limit(400)
        let { data: imgs, error: imgErr } = await q('id, url, taken_on, caption, source, created_at, bounds, kind, plan_category, map_active')
        if (!imgErr) {
          const rows = (imgs ?? []) as unknown as ZoneImage[]
          return {
            images: rows.filter((r) => r.kind !== 'plan'),
            plans: rows.filter((r) => r.kind === 'plan'),
            available: true, plansAvailable: true,
          }
        }
        ;({ data: imgs, error: imgErr } = await q('id, url, taken_on, caption, source, created_at, bounds'))
        if (imgErr) ({ data: imgs, error: imgErr } = await q('id, url, taken_on, caption, source, created_at'))
        if (!imgErr) return { images: (imgs ?? []) as unknown as ZoneImage[], plans: [] as ZoneImage[], available: true, plansAvailable: false }
      } catch { /* pre-052 */ }
      return { images: [] as ZoneImage[], plans: [] as ZoneImage[], available: false, plansAvailable: false }
    })(),
  ])

  if (sweepRows) {
    const from = Date.now() - USAGE_DAYS * 86_400_000
    usage = isVendor ? null : zoneAssetUsage(ring!, assets, sweepRows, from, Date.now())
    visits = segmentVisits(sweepRows, ring!)
  }
  const zoneImages = imageryRes.images
  const imageryAvailable = imageryRes.available
  const zonePlans = imageryRes.plans
  const plansAvailable = imageryRes.plansAvailable
  const trackedCost = (usage ?? []).reduce((s, u) => s + u.amount, 0)

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
            folderUrl={fence.folder_url ?? null}
            notes={fence.notes ?? null}
            parentOptions={parentOptions}
          />
        )}

        {isVendor && (
          <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
            This is a <span className="text-[#c4b5fd] font-semibold">vendor</span> — a supply house.
            Every stop here is named in logs and reports, and the time never counts as job-site
            hours or billing. Receipts swiped while a truck is here auto-suggest the job it was
            buying for.
          </p>
        )}

        {isBoundary && (
          <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
            This is a <span className="text-teal font-semibold">boundary</span> — an outline-only perimeter for
            exit and after-hours alerts. Usage hours, invoicing, and the site log are tracked on job-site zones.
          </p>
        )}

        {hub && (hub.available ? (
          <ProjectHub
            zoneId={fence.id}
            tasks={hub.tasks}
            milestones={hub.milestones}
            members={hub.members}
            budget={fence.budget ?? null}
            trackedCost={trackedCost}
            trackedDays={USAGE_DAYS}
            receiptsTotal={hub.receiptsTotal}
            canViewCosts={perms.canViewCosts}
          />
        ) : !isMock ? (
          <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
            Punch list, milestones, and budget unlock with one database update — run migration{' '}
            <span className="font-mono text-teal">046_project_management.sql</span> in the Supabase SQL Editor.
          </p>
        ) : null)}

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

        {/* Notes + folder ride the editor's single Save above. These standalone
            cards remain ONLY for a zone whose ring is too degenerate to edit —
            otherwise the page had three separate Save buttons for one zone. */}
        {!isMock && !(ring && ring.length >= 3) && (
          <>
            <ZoneNotes id={fence.id} initial={fence.notes ?? ''} />
            <FolderLink kind="zone" id={fence.id} initial={fence.folder_url ?? null} />
          </>
        )}

        {!isBoundary && imageryAvailable && (
          <ZoneImagery zoneId={fence.id} initial={zoneImages} canEdit={!isMock} ring={ring ?? null} />
        )}
        {!isBoundary && !isVendor && plansAvailable && (
          <ZonePlans zoneId={fence.id} initial={zonePlans} canEdit={!isMock} ring={ring ?? null} />
        )}

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
