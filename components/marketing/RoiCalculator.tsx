'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Price-anchoring calculator: your fleet size → our bill vs the incumbent's,
 * using only PUBLISHED numbers (Track tier $8/machine + $3/tag, $0 setup;
 * Tenna's public $15–25/asset + $500 setup, computed at the $20 midpoint).
 * Changing tier pricing? The pricing sync rule applies — update /pricing,
 * docs/PRICING-TIERS.md, and these constants together.
 */
const HT_MACHINE = 8
const HT_TAG = 3
const F25_MACHINE = 6
const TENNA_ASSET_MID = 20
const TENNA_SETUP = 500

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function RoiCalculator() {
  const [machines, setMachines] = useState(10)
  const [tags, setTags] = useState(15)

  const htMo = machines * HT_MACHINE + tags * HT_TAG
  const f25Mo = machines * F25_MACHINE + tags * HT_TAG
  // Tenna has no $3 tool-tag class — tools ride as full assets there.
  const tennaMo = (machines + tags) * TENNA_ASSET_MID
  const yearOneSaved = tennaMo * 12 + TENNA_SETUP - htMo * 12

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
            Tenna math: their published $15–25/asset/mo (we use $20) + $500 setup — and no
            $3 tool-tag class, so tools ride as full assets. Ours: Track tier list, $0 setup.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between rounded-xl border border-navy-700 bg-navy-950 px-4 py-3">
            <span className="text-[13px] text-faint">Tenna, same fleet</span>
            <span className="font-display font-bold text-lg text-muted tabular-nums">{usd(tennaMo)}/mo <span className="text-[11px] text-faint">+ $500 setup</span></span>
          </div>
          <div className="flex items-baseline justify-between rounded-xl border border-navy-700 bg-navy-950 px-4 py-3">
            <span className="text-[13px] text-faint">HammerTrack</span>
            <span className="font-display font-bold text-lg text-ink tabular-nums">{usd(htMo)}/mo <span className="text-[11px] text-teal">$0 setup</span></span>
          </div>
          <div className="rounded-xl border border-teal/40 bg-teal/[0.08] px-4 py-3.5">
            <p className="text-[12px] text-faint">Year one, you keep</p>
            <p className="font-display font-black text-[2rem] leading-tight text-teal tabular-nums">{usd(Math.max(0, yearOneSaved))}</p>
          </div>
          <p className="font-mono text-[11.5px] text-amber">
            Founding 25 rate: {usd(f25Mo)}/mo — with the crews-and-jobs tier included. <Link href="/pricing" className="text-teal underline decoration-dotted">Full pricing →</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
