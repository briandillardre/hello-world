import { notFound } from 'next/navigation'
import { FounderBoard, type BoardLive } from '@/components/board/FounderBoard'
import { isPlatformOwner } from '@/lib/platform-owner'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getDevices, rollup } from '@/lib/db/devices'

export const metadata = { title: 'HammerTrack — Control Room' }

export const dynamic = 'force-dynamic'

/**
 * HammerTrack's OWN operating board — open items, roadmap, money, fleet,
 * market, ops (Brian, Aug 28: "it feels Scattered and needs to have one home
 * for everything"). Founder tool, not a customer feature: unlisted, and 404s
 * for anyone but platform owners, exactly like /model.
 *
 * Device and asset counts are read live so the board can't go stale on the
 * numbers that move daily; the standing picture lives in lib/board.ts.
 */
export default async function BoardPage() {
  if (!(await isPlatformOwner())) notFound()

  const companyId = await getCurrentCompanyId()
  const [devices, assets] = await Promise.all([
    getDevices(companyId),
    getAssetsWithLocations(companyId),
  ])

  const DAY = 24 * 60 * 60 * 1000
  const live: BoardLive = {
    devices: rollup(devices),
    assets: {
      total: assets.length,
      reporting: assets.filter(
        (a) => a.location && Date.now() - new Date(a.location.timestamp).getTime() < DAY,
      ).length,
      tools: assets.filter((a) => a.type === 'tool').length,
    },
  }

  return <FounderBoard live={live} />
}
