'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, HardHat, Wrench, Users } from 'lucide-react'
import { type Project, projectCost, money, moneyFull, STATUS_META } from '@/lib/projects'

interface ProjectsPanelProps {
  projects: Project[]
  t: number
  scrubbing: boolean
}

export function ProjectsPanel({ projects, t, scrubbing }: ProjectsPanelProps) {
  const [open, setOpen] = useState(true)

  const costs = projects.map((p) => projectCost(p, t))
  const todayLabor = costs.reduce((s, c) => s + c.laborToday, 0)
  const todayEquip = costs.reduce((s, c) => s + c.equipToday, 0)

  return (
    <div className="absolute right-3 top-[150px] z-10 w-[232px] rounded-xl bg-navy-950/85 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3 py-2.5 border-b border-navy-800">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint flex items-center gap-2">
          <HardHat className="h-3.5 w-3.5 text-amber" /> Projects · {projects.length}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
      </button>

      {open && (
        <div className="p-2.5 space-y-2.5">
          {projects.map((p, i) => {
            const c = costs[i]
            const st = STATUS_META[c.status]
            return (
              <div key={p.id} className="rounded-lg border border-navy-800 bg-navy-900 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-ink">{p.name}</span>
                  <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                </div>
                {/* budget burn */}
                <div className="mt-2 h-1.5 rounded-full bg-navy-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, c.burnPct)}%`, background: c.status === 'over_budget' ? '#fb5d5d' : p.color }}
                  />
                </div>
                <div className="mt-1 font-mono text-[10px] text-faint">
                  {moneyFull(c.spentWithToday)} of {money(p.budget)} · {c.burnPct.toFixed(0)}%
                </div>
                {/* today's cost split */}
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className="rounded-md bg-navy-950/60 px-2 py-1.5">
                    <div className="font-mono text-[9px] text-faint flex items-center gap-1"><Users className="h-3 w-3" /> Labor</div>
                    <div className="font-display font-bold text-[13px] text-ink">{money(c.laborToday)}</div>
                  </div>
                  <div className="rounded-md bg-navy-950/60 px-2 py-1.5">
                    <div className="font-mono text-[9px] text-faint flex items-center gap-1"><Wrench className="h-3 w-3" /> Equip</div>
                    <div className="font-display font-bold text-[13px] text-ink">{money(c.equipToday)}</div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* today total */}
          <div className="rounded-lg border border-amber/30 bg-amber/[0.06] p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              {scrubbing ? 'Cost to this point' : 'Cost today'}
            </div>
            <div className="font-display font-black text-[20px] text-amber">{moneyFull(todayLabor + todayEquip)}</div>
            <div className="font-mono text-[10px] text-faint mt-0.5">
              {money(todayLabor)} labor + {money(todayEquip)} equipment
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
