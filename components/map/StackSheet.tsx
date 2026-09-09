'use client'

import { useMemo } from 'react'
import { Layers, ZoomIn } from 'lucide-react'
import type { AssetType, AssetWithLocation } from '@/lib/types'
import { MapSheet } from './MapSheet'

/**
 * A tapped cluster, listed (Brian, Sep 9: "multiple items in one general
 * area and ability to cleanly show this on the map"). The blob already says
 * "2 trucks · 1 machine · 5 tools aboard" under its count; this sheet names
 * them — every truck, machine and person in the stack with its state and
 * the tools it is hauling — and one tap on a row opens that asset. "Zoom in
 * here" is the old expand-the-cluster behaviour, kept one tap away.
 */
export interface StackPick {
  /** Cluster position (lng, lat). */
  at: [number, number]
  expansionZoom: number
  members: AssetWithLocation[]
  /** The cluster's real count — the list stops at 500 members. */
  total: number
  /** Tools riding each gateway right now (asset id → count). */
  toolCounts: Record<string, number>
}

const TYPE_COLOR: Record<AssetType, string> = { vehicle: '#ff9e16', equipment: '#60a5fa', personnel: '#34d399', tool: '#a78bfa' }
const ORDER: AssetType[] = ['vehicle', 'equipment', 'personnel', 'tool']
const GROUP_LABEL: Record<AssetType, [string, string]> = {
  vehicle: ['truck', 'trucks'], equipment: ['machine', 'machines'], personnel: ['person', 'people'], tool: ['tool', 'tools'],
}
const DEAD_MS = 48 * 3_600_000

function ageWord(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(1, Math.floor(ms / 60_000))} min`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h`
  return `${Math.floor(ms / 86_400_000)} d`
}

/** One glance-word per asset — same four states the map dots use. */
function stateOf(a: AssetWithLocation, now: number): { word: string; tone: string } {
  const loc = a.location
  if (!loc) return { word: 'no signal', tone: 'text-faint' }
  const age = now - new Date(loc.timestamp).getTime()
  if (age > DEAD_MS) return { word: `dark · ${ageWord(age)}`, tone: 'text-faint' }
  if (age < 15 * 60_000 && (loc.speed ?? 0) > 2) return { word: `moving · ${Math.round(loc.speed ?? 0)} mph`, tone: 'text-teal' }
  if (age < 15 * 60_000) return { word: 'idle', tone: 'text-muted' }
  return { word: `parked · ${ageWord(age)}`, tone: 'text-muted' }
}

export function StackSheet({ stack, onPick, onZoom, onClose }: {
  stack: StackPick
  onPick: (a: AssetWithLocation) => void
  onZoom: () => void
  onClose: () => void
}) {
  const now = Date.now()
  const groups = useMemo(() => ORDER
    .map((t) => ({ type: t, items: stack.members.filter((a) => a.type === t).sort((x, y) => x.name.localeCompare(y.name)) }))
    .filter((g) => g.items.length), [stack.members])
  const toolsAboard = stack.members.reduce((s, a) => s + (stack.toolCounts[a.id] ?? 0), 0)
  const moving = stack.members.filter((a) => stateOf(a, now).word.startsWith('moving')).length
  const summary = [
    ...groups.map((g) => `${g.items.length} ${GROUP_LABEL[g.type][g.items.length === 1 ? 0 : 1]}`),
    ...(toolsAboard ? [`${toolsAboard} ${toolsAboard === 1 ? 'tool' : 'tools'} aboard`] : []),
  ].join(' · ')

  const list = (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.type}>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] mb-1" style={{ color: TYPE_COLOR[g.type] }}>
            {g.items.length} {GROUP_LABEL[g.type][g.items.length === 1 ? 0 : 1]}
          </p>
          <ul className="divide-y divide-navy-800/70 rounded-lg border border-navy-800 overflow-hidden">
            {g.items.map((a) => {
              const st = stateOf(a, now)
              const tools = stack.toolCounts[a.id] ?? 0
              const color = /^#[0-9a-fA-F]{3,8}$/.test(String(a.metadata?.color ?? '')) ? String(a.metadata!.color) : TYPE_COLOR[a.type]
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => onPick(a)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-navy-900/70 active:bg-navy-900">
                    <span className="h-2.5 w-2.5 rounded-full flex-none ring-2 ring-navy-950" style={{ background: color }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-ink truncate">{a.name}</span>
                      <span className={`block text-[11px] ${st.tone}`}>{st.word}</span>
                    </span>
                    {tools > 0 && (
                      <span className="flex-none inline-flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 font-mono text-[10px] text-violet-300" title={`${tools} tool${tools === 1 ? '' : 's'} aboard`}>
                        🔧 {tools}
                      </span>
                    )}
                    <span className="text-faint text-[12px] flex-none">›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <button type="button" onClick={onZoom} className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-navy-700 bg-navy-900 py-2.5 text-[12.5px] font-semibold text-ink hover:border-amber/50">
        <ZoomIn className="h-4 w-4" /> Zoom in here
      </button>
    </div>
  )

  return (
    <MapSheet
      icon={<Layers className="h-5 w-5 text-amber" />}
      title={`${stack.total} stacked here`}
      subtitle={<span className="text-muted">{summary}{stack.total > stack.members.length ? ` · showing ${stack.members.length} of ${stack.total}` : ''}</span>}
      badge={moving > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-teal">
          <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" /> {moving} moving
        </span>
      ) : undefined}
      peek={({ expand }) => (
        <div className="space-y-2">
          <p className="text-[12.5px] text-muted">{summary}</p>
          <div className="flex gap-2">
            <button type="button" onClick={expand} className="flex-1 rounded-xl bg-amber py-2.5 text-[12.5px] font-display font-bold text-[#1a1100]">Show the list</button>
            <button type="button" onClick={onZoom} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-navy-700 bg-navy-900 py-2.5 text-[12.5px] font-semibold text-ink"><ZoomIn className="h-4 w-4" /> Zoom in</button>
          </div>
        </div>
      )}
      onClose={onClose}
    >
      {list}
    </MapSheet>
  )
}
