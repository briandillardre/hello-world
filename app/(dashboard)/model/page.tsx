import { notFound } from 'next/navigation'
import { OperatingModel } from '@/components/model/OperatingModel'
import { isPlatformOwner } from '@/lib/platform-owner'

export const metadata = { title: 'HammerTrack — Operating model' }

export const dynamic = 'force-dynamic'

/**
 * HammerTrack's OWN forward P&L — a founder tool, not a customer feature.
 * Unlisted (no nav entry) and 404s for anyone but platform owners, so it
 * never appears as a DCG item or in the public demo (Brian, Aug 22).
 * Reach it directly: hammertrack.ai/model.
 */
export default async function ModelPage() {
  if (!(await isPlatformOwner())) notFound()
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Operating model</h1>
        <p className="text-[12.5px] text-faint">
          Jul 2026 → Dec 2028 · infra COGS + software + insurance + CPA + ads + hires ·
          assumptions in docs/OPERATING-MODEL.md · pricing structure in docs/PRICING-TIERS.md
        </p>
      </div>
      <OperatingModel />
    </div></div>
  )
}
