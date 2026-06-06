'use client'

import { CloudRain, Satellite, Ban, Zap, Wind } from 'lucide-react'
import { type Conditions, weatherEmoji } from '@/lib/weather'

export type WeatherMode = 'off' | 'radar' | 'satellite'

interface WeatherControlProps {
  mode: WeatherMode
  onMode: (m: WeatherMode) => void
  conditions: Conditions | null
  frameTime: string | null
  scrubbing: boolean
}

const MODES: { key: WeatherMode; label: string; icon: typeof CloudRain }[] = [
  { key: 'off', label: 'Off', icon: Ban },
  { key: 'radar', label: 'Radar', icon: CloudRain },
  { key: 'satellite', label: 'Satellite', icon: Satellite },
]

export function WeatherControl({ mode, onMode, conditions, frameTime, scrubbing }: WeatherControlProps) {
  return (
    <div className="absolute top-[58px] left-3 z-10 w-[210px] rounded-xl bg-navy-950/85 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
      {/* conditions */}
      {conditions && (
        <div className="px-3 py-2 border-b border-navy-800">
          <div className="flex items-center justify-between">
            <span className="font-display font-black text-lg text-ink">
              {weatherEmoji(conditions.code)} {conditions.tempF}°
            </span>
            <span className="font-mono text-[11px] text-muted flex items-center gap-1">
              <Wind className="h-3 w-3" /> {conditions.windMph}mph
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 font-mono text-[10.5px] text-faint">
            <span className={conditions.precip > 0 ? 'text-teal' : ''}>{conditions.precip.toFixed(2)}&quot; rain</span>
            <span className={conditions.isThunder ? 'text-amber flex items-center gap-1' : 'flex items-center gap-1'}>
              <Zap className="h-3 w-3" /> {conditions.isThunder ? 'Storms' : 'Clear'}
            </span>
          </div>
        </div>
      )}

      {/* mode toggle */}
      <div className="flex p-1 gap-1">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onMode(key)}
            className={
              'flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ' +
              (mode === key ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink hover:bg-navy-900')
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode !== 'off' && frameTime && (
        <div className="px-3 py-1.5 border-t border-navy-800 font-mono text-[10px] text-muted flex items-center justify-between">
          <span>{scrubbing ? 'Replay' : 'Now'}</span>
          <span className="text-teal">{frameTime}</span>
        </div>
      )}
    </div>
  )
}
