'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  TASKS, STAGES, TIER_ROWS, COST_CURVE, COST_COLS, HIRES, COMPETITORS,
  VENDORS, ENV_PENDING, ENV_LIVE, RULES, TRUTH_WATCH, DOC_INDEX, IRON, BURN,
  SELLING_MOTION, S1_SHAPE,
  taskCounts, type BoardTask,
} from '@/lib/board'
import { MODELS, MODEL_ORDER } from '@/lib/devices'

/** Live numbers the page reads from the database — the part of the board
 *  that can't go stale because nobody remembered to edit it. */
export interface BoardLive {
  devices: { total: number; online: number; waiting: number; stuck: number }
  assets: { total: number; reporting: number; tools: number }
}

const TABS = ['Now', 'Build', 'Roadmap', 'Sales', 'Money', 'Fleet', 'Market', 'Ops'] as const
type Tab = typeof TABS[number]

const STORE_KEY = 'ht-board-tab'

/* ── small shared pieces ─────────────────────────────────────────────── */

function H({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-7 first:mt-0 mb-2.5">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint whitespace-nowrap">{children}</h2>
      <span className="flex-1 h-px bg-navy-800" />
    </div>
  )
}

function Box({ tone, children }: { tone?: 'stop' | 'warn' | 'live' | 'amber'; children: React.ReactNode }) {
  const edge = tone === 'stop' ? 'border-l-[3px] border-l-alert'
    : tone === 'warn' ? 'border-l-[3px] border-l-amber'
    : tone === 'live' ? 'border-l-[3px] border-l-teal'
    : tone === 'amber' ? 'border-l-[3px] border-l-amber' : ''
  return <div className={`rounded-xl border border-navy-800 bg-navy-900 p-4 ${edge}`}>{children}</div>
}

function Pill({ tone, children }: { tone: 'stop' | 'warn' | 'live' | 'idle' | 'amber'; children: React.ReactNode }) {
  const c = {
    stop: 'text-alert border-alert/40 bg-alert/10',
    warn: 'text-amber border-amber/40 bg-amber/10',
    live: 'text-teal border-teal/40 bg-teal/10',
    amber: 'text-amber border-amber/40 bg-amber/10',
    idle: 'text-faint border-navy-700',
  }[tone]
  return (
    <span className={`font-mono text-[9.5px] uppercase tracking-[0.08em] px-2 py-[3px] rounded-full border whitespace-nowrap ${c}`}>
      {children}
    </span>
  )
}

