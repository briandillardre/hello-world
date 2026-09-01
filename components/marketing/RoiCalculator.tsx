'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Price-anchoring calculator: your fleet size → our bill vs the incumbent's,
 * using our published numbers for machines (Track tier $8/machine + $3/tag, $0
 * setup) vs Tenna's commonly quoted ~$15–30/asset + $500 setup — Tenna publishes
 * no pricing — computed at a conservative $20. Tenna DOES sell BLE tool tags
 * (TennaBLE — docs/COMPETITORS.md)
 * but publishes no tag rate, so their tag side is MODELED at a modest $6/mo
 * and labeled as modeled in the footnote. Never price their tags as full
 * $20 assets — that overstates the gap.
 * Changing tier pricing? The pricing sync rule applies — update /pricing,
 * docs/PRICING-TIERS.md, and these constants together.
 */
const HT_MACHINE = 8
const HT_TAG = 3
const F25_MACHINE = 6
const TENNA_ASSET_MID = 20
const TENNA_TAG_MODELED = 6
const TENNA_SETUP = 500 // shown as the "+ $500 setup" chip

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function RoiCalculator() {
  const [machines, setMachines] = useState(10)
  const [tags, setTags] = useState(15)

  const htMo = machines * HT_MACHINE + tags * HT_TAG
  const f25Mo = machines * F25_MACHINE + tags * HT_TAG
  const tennaMo = machines * TENNA_ASSET_MID + tags * TENNA_TAG_MODELED

  return (
    <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 sm:p-8">
      <div className="grid md:grid-cols-2 gap-8 items-center">
        <div>
          <label className="block">
            <span className="flex justify-between text-[13px] text-muted mb-1">
              <span>Trucks &amp; machines</span>
              <span className="font-display font-bold text-ink tabular-nums">{machines}</span>
            </span>
            <input type="range" min={1} max={100} value={machines}
              onChange={(e) => setMachines(Number(e.target.value))}
              className="w-full accent-amber" aria-label="Number of trucks and machines" />
          </label>
          <label className="block mt-4">
            <span className="flex justify-between text-[13px] text-muted mb-1">
              <span>Bluetooth tool tags</span>
              <span className="font-display font-bold text-ink tabular-nums">{tags}</span>
            </span>
            <input type="range" min={0} max={200} value={tags}
              onChange={(e) => setTags(Number(e.target.value))}
              className="w-full accent-amber" aria-label="Number of tool tags" />
          </label>
          <p className="font-mono text-[11px] text-faint mt-4 leading-relaxed">
            Tenna math: the commonly quoted $15–30/asset/mo (we use $20) + $500 setup. Tenna
            doesn&apos;t publish a tool-tag rate, so we model their tags at a modest $6/mo.
            Ours: Track tier list price, $0 setup. Always confirm your own quote.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between rounded-xl border border-navy-700 bg-navy-950 px-4 py-3">
            <span className="text-[13px] text-faint">Tenna, same fleet</span>
            <span className="font-display font-bold text-lg text-muted tabular-nums">{usd(tennaMo)}/mo <span className="text-[11px] text-faint">+ {usd(TENNA_SETUP)} setup</span></span>
          </div>
          <div className="flex items-baseline justify-between rounded-xl border border-navy-700 bg-navy-950 px-4 py-3">
            <span className="text-[13px] text-faint">HammerTrack</span>
            <span className="font-display font-bold text-lg text-ink tabular-nums">{usd(htMo)}/mo <span className="text-[11px] text-teal">$0 setup</span></span>
          </div>
          <p className="font-mono text-[11.5px] text-amber">
            Founding 25 rate: {usd(f25Mo)}/mo — with the crews-and-jobs tier included.{' '}
            <Link href="/pricing" className="inline-block text-teal underline decoration-dotted whitespace-nowrap py-3.5 -my-3.5 px-1 -mx-1">Full pricing&nbsp;→</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
