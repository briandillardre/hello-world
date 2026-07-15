'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { EntityDataPack } from '@/lib/types'
import { computeReceipt } from '@/lib/receipt'
import { moneyFull } from '@/lib/format'
import { DollarFlow } from '@/components/charts/DollarFlow'
import { ReceiptCard } from './ReceiptCard'
import { ShareBar } from '@/components/ShareBar'
import { CountUp } from '@/components/CountUp'

function ReceiptBuilderInner({ pack }: { pack: EntityDataPack }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const initialHome = Number(searchParams.get('home')) || pack.entity.medianHomeValue
  const initialOcc = searchParams.get('occ') !== '0'

  const [homeValue, setHomeValue] = useState(initialHome)
  const [ownerOccupied, setOwnerOccupied] = useState(initialOcc)
  const [homeInput, setHomeInput] = useState(String(initialHome))

  // Mirror state to the URL (debounced) so links & OG images carry the numbers.
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams()
      if (homeValue !== pack.entity.medianHomeValue) params.set('home', String(homeValue))
      if (!ownerOccupied) params.set('occ', '0')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, 400)
    return () => clearTimeout(timeoutRef.current)
  }, [homeValue, ownerOccupied, pathname, router, pack.entity.medianHomeValue])

  const receipt = useMemo(
    () => computeReceipt(pack, { homeValue, ownerOccupied, includeSalesTax: true }),
    [pack, homeValue, ownerOccupied],
  )

  const applyHomeInput = (raw: string) => {
    setHomeInput(raw)
    const parsed = Number(raw.replace(/[^0-9]/g, ''))
    if (parsed > 0) setHomeValue(Math.min(parsed, 50_000_000))
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-grid bg-surface p-4">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Your home&apos;s market value</span>
          <div className="mt-1 flex items-center rounded-lg border border-baseline bg-white px-3 focus-within:border-brand">
            <span className="text-muted">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={homeInput}
              onChange={(e) => applyHomeInput(e.target.value)}
              onBlur={() => setHomeInput(String(homeValue))}
              className="w-36 bg-transparent py-2 pl-1 text-lg font-semibold outline-none tabular"
              aria-label="Home market value in dollars"
            />
          </div>
        </label>
        <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm">
          <input
            type="checkbox"
            checked={ownerOccupied}
            onChange={(e) => setOwnerOccupied(e.target.checked)}
            className="h-4 w-4 accent-[#2a78d6]"
          />
          I live in this home (owner-occupied, {(pack.propertyTax.assessmentRatioOwnerOccupied * 100).toFixed(0)}% assessment)
        </label>
        <button
          type="button"
          onClick={() => {
            setHomeValue(pack.entity.medianHomeValue)
            setHomeInput(String(pack.entity.medianHomeValue))
          }}
          className="pb-2 text-sm text-brand underline-offset-2 hover:underline"
        >
          Use the median home ({moneyFull(pack.entity.medianHomeValue)})
        </button>
      </div>

      {/* Headline */}
      <p className="mt-8 text-center text-sm uppercase tracking-wide text-muted">You pay {pack.entity.name}</p>
      <p className="text-center text-5xl font-bold tracking-tight">
        <CountUp value={Math.round(receipt.primaryEntityTax)} format={(n) => moneyFull(Math.round(n))} />
        <span className="text-lg font-medium text-muted"> / year</span>
      </p>

      {/* Flow */}
      <div className="mt-8 overflow-x-auto">
        <div className="min-w-[560px]">
          <DollarFlow items={receipt.items} totalLabel={moneyFull(Math.round(receipt.primaryEntityTax))} />
        </div>
      </div>

      {/* Receipt */}
      <div className="mt-10">
        <ReceiptCard receipt={receipt} entity={pack.entity} />
      </div>

      <div className="mt-8 flex justify-center">
        <ShareBar title={`Where my ${pack.entity.shortName} tax dollar goes`} embedPath={`/embed/${pack.entity.slug}/receipt`} />
      </div>
    </div>
  )
}

export function ReceiptBuilder({ pack }: { pack: EntityDataPack }) {
  return (
    <Suspense>
      <ReceiptBuilderInner pack={pack} />
    </Suspense>
  )
}
