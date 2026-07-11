'use client'

import { MapSheet } from './MapSheet'
import { DEVICE_META, type SiteDevice } from '@/lib/site-devices'

/** Site device (camera / fuel / generator / pump / weather) in the shared sheet. */
export function DevicePanel({ device, onClose }: { device: SiteDevice; onClose: () => void }) {
  const meta = DEVICE_META[device.type]
  const pct = device.value ?? 0
  const low = pct < 20

  return (
    <MapSheet
      icon={<span className="text-2xl">{meta.emoji}</span>}
      title={device.name}
      subtitle={
        <span className="flex items-center gap-1.5 font-mono">
          <span className={'w-1.5 h-1.5 rounded-full ' + (device.online ? 'bg-[#34d399]' : 'bg-faint')} />
          {device.online ? 'Online' : 'Offline'} · {meta.label}
        </span>
      }
      onClose={onClose}
    >
      {device.type === 'camera' ? (
        <div className="space-y-3">
          <div className="relative aspect-video rounded-xl overflow-hidden border border-navy-800"
            style={{ background: 'repeating-linear-gradient(120deg,#0a2236,#0a2236 10px,#0c2740 10px,#0c2740 20px)' }}>
            <span className="absolute top-2 right-2 flex items-center gap-1.5 font-mono text-[10px] text-[#fb5d5d]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#fb5d5d] animate-blink" /> LIVE
            </span>
            <span className="absolute bottom-2 left-2 font-mono text-[10px] text-[#cfe] bg-black/45 rounded px-1.5 py-0.5">
              snapshot · updated 12s ago
            </span>
          </div>
          <button className="w-full rounded-lg bg-navy-800 border border-navy-700 text-ink text-sm font-medium py-2.5 hover:bg-navy-700 transition-colors">
            Open full feed →
          </button>
        </div>
      ) : device.type === 'fuel' || device.type === 'generator' ? (
        <div className="space-y-2">
          <p className="font-display font-black text-3xl text-ink">{pct}%</p>
          <div className="h-2 rounded-full bg-[#073a5a] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: low ? '#fb5d5d' : meta.color }} />
          </div>
          <p className="font-mono text-[12px] text-muted">{device.status}</p>
          {low && <p className="font-mono text-[11px] text-[#fb5d5d]">Low — schedule a refill</p>}
        </div>
      ) : (
        <div className="rounded-lg bg-navy-800 p-3">
          <p className="font-mono text-[13px] text-ink">{device.status}</p>
        </div>
      )}
    </MapSheet>
  )
}
