/**
 * "Mission control" map console used as the homepage hero — now a clear,
 * clickable entry into the real live map. Pure CSS/markup mock (no map engine)
 * so the marketing page stays fast; tapping it opens the actual /map.
 */
import Link from 'next/link'
import { ArrowRight, Maximize2 } from 'lucide-react'

const PINS = [
  { c: 'amber', top: '38%', left: '22%', name: 'Chevy 1500' },
  { c: 'teal', top: '56%', left: '36%', name: 'Link-Belt 130X2' },
  { c: 'amber', top: '64%', left: '66%', name: 'Peterbilt 567' },
  { c: 'teal', top: '40%', left: '76%', name: 'Sakai SW990' },
  { c: 'teal', top: '50%', left: '52%', name: 'TB235 Mini-Ex' },
  { c: 'amber', top: '70%', left: '27%', name: 'RAM 3500' },
] as const

const FEED = [
  { dot: 'bg-alert', name: 'TB235 Mini-Ex', status: '2:14 AM ⚠', alert: true },
  { dot: 'bg-teal', name: 'Link-Belt 130X2', status: 'idle 4h' },
  { dot: 'bg-amber', name: 'RAM 3500 · Crew 2', status: 'moving' },
  { dot: 'bg-teal', name: 'Sakai SW990', status: 'service due' },
  { dot: 'bg-amber', name: 'Tool kit · Bay A', status: '5 tags' },
]

export function MapConsole() {
  return (
    <Link
      href="/live"
      className="group block rounded-2xl bg-gradient-to-b from-navy-900 to-navy-950 border border-navy-800 shadow-panel overflow-hidden ring-1 ring-teal/5 hover:ring-teal/30 hover:border-teal/30 transition-all"
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-navy-800">
        <span className="font-mono text-[12.5px] text-faint">~/fleet/live-demo</span>
        <span className="font-mono text-[11px] text-teal flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-teal shadow-glow-teal animate-blink" /> LIVE DEMO
        </span>
      </div>
      <div className="grid md:grid-cols-[1fr_260px]">
        {/* map */}
        <div className="relative aspect-[16/9] border-b md:border-b-0 md:border-r border-navy-800 bg-[#001120]">
          <div className="absolute inset-0 map-grid" />
          <div className="absolute left-0 right-0 h-[3px] bg-[rgba(111,136,160,0.13)]" style={{ top: '46%' }} />
          <div className="absolute top-0 bottom-0 w-[3px] bg-[rgba(111,136,160,0.13)]" style={{ left: '62%' }} />
          {/* zones with names — reads like the real map */}
          <div className="absolute rounded-[14px] border-[1.5px] border-dashed border-amber/50 bg-amber/[0.06]" style={{ top: '30%', left: '12%', width: '40%', height: '42%' }}>
            <span className="absolute -top-2.5 left-3 font-mono text-[9.5px] font-bold text-amber bg-[#001120] px-1.5">RIVERFRONT TOWER</span>
          </div>
          <div className="absolute rounded-[14px] border-[1.5px] border-dashed border-teal/45 bg-teal/[0.05]" style={{ top: '24%', left: '64%', width: '26%', height: '30%' }}>
            <span className="absolute -top-2.5 left-3 font-mono text-[9.5px] font-bold text-teal bg-[#001120] px-1.5">EQUIPMENT YARD</span>
          </div>
          {/* movement trail behind the moving truck */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 56" preserveAspectRatio="none">
            <path
              d="M 22 22 L 22 30 L 34 30 L 34 36 L 52 36 L 52 28 L 66 28"
              fill="none" stroke="#ff9e16" strokeOpacity="0.55" strokeWidth="0.55" strokeDasharray="1.6 1.1" strokeLinecap="round"
            />
          </svg>
          {/* asset popup chip — shows the product actually does something */}
          <div className="absolute bg-[#001a2e] border border-[#14506f] rounded-lg px-2.5 py-1.5 shadow-xl" style={{ top: '57%', left: '30%' }}>
            <p className="font-display font-bold text-[10.5px] text-ink leading-tight">Link-Belt 130X2 Excavator</p>
            <p className="font-mono text-[9px] text-teal leading-tight mt-0.5">on site · 42% batt · 4h idle</p>
          </div>
          <div className="absolute top-3.5 left-3.5 flex items-center gap-2 bg-[rgba(0,17,32,0.8)] backdrop-blur border border-teal/30 rounded-[10px] px-3 py-2 font-mono text-[11px] text-teal">
            ◇ AI · learning normal patterns
          </div>
          {/* persistent "open" chip (mobile has no hover) */}
          <span className="absolute top-3.5 right-3.5 flex items-center gap-1.5 bg-amber/15 border border-amber/40 text-amber rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold">
            <Maximize2 className="h-3 w-3" /> Tap to open
          </span>
          {PINS.map((p, i) => (
            <span key={i} className="absolute" style={{ top: p.top, left: p.left }}>
              <span
                className={`block w-[13px] h-[13px] rounded-full border-2 border-[rgba(0,17,32,0.6)] ${p.c === 'amber' ? 'bg-amber shadow-[0_0_12px_-1px_#ff9e16]' : 'bg-teal shadow-[0_0_12px_-1px_#2dd4bf]'}`}
              />
              {/* named dots — reads like the real map (Brian, Aug 5) */}
              <span className="absolute left-1/2 -translate-x-1/2 top-[15px] whitespace-nowrap font-mono text-[8.5px] font-semibold text-ink/90 [text-shadow:0_1px_3px_rgba(0,10,20,.95)]">
                {p.name}
              </span>
            </span>
          ))}
          <span
            className="absolute w-[18px] h-[18px] rounded-full bg-alert shadow-[0_0_0_6px_rgba(251,93,93,0.2),0_0_16px_#fb5d5d] animate-pulse-ring"
            style={{ top: '20%', left: '84%' }}
          />
          {/* desktop hover overlay */}
          <div className="absolute inset-0 hidden md:grid place-items-center bg-navy-950/0 group-hover:bg-navy-950/45 transition-colors">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-2 font-display font-bold text-ink bg-amber text-[#1a1100] rounded-xl px-5 py-3 shadow-glow-amber">
              Open the live map <ArrowRight className="h-4 w-4" />
            </span>
          </div>
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
      {/* footer CTA bar — always visible, unmistakable on every device */}
      <div className="flex items-center justify-center gap-2 px-5 py-3.5 border-t border-navy-800 bg-amber/[0.06] group-hover:bg-amber/[0.12] transition-colors font-display font-bold text-amber">
        Open the live map — explore the real thing
        <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  )
}
