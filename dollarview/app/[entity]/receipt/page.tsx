import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPack } from '@/data/registry'
import { ReceiptBuilder } from '@/components/receipt/ReceiptBuilder'

// Rendered per-request so a shared link's ?home=… flows into the OG image —
// the unfurl shows THAT home's numbers, not the median default.
export const dynamic = 'force-dynamic'

export function generateMetadata({
  params,
  searchParams,
}: {
  params: { entity: string }
  searchParams?: { home?: string; occ?: string }
}): Metadata {
  const pack = getPack(params.entity)
  if (!pack) return {}
  const qs = new URLSearchParams()
  if (searchParams?.home) qs.set('home', searchParams.home)
  if (searchParams?.occ) qs.set('occ', searchParams.occ)
  const og = `/api/og/${params.entity}/receipt${qs.size ? `?${qs}` : ''}`
  return {
    title: 'My tax receipt',
    description: `See exactly where your ${pack.entity.shortName} tax dollar goes, itemized to the dollar.`,
    openGraph: { images: [og] },
    twitter: { card: 'summary_large_image', images: [og] },
  }
}

export default function ReceiptPage({ params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)
  if (!pack) notFound()
  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-xl font-bold tracking-tight">Where does <em>your</em> dollar go?</h2>
      <p className="mt-1 text-sm text-ink2">
        Property tax math, done for you — {(pack.propertyTax.assessmentRatioOwnerOccupied * 100).toFixed(0)}% assessment ratio, {pack.propertyTax.authorities.find((a) => a.isPrimary)?.millage.toFixed(1)} mills, itemized by what the money actually funds.
      </p>
      <div className="mt-6">
        <ReceiptBuilder pack={pack} />
      </div>
    </div>
  )
}
