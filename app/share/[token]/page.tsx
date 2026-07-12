import type { Metadata } from 'next'
import { verifyShareToken } from '@/lib/share-token'
import { simplifyPoints } from '@/lib/simplify'
import { SharedReplay, type SharePoint } from '@/components/share/SharedReplay'
import { Logo } from '@/components/brand/Logo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shared replay · HammerTrack',
  robots: { index: false, follow: false },
}

/**
 * Public single-asset replay — no login. The token in the URL is an
 * HMAC-signed grant for exactly one asset + time window, minted by a
 * signed-in user and dead after 7 days. Anything else 404s here.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-navy-950 text-ink grid place-items-center p-6">
      <div className="text-center space-y-3">
        <div className="flex justify-center"><Logo size={28} href={null} /></div>
        {children}
      </div>
    </div>
  )
}

export default async function SharePage({ params }: { params: { token: string } }) {
  const payload = verifyShareToken(decodeURIComponent(params.token))
  if (!payload) {
    return (
      <Shell>
        <p className="font-display font-bold text-lg">This replay link has expired</p>
        <p className="text-sm text-muted max-w-sm">
          Shared replays stay live for 7 days. Ask whoever sent it to share a fresh link.
        </p>
      </Shell>
    )
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()
  const { data: asset } = await supabase.from('assets').select('name, type').eq('id', payload.assetId).maybeSingle()

  // Full window, paged past the API row cap, oldest-first for playback.
  const PAGE = 1000
  const rows: { lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  while (rows.length < 20_000) {
    const { data } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp')
      .eq('asset_id', payload.assetId)
      .gte('timestamp', new Date(payload.fromMs).toISOString())
      .lt('timestamp', new Date(payload.toMs).toISOString())
      .order('timestamp', { ascending: true })
      .range(rows.length, rows.length + PAGE - 1)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }

  const points: SharePoint[] = simplifyPoints(
    rows.map((r) => ({ lat: r.lat, lng: r.lng, ms: new Date(r.timestamp).getTime(), mph: r.speed })),
    12,
    4000
  )

  if (!asset || points.length < 2) {
    return (
      <Shell>
        <p className="font-display font-bold text-lg">Nothing to replay</p>
        <p className="text-sm text-muted max-w-sm">
          {asset ? 'No movement was recorded in the shared window.' : 'This replay link has expired.'}
        </p>
      </Shell>
    )
  }

  return (
    <SharedReplay
      name={asset.name}
      points={points}
      fromMs={payload.fromMs}
      toMs={payload.toMs}
      startT={payload.t ?? 0}
    />
  )
}
