'use client'

import Link from 'next/link'
import { Activity, Banknote, CalendarClock, ClipboardCheck, CloudRain, Construction, FlaskConical, Gauge, IdCard, Languages, Scale, Truck } from 'lucide-react'
import type { Tool } from '@/lib/beta/tools'
import { BetaPage, StatePill } from './ui'
import { useLang } from '@/lib/i18n'

const ICON: Record<string, typeof Truck> = {
  payroll: Banknote, liens: Scale, weather: CloudRain, locates: Construction, haul: Truck, dvir: ClipboardCheck,
  credentials: IdCard, espanol: Languages, owning: Gauge, rentals: CalendarClock, activation: Activity,
}

export function BetaHub({ tools, due, demo }: { tools: Omit<Tool, 'canOpen'>[]; due: Record<string, { overdue: number; soon: number }>; demo: boolean }) {
  const { t } = useLang()
  const groups = Array.from(new Set(tools.map((x) => x.group)))
  return (
    <BetaPage back={false} title={t('Beta')} icon={<FlaskConical className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="Tools we’re trying out. Each one rides data HammerTrack already has — your trackers, time cards, sites and jobs. They work today; tell us what’s missing.">
      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{g}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {tools.filter((x) => x.group === g).map((x) => {
              const Icon = ICON[x.key] ?? FlaskConical
              const d = due[x.key]
              return (
                <Link key={x.key} href={x.href} className="group rounded-xl border border-navy-800 bg-navy-900/60 p-3 hover:border-violet-400/50 transition-colors min-w-0">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-violet-500/10 text-violet-200"><Icon className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink flex flex-wrap items-center gap-2">{x.title}
                        {d?.overdue ? <StatePill state="overdue">{d.overdue} past due</StatePill> : null}
                        {d?.soon ? <StatePill state="soon">{d.soon} due soon</StatePill> : null}
                      </p>
                      <p className="text-faint text-[12.5px] mt-0.5">{x.blurb}</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
      <p className="text-faint text-[12px]">Our service status is public at <Link href="/status" className="text-teal underline">hammertrack.ai/status</Link>.</p>
    </BetaPage>
  )
}
