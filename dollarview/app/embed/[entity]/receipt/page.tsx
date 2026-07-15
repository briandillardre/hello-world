import { notFound } from 'next/navigation'
import Link from 'next/link'
import { entitySlugs, getPack } from '@/data/registry'
import { ReceiptBuilder } from '@/components/receipt/ReceiptBuilder'

export const dynamicParams = false

export function generateStaticParams() {
  return entitySlugs().map((entity) => ({ entity }))
}

export default function EmbedReceiptPage({ params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)
  if (!pack) notFound()

  return (
    <div className="mx-auto max-w-2xl">
      <ReceiptBuilder pack={pack} />
      <p className="mt-6 text-center text-xs text-muted">
        Powered by{' '}
        <Link href={`/${pack.entity.slug}/receipt`} target="_blank" className="font-medium text-brand hover:underline">
          DollarView
        </Link>
        {pack.entity.isDemo && ' · fictional demo data'}
      </p>
    </div>
  )
}
