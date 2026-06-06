/**
 * Presentational "mission control" map console used as the homepage hero.
 * Pure CSS/markup mock of the live map + AI activity feed — no map engine,
 * keeps the marketing page fast and dependency-free.
 */
const PINS = [
  { c: 'amber', top: '38%', left: '22%' },
  { c: 'teal', top: '56%', left: '36%' },
  { c: 'amber', top: '64%', left: '66%' },
  { c: 'teal', top: '40%', left: '76%' },
  { c: 'teal', top: '50%', left: '52%' },
  { c: 'amber', top: '70%', left: '27%' },
] as const

const FEED = [
  { dot: 'bg-alert', name: 'Skid Steer #3', status: '2:14 AM ⚠', alert: true },
  { dot: 'bg-teal', name: 'Excavator 320', status: 'idle 4h' },
  { dot: 'bg-amber', name: 'F-250 · Crew 2', status: 'moving' },
  { dot: 'bg-teal', name: 'Dozer D6', status: 'service due' },
  { dot: 'bg-amber', name: 'Tool kit · Bay A', status: '5 tags' },
]

export function MapConsole() {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-navy-900 to-navy-950 border border-navy-800 shadow-panel overflow-hidden ring-1 ring-teal/5">
      <div className="flex items-center justify-between px-5 py-3 border-b border-navy-800">
        <span className="font-mono text-[12.5px] text-faint">~/fleet/dillard-construction</span>
        <span className="font-mono text-[11px] text-teal flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-teal shadow-glow-teal animate-blink" /> LIVE
        </span>
      </div>
      <div className="grid md:grid-cols-[1fr_260px]">
        {/* map */}
        <div className="relative aspect-[16/9] border-b md:border-b-0 md:border-r border-navy-800 bg-[#001120]">
          <div className="absolute inset-0 map-grid" />
          <div className="absolute left-0 right-0 h-[3px] bg-[rgba(111,136,160,0.13)]" style={{ top: '46%' }} />
          <div className="absolute top-0 bottom-0 w-[3px] bg-[rgba(111,136,160,0.13)]" style={{ left: '62%' }} />
          <div className="absolute rounded-[14px] border-[1.5px] border-dashed border-teal/40 bg-teal/5" style={{ top: '30%', left: '12%', width: '40%', height: '42%' }} />
          <div className="absolute top-3.5 left-3.5 flex items-center gap-2 bg-[rgba(0,17,32,0.8)] backdrop-blur border border-teal/30 rounded-[10px] px-3 py-2 font-mono text-[11px] text-teal">
            ◇ AI · learning normal patterns
          </div>
          {PINS.map((p, i) => (
            <span
              key={i}
              className={`absolute w-[13px] h-[13px] rounded-full border-2 border-[rgba(0,17,32,0.6)] ${p.c === 'amber' ? 'bg-amber shadow-[0_0_12px_-1px_#ff9e16]' : 'bg-teal shadow-[0_0_12px_-1px_#2dd4bf]'}`}
              style={{ top: p.top, left: p.left }}
            />
          ))}
          <span
            className="absolute w-[18px] h-[18px] rounded-full bg-alert shadow-[0_0_0_6px_rgba(251,93,93,0.2),0_0_16px_#fb5d5d] animate-pulse-ring"
            style={{ top: '20%', left: '84%' }}
          />
        </div>
        {/* feed */}
        <div className="p-3.5 flex flex-col gap-2.5 bg-navy-900">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint flex justify-between mb-0.5">
            <span>AI Activity Feed</span>
            <span className="text-teal">●</span>
          </div>
          {FEED.map((r) => (
            <div
              key={r.name}
              className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] border ${r.alert ? 'border-alert/35 bg-alert/[0.07]' : 'border-navy-800 bg-navy-850'}`}
            >
              <span className={`w-2 h-2 rounded-full flex-none ${r.dot}`} />
              <span className="text-[12.5px] font-medium text-ink">{r.name}</span>
              <span className={`font-mono text-[10.5px] ml-auto ${r.alert ? 'text-alert' : 'text-faint'}`}>{r.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