function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-800 bg-navy-900">
      <table className="w-full text-[13px] min-w-[540px] border-collapse">{children}</table>
    </div>
  )
}
const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={`font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-faint px-3.5 py-2.5 border-b border-navy-800 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{children}</th>
)
const Td = ({ children, right, strong }: { children?: React.ReactNode; right?: boolean; strong?: boolean }) => (
  <td className={`px-3.5 py-2.5 border-b border-navy-800/60 align-top ${right ? 'text-right font-mono tabular-nums' : ''} ${strong ? 'text-ink font-semibold' : 'text-faint'}`}>{children}</td>
)

/* ── tabs ────────────────────────────────────────────────────────────── */

function NowTab({ live }: { live: BoardLive }) {
  const blocking = TASKS.filter((t) => t.state === 'open' && t.sev === 'stop')
  const soon = TASKS.filter((t) => t.state === 'open' && t.sev === 'warn')
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">
        What&apos;s actually in the way today. Everything else on this board is context for these.
      </p>

      <H>Blocking — nothing moves until these clear</H>
      <div className="grid md:grid-cols-3 gap-2.5">
        {blocking.map((t) => (
          <Box key={t.id} tone="stop">
            <h3 className="font-display font-bold text-[15px] text-ink mb-1">{t.title}</h3>
            <p className="text-[13px] text-faint leading-relaxed">{t.why}</p>
            <p className="font-mono text-[11px] text-faint mt-2">#{t.id}</p>
          </Box>
        ))}
      </div>

      <H>Hardware, right now</H>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Box><h3 className="font-display font-bold text-2xl text-teal tabular-nums">{live.devices.online}</h3><p className="text-[12px] text-faint mt-0.5">reporting</p></Box>
        <Box><h3 className="font-display font-bold text-2xl text-amber tabular-nums">{live.devices.waiting}</h3><p className="text-[12px] text-faint mt-0.5">on their own timer</p></Box>
        <Box><h3 className={`font-display font-bold text-2xl tabular-nums ${live.devices.stuck ? 'text-alert' : 'text-faint'}`}>{live.devices.stuck}</h3><p className="text-[12px] text-faint mt-0.5">need a step from you</p></Box>
        <Box><h3 className="font-display font-bold text-2xl text-ink tabular-nums">{live.assets.reporting}<span className="text-faint text-base">/{live.assets.total}</span></h3><p className="text-[12px] text-faint mt-0.5">assets seen in 24 h</p></Box>
      </div>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        Counts are live from your own fleet. Per-device detail, and why any one of them is stuck, lives on{' '}
        <Link href="/assets/onboard" className="text-amber hover:underline">Hardware setup</Link>.
      </p>

      <H>Needs you soon</H>
      <div className="grid md:grid-cols-3 gap-2.5">
        {soon.map((t) => (
          <Box key={t.id} tone="warn">
            <h3 className="font-display font-bold text-[15px] text-ink mb-1">{t.title}</h3>
            <p className="text-[13px] text-faint leading-relaxed">{t.why}</p>
            <p className="font-mono text-[11px] text-faint mt-2">#{t.id}</p>
          </Box>
        ))}
      </div>
    </>
  )
}

function BuildTab() {
  const [filter, setFilter] = useState<'open' | 'brian' | 'build' | 'done' | 'all'>('open')
  const c = taskCounts()
  const show = (t: BoardTask) =>
    filter === 'all' ? true
      : filter === 'open' ? t.state !== 'done'
        : filter === 'done' ? t.state === 'done'
          : t.state !== 'done' && t.owner === filter

  const chips: [typeof filter, string][] = [
    ['open', `Open · ${c.open}`], ['brian', `Yours · ${c.brian}`],
    ['build', `Build · ${c.build}`], ['done', `Shipped · ${c.done}`], ['all', 'Everything'],
  ]

  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-4">
        Everything tracked, in one list — <span className="text-ink font-semibold">{c.open} open</span> against {c.done} already shipped.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {chips.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`font-mono text-[11px] px-3 py-1.5 rounded-full border transition-colors ${
              filter === k ? 'bg-amber/10 border-amber text-amber' : 'bg-navy-900 border-navy-800 text-faint hover:text-ink hover:border-navy-700'
            }`}
          >{label}</button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {TASKS.filter(show).map((t) => (
          <div
            key={t.id}
            className={`grid grid-cols-[30px_1fr_auto] gap-3 items-start rounded-lg border border-navy-800 bg-navy-900 px-3 py-2.5 ${t.state === 'done' ? 'opacity-50' : ''}`}
          >
            <span className="font-mono text-[11px] text-faint pt-0.5">{String(t.id).padStart(2, '0')}</span>
            <span className="min-w-0">
              <span className={`block text-[13.5px] leading-snug ${t.state === 'done' ? 'text-faint line-through' : 'text-ink'}`}>{t.title}</span>
              {t.why && t.state !== 'done' && (
                <span className="block text-[12px] text-faint mt-0.5 leading-relaxed">{t.why}</span>
              )}
            </span>
            <Pill tone={t.state === 'done' ? 'live' : t.state === 'flight' ? 'amber' : t.sev === 'stop' ? 'stop' : t.sev === 'warn' ? 'warn' : 'idle'}>
              {t.state === 'done' ? 'shipped' : t.state === 'flight' ? 'in flight' : t.owner === 'brian' ? 'yours' : 'build'}
            </Pill>
          </div>
        ))}
      </div>
    </>
  )
}

function RoadmapTab() {
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">
        Four stages, each with one gate that has to be true before the next is worth starting. The order is real
        sequence, not decoration — you can&apos;t buy stage 2 without passing stage 1&apos;s gate.
      </p>
      <div className="rounded-xl border border-navy-800 bg-navy-900 px-4">
        {STAGES.map((s, i) => (
          <div key={s.mark} className={`grid md:grid-cols-[104px_1fr] gap-2 md:gap-4 py-4 ${i ? 'border-t border-navy-800/60' : ''}`}>
            <div>
              <p className={`font-display font-extrabold text-xl leading-tight ${i === 0 ? 'text-amber' : 'text-ink'}`}>{s.mark}</p>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint mt-0.5">{s.when}</p>
            </div>
            <div>
              <h3 className="font-display font-bold text-[15px] text-ink">{s.title}</h3>
              <p className="text-[13px] text-faint mt-0.5 leading-relaxed">{s.summary}</p>
              <ul className="mt-2 space-y-1">
                {s.points.map((p) => (
                  <li key={p.text} className="flex gap-2.5 items-baseline text-[13px] text-faint leading-relaxed">
                    <span className={`shrink-0 w-[5px] h-[5px] rounded-[1px] translate-y-[-2px] ${
                      p.tone === 'ok' ? 'bg-teal' : p.tone === 'no' ? 'bg-alert' : p.tone === 'wait' ? 'bg-amber' : 'bg-faint'
                    }`} />
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
              {s.gate && (
                <p className="text-[12.5px] text-amber border-l-2 border-amber pl-2.5 mt-2.5">Gate: {s.gate}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <H>Next, in order</H>
      <Box tone="amber">
        <ul className="space-y-1.5 text-[13px] text-faint leading-relaxed">
          <li><span className="text-ink font-semibold">PM Tier 1 money loop</span> — estimates → e-sign proposals → change orders → pay apps</li>
          <li><span className="text-ink font-semibold">Growth Platform</span> — HammerTrack Card → referral lending → insurance referrals (charts, the valuation card and the memo advisor are live)</li>
          <li><span className="text-ink font-semibold">HammerTrack Aerial</span> — wrap OpenDroneMap, dated-flight differencing, &ldquo;X yd³ moved&rdquo; at $10–25/flight against DroneDeploy&apos;s $329/mo</li>
          <li>Camera pilot over the Teltonika rails</li>
        </ul>
        <p className="text-[12.5px] text-faint mt-3 leading-relaxed">
          <span className="text-muted font-semibold">Guardrail:</span> never market AI as the differentiator. Outcomes only — same standing as the splash truth rule.
        </p>
      </Box>
    </>
  )
}

function MoneyTab() {
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">
        Three tiers, one floor rule, and a cost curve that improves with every customer.{' '}
        <span className="text-ink font-semibold">Any change here updates /pricing, the splash ladder, /demo, the billing guide and the tiers doc in the same commit</span> — /demo once drifted to a dead offer for twelve days.
      </p>

      <H>Tiers</H>
      <Scroll>
        <thead><tr><Th /><Th>Track</Th><Th>Operate</Th><Th>Run</Th></tr></thead>
        <tbody>
          {TIER_ROWS.map((r) => (
            <tr key={r.label} className={r.emphasis ? 'bg-amber/[0.04]' : ''}>
              <Td strong={r.emphasis}>{r.label}</Td>
              <Td>{r.track}</Td>
              <Td strong>{r.operate}</Td>
              <Td>{r.run}</Td>
            </tr>
          ))}
        </tbody>
      </Scroll>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        <span className="text-muted font-semibold">The split point that matters:</span> field ops lives in Operate, not Track.
        Theft alerts get them in the door; the daily-log habit is what makes leaving unthinkable. Price the door low, the habit fairly.
        <span className="text-muted font-semibold"> Run&apos;s platform price stays unpublished</span> — and never publish a typical Run total either, because the fee leaks by arithmetic.
      </p>

      <H>Founding 25</H>
      <div className="grid md:grid-cols-2 gap-2.5">
        <Box tone="amber">
          <h3 className="font-display font-bold text-[15px] text-ink mb-1">$6 / machine · $3 / tag</h3>
          <p className="text-[13px] text-faint leading-relaxed">
            Operate features included, no platform fee, 12-month price lock, hardware at cost, month-to-month.
            Free 30-day pilot, no card. First install done with you.
          </p>
          <p className="text-[12.5px] text-faint mt-2 leading-relaxed">
            Margin-thin, never margin-negative — every asset still clears its COGS floor. Discount with tags and fee
            waivers, <span className="text-muted font-semibold">never below $6 on a SIM</span>.
          </p>
        </Box>
        <Box>
          <h3 className="font-display font-bold text-[15px] text-ink mb-1">The three rules underneath the pricing</h3>
          <ul className="list-disc pl-4 space-y-1 text-[13px] text-faint leading-relaxed">
            <li>Never price a SIM-carrying asset below <span className="text-ink font-semibold">$6/mo</span> — COGS is $2–4.</li>
            <li>Tool tags are near-pure margin. Use them to feel generous.</li>
            <li>Software costs nothing marginal — it splits <span className="text-ink font-semibold">tiers</span>, not per-unit prices.</li>
          </ul>
          <p className="text-[12.5px] text-faint mt-2 leading-relaxed">
            And one competitive rule: <span className="text-muted font-semibold">unlimited users, every tier, forever.</span> Charging for seats would tax our own moat.
          </p>
        </Box>
      </div>

      <H>Cost curve</H>
      <Scroll>
        <thead><tr><Th />{COST_COLS.map((c) => <Th key={c} right>{c}</Th>)}</tr></thead>
        <tbody>
          {COST_CURVE.map((r) => (
            <tr key={r.label} className={r.emphasis ? 'bg-amber/[0.04]' : ''}>
              <Td strong={r.emphasis}>{r.label}</Td>
              {r.cells.map((c, i) => <Td key={i} right>{c}</Td>)}
            </tr>
          ))}
        </tbody>
      </Scroll>

      <H>Today&apos;s burn — pre-revenue</H>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {BURN.map((b) => (
          <Box key={b.what}>
            <h3 className="font-mono font-bold text-lg text-ink tabular-nums">{b.amount}</h3>
            <p className="text-[12px] text-faint mt-0.5">{b.what}</p>
          </Box>
        ))}
      </div>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        Hardware passes through <span className="text-muted font-semibold">at cost</span> — no margin, no inventory risk beyond the
        proof-of-concept batch. Founder pay is $0 through 2028; Dillard Construction remains the paycheck, and the model
        breaks the month that changes.
      </p>

      <H>Hire triggers</H>
      <Scroll>
        <thead><tr><Th>Hire</Th><Th>Trigger</Th><Th right>Loaded /mo</Th><Th>Fires</Th></tr></thead>
        <tbody>
          {HIRES.map((h) => (
            <tr key={h.role}>
              <Td strong>
                {h.role}
                {h.note && <span className="block text-[11.5px] text-faint font-normal mt-0.5 leading-relaxed">{h.note}</span>}
              </Td>
              <Td>{h.trigger}</Td><Td right>{h.cost}</Td><Td>{h.when}</Td>
            </tr>
          ))}
        </tbody>
      </Scroll>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        A hire lands when its loaded cost is ≤ ~60% of the MRR added since the last one. Each jump knocks the P&amp;L back
        to roughly breakeven and growth pays it off in two to three quarters.{' '}
        <span className="text-muted font-semibold">S1 is the one deliberate exception</span> — it fires at zero customers
        because the constraint it relieves is founder hours, not demand, and its risk controls replace the trigger. See the Sales tab.
      </p>
    </>
  )
}

function FleetTab({ live }: { live: BoardLive }) {
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">
        Four models, and <span className="text-ink font-semibold">every one of them comes alive differently</span> — which is
        why getting it wrong looks exactly like broken hardware.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Box><h3 className="font-display font-bold text-2xl text-ink tabular-nums">{live.devices.total}</h3><p className="text-[12px] text-faint mt-0.5">devices logged</p></Box>
        <Box><h3 className="font-display font-bold text-2xl text-teal tabular-nums">{live.devices.online}</h3><p className="text-[12px] text-faint mt-0.5">reporting</p></Box>
        <Box><h3 className="font-display font-bold text-2xl text-ink tabular-nums">{live.assets.total}</h3><p className="text-[12px] text-faint mt-0.5">assets</p></Box>
        <Box><h3 className="font-display font-bold text-2xl text-ink tabular-nums">{live.assets.tools}</h3><p className="text-[12px] text-faint mt-0.5">tool tags</p></Box>
      </div>

      <H>Per-model power-up</H>
      <Scroll>
        <thead><tr><Th>Model</Th><Th>SIM</Th><Th>Ships how</Th><Th>To bring it alive</Th><Th>Gateway?</Th></tr></thead>
        <tbody>
          {MODEL_ORDER.filter((m) => m !== 'OTHER').map((m) => {
            const s = MODELS[m]
            const trap = s.prep.find((p) => p.gotcha)
            return (
              <tr key={m}>
                <Td strong>{m}</Td>
                <Td>{s.sim ?? '—'}</Td>
                <Td>{s.power}</Td>
                <Td>{trap ? trap.label : s.firstContact}</Td>
                <Td>{s.gateway ? `Yes · ${s.beaconCap}/record` : 'No'}</Td>
              </tr>
            )
          })}
        </tbody>
      </Scroll>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        Full per-model checklists, with the symptom each skipped step produces, live on{' '}
        <Link href="/assets/onboard" className="text-amber hover:underline">Hardware setup</Link>.
      </p>

      <H>Where the iron goes</H>
      <Box>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {IRON.map((i) => (
            <div key={i.machines} className="contents">
              <dt className="text-faint whitespace-nowrap">{i.machines}</dt>
              <dd className="text-ink m-0 leading-relaxed">{i.fit}</dd>
            </div>
          ))}
        </dl>
      </Box>

      <H>Pilot units</H>
      <div className="grid md:grid-cols-2 gap-2.5">
        <Box tone="live">
          <h3 className="font-display font-bold text-[15px] text-ink mb-1">T1-a — Chevy 1500</h3>
          <p className="text-[13px] text-faint leading-relaxed">
            Live since 6 Jul. Full pipeline verified end to end: OBD → Hologram → flespi → webhook → Supabase → map.
            Real after-hours theft alerts fired in production 4–5 Aug.
          </p>
        </Box>
        <Box tone="stop">
          <h3 className="font-display font-bold text-[15px] text-ink mb-1">T1-b — 2003 Chevy</h3>
          <p className="text-[13px] text-faint leading-relaxed">
            Dark since 13 Aug with a healthy, unpaused SIM — so it is the power path, not config.
            Bypass the OBD extension and check the port fuse; /assets/onboard shows the live state.
          </p>
        </Box>
      </div>
    </>
  )
}

function MarketTab() {
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">
        The pitch is <span className="text-ink font-semibold">about half the price of Tenna, $0 setup</span> — and that is the
        only discount claim allowed on any surface. No other percentages, no per-asset teaser numbers.
      </p>

      <H>The field</H>
      <Scroll>
        <thead><tr><Th>Competitor</Th><Th>Their price</Th><Th>The friction we sell against</Th></tr></thead>
        <tbody>
          {COMPETITORS.map((c) => (
            <tr key={c.name} className={c.lead ? 'bg-amber/[0.04]' : ''}>
              <Td strong>
                {c.name}
                {c.note && <span className="block text-[11.5px] text-faint font-normal mt-0.5">{c.note}</span>}
              </Td>
              <Td>{c.price}</Td>
              <Td>{c.friction}</Td>
            </tr>
          ))}
        </tbody>
      </Scroll>

      <H>Go to market</H>
      <div className="grid md:grid-cols-3 gap-2.5">
        <Box><h3 className="font-display font-bold text-[15px] text-ink mb-1">The hook</h3><p className="text-[13px] text-faint leading-relaxed">&ldquo;Your excavator left at 2 AM.&rdquo; Theft is the fear that opens the wallet — everything else is what keeps it open.</p></Box>
        <Box><h3 className="font-display font-bold text-[15px] text-ink mb-1">The funnel</h3><p className="text-[13px] text-faint leading-relaxed">Facebook/Instagram theft ad → hammertrack.ai/demo → /register. Ad variants written and waiting.</p></Box>
        <Box><h3 className="font-display font-bold text-[15px] text-ink mb-1">The beachhead</h3><p className="text-[13px] text-faint leading-relaxed">Upstate SC — Greenville, Spartanburg, Anderson — then the Charlotte and Atlanta corridors. Contractor Facebook groups plus equipment-dealer referrals.</p></Box>
      </div>

      <H>Claims currently ahead of reality</H>
      <Box tone="warn">
        <ul className="space-y-1.5 text-[13px] text-faint leading-relaxed">
          {TRUTH_WATCH.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="text-[12.5px] text-faint mt-3 leading-relaxed">
          Kept on the board so they can&apos;t quietly age. If either slips much further, the built-in claims need
          ROADMAP treatment under the splash truth rule.
        </p>
      </Box>
    </>
  )
}

function OpsTab() {
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">The plumbing: what&apos;s live, what&apos;s pending, and where the real documents live.</p>

      <H>Vendor accounts</H>
      <Scroll>
        <thead><tr><Th>Account</Th><Th>State</Th><Th>Note</Th></tr></thead>
        <tbody>
          {VENDORS.map((v) => (
            <tr key={v.name} className={v.state === 'stop' ? 'bg-alert/[0.05]' : ''}>
              <Td strong>{v.name}</Td>
              <Td><Pill tone={v.state}>{v.stateLabel}</Pill></Td>
              <Td>{v.note}</Td>
            </tr>
          ))}
        </tbody>
      </Scroll>

      <H>Environment</H>
      <div className="grid md:grid-cols-2 gap-2.5">
        <Box tone="warn">
          <h3 className="font-display font-bold text-[15px] text-ink mb-2">Still unset</h3>
          <ul className="space-y-1.5">
            {ENV_PENDING.map((e) => (
              <li key={e.text} className="flex gap-2.5 items-baseline text-[13px] text-faint leading-relaxed">
                <span className={`shrink-0 w-[5px] h-[5px] rounded-[1px] translate-y-[-2px] ${e.tone === 'no' ? 'bg-alert' : 'bg-amber'}`} />
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </Box>
        <Box tone="live">
          <h3 className="font-display font-bold text-[15px] text-ink mb-2">Live and load-bearing</h3>
          <ul className="space-y-1.5">
            {ENV_LIVE.map((e) => (
              <li key={e} className="flex gap-2.5 items-baseline text-[13px] text-faint leading-relaxed">
                <span className="shrink-0 w-[5px] h-[5px] rounded-[1px] translate-y-[-2px] bg-teal" />
                <span>{e}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-faint mt-3 leading-relaxed">
            <span className="text-muted font-semibold">Migration rule:</span> a file is frozen the moment any push carries it —
            preview builds run against the same production database. Fix-ups always go in a new file.
          </p>
        </Box>
      </div>

      <H>Where the detail lives</H>
      <div className="grid md:grid-cols-3 gap-2.5">
        {DOC_INDEX.map((g) => (
          <Box key={g.group}>
            <h3 className="font-display font-bold text-[15px] text-ink mb-1.5">{g.group}</h3>
            <ul className="space-y-0.5">
              {g.files.map((f) => <li key={f} className="font-mono text-[11.5px] text-faint">{f}</li>)}
            </ul>
          </Box>
        ))}
      </div>

      <H>Standing rules</H>
      <Box>
        <ul className="space-y-2 text-[13px] text-faint leading-relaxed">
          {RULES.map((r) => (
            <li key={r.name}><span className="text-ink font-semibold">{r.name}</span> — {r.text}</li>
          ))}
        </ul>
      </Box>
    </>
  )
}

function SalesTab() {
  return (
    <>
      <p className="text-faint text-[14px] max-w-[72ch] mb-5">
        Founder-only selling made you the bottleneck, so the sales hire came forward from Phase 3 —
        with a shape built to avoid the classic mistake of hiring a closer before the pitch is proven.
      </p>

      <H>The motion, in order of expected yield</H>
      <div className="rounded-xl border border-navy-800 bg-navy-900 px-4">
        {SELLING_MOTION.map((m, i) => (
          <div key={m.step} className={`grid grid-cols-[26px_1fr] gap-3 py-3 ${i ? 'border-t border-navy-800/60' : ''}`}>
            <span className="font-mono text-[11px] text-faint pt-0.5">{i + 1}</span>
            <span>
              <span className="block font-display font-bold text-[14px] text-ink">{m.step}</span>
              <span className="block text-[13px] text-faint mt-0.5 leading-relaxed">{m.detail}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        <span className="text-muted font-semibold">Beachhead:</span> Upstate SC — Greenville, Spartanburg, Anderson —
        then the Charlotte and Atlanta corridors. Nashville was demo-data fiction; you sell where people already return
        your calls. The demo stage stays on the Nashville grid deliberately until a Greenville restage earns its keep.
      </p>

      <H>S1 — the field sales &amp; install hire</H>
      <Box tone="amber">
        <dl className="grid md:grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
          {S1_SHAPE.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-faint whitespace-nowrap md:pt-px">{r.label}</dt>
              <dd className="text-ink m-0 leading-relaxed">{r.value}</dd>
            </div>
          ))}
        </dl>
      </Box>
      <p className="text-[12.5px] text-faint leading-relaxed mt-3">
        <span className="text-muted font-semibold">S1 absorbs H1</span> — the Aug &rsquo;27 installer hire simply arrives
        early and earns its keep selling, so the headcount plan nets zero extra people.
      </p>
    </>
  )
}

/* ── shell ───────────────────────────────────────────────────────────── */

export function FounderBoard({ live }: { live: BoardLive }) {
  const [tab, setTab] = useState<Tab>('Now')
  const c = taskCounts()

  // Restore the last tab so reopening the board lands where you left it.
  // Read in an effect rather than during render: localStorage doesn't exist
  // on the server, and seeding state from it would hydrate-mismatch.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY) as Tab | null
      if (saved && (TABS as readonly string[]).includes(saved)) setTab(saved)
    } catch { /* private window or blocked storage — the default is fine */ }
  }, [])

  const pick = (t: Tab) => {
    setTab(t)
    try { localStorage.setItem(STORE_KEY, t) } catch { /* ignore */ }
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-xl text-ink">Control Room</h1>
            <p className="text-[12.5px] text-faint mt-0.5 max-w-[62ch] leading-relaxed">
              Every open item, the road ahead, the money and the iron — one board instead of nine documents.
            </p>
          </div>
          <div className="font-mono text-[11px] text-faint text-right leading-relaxed">
            Stage 0 · pre-revenue<br />
            {c.open} open · {c.done} shipped
          </div>
        </div>

        <div className="flex gap-0.5 overflow-x-auto border-b border-navy-800 mt-4 mb-6 -mx-4 px-4 md:mx-0 md:px-0 no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => pick(t)}
              aria-current={tab === t}
              className={`font-display font-bold text-[12px] uppercase tracking-[0.11em] px-3.5 py-3 border-b-2 whitespace-nowrap transition-colors ${
                tab === t ? 'text-amber border-amber' : 'text-faint border-transparent hover:text-ink'
              }`}
            >
              {t}
              {t === 'Build' && <span className="font-mono text-[10px] ml-1.5 font-normal">{c.open}</span>}
            </button>
          ))}
        </div>

        {tab === 'Now' && <NowTab live={live} />}
        {tab === 'Build' && <BuildTab />}
        {tab === 'Roadmap' && <RoadmapTab />}
        {tab === 'Sales' && <SalesTab />}
        {tab === 'Money' && <MoneyTab />}
        {tab === 'Fleet' && <FleetTab live={live} />}
        {tab === 'Market' && <MarketTab />}
        {tab === 'Ops' && <OpsTab />}

        <p className="text-[11.5px] text-faint mt-10 pt-4 border-t border-navy-800 leading-relaxed">
          Device and asset counts are live. Everything else is the standing picture in{' '}
          <span className="font-mono">lib/board.ts</span>, transcribed from <span className="font-mono">docs/</span> — if they
          ever disagree, the docs win and this board is stale.
        </p>
      </div>
    </div>
  )
}
