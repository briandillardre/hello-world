import type { Metadata, Viewport } from 'next'
import { requireFeature } from '@/lib/permissions-server'
import { redirect } from 'next/navigation'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { safeTz } from '@/lib/dates'
import { cookies } from 'next/headers'
import { getGeofences } from '@/lib/db/zones'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations, toolsAboard } from '@/lib/db/tools'
import { getCurrentCompany } from '@/lib/db/company'
import { generateTracks } from '@/lib/trails'
import { PROJECTS, projectCost, LIVE_DAY_FRACTION, moneyFull } from '@/lib/projects'
import { pointInPolygon, unreadActionableCount } from '@/lib/alerts-engine'
import { CommandCenter, type CommandKpis } from '@/components/command/CommandCenter'

export const metadata: Metadata = {
  title: 'HammerTrack — Command Center',
  description: 'Live fleet command center for the lobby TV.',
}

// Map surface: page zoom off so pinch gestures belong to the map engine
// (the root layout allows pinch-zoom everywhere else).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false }

// Supabase is live — render per-request so the wall shows THIS company's
// fleet, not the demo baked in at build time.
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function CommandPage() {
  // Auth gate — same contract as app/(dashboard)/layout.tsx (no Edge
  // middleware in this app; gating lives in the server components). In real
  // mode a logged-out visitor gets /login instead of an empty shell whose
  // /api/command-data + /api/history calls all 401 ("HISTORY UNAVAILABLE").
  // Demo mode (isMock) stays fully public — /command is part of the demo.
  if (!isMock) {
    try {
      const { createClient } = await import('@/lib/supabase-server')
      const { data: { user } } = await createClient().auth.getUser()
      if (!user) redirect('/login')
    } catch (e) {
      // Re-throw Next's redirect signal; ignore transient auth-check failures.
      if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e
    }
  }
  // After the auth gate: a logged-out visitor must see /login, not a 404.
  await requireFeature('command')

  // SNAPPY CONTRACT (Brian, Aug 22): this page awaits only the small, fast
  // queries — the shell and basemap paint immediately. The heavy cargo
  // (24h trails, full timeline history, pairing episodes, cost-today) loads
  // client-side from /api/command-data behind a visible status chip.
  const { getMyPermissions } = await import('@/lib/permissions-server')
  const [company, perms] = await Promise.all([getCurrentCompany(), getMyPermissions()])
  const companyId = company.id
  const [rawAssets, geofences, alerts, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getAlertEvents(companyId),
    getToolAssociations(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)
  const tz = safeTz(cookies().get('ht_tz')?.value)

  // Demo mode has no DB to defer to — synthetic tracks + seeded projects,
  // fully rendered server-side like before.
  const tracks = isMock ? generateTracks(assets) : []
  const costToday = isMock
    ? moneyFull(PROJECTS.reduce((s, p) => s + projectCost(p, LIVE_DAY_FRACTION).todayTotal, 0))
    : '…'

  // Measure what the chips claim: "moving" = telemetry speed > 0,
  // "on site" = position inside one of the job-site geofences.
  const onAnySite = (lng: number, lat: number) =>
    geofences.some((g) => g.kind !== 'boundary' && pointInPolygon([lng, lat], g.geometry.coordinates[0] as [number, number][]))

  const kpis: CommandKpis = {
    assetsOnline: assets.filter((a) => a.location).length,
    assetsTotal: assets.length,
    equipmentRunning: assets.filter(
      (a) => (a.type === 'equipment' || a.type === 'vehicle') && (a.location?.speed ?? 0) > 0
    ).length,
    crewOnSite: assets.filter(
      (a) => a.type === 'personnel' && a.location && onAnySite(a.location.lng, a.location.lat)
    ).length,
    // Same rule as the nav bell: zone-log crossings aren't alerts.
    activeAlerts: unreadActionableCount(alerts),
    costToday,
    // Live accounts: real zones (job sites + yards; boundaries are perimeters,
    // not places). Demo keeps the seeded project count.
    sites: isMock ? PROJECTS.length : geofences.filter((g) => g.kind !== 'boundary').length,
  }

  return (
    <CommandCenter
      assets={assets}
      geofences={geofences}
      tracks={tracks}
      historyRows={null}
      earliestMs={null}
      tz={tz}
      kpis={kpis}
      company={company.name}
      alerts={alerts}
      aboard={toolsAboard(rawAssets, toolAssociations)}
      deferLoad={!isMock}
      userName={company.userName}
      navOrder={company.navOrder}
      role={perms.role}
      brand={{ companyName: company.name, logoUrl: company.logoUrl }}
    />
  )
}
