import { OperatingModel } from '@/components/model/OperatingModel'

export const metadata = { title: 'HammerTrack — Operating model' }

export const dynamic = 'force-dynamic'

/** The company's forward P&L — behind login on purpose (these are the books). */
export default function ModelPage() {
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
