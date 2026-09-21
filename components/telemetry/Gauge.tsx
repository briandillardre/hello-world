import type { Tone } from '@/lib/telemetry-catalog'

/**
 * A truck-cluster dial: a 270° arc with colour bands, a needle and a big
 * number. The MARK carries the tone (ok teal, warn amber, bad red); every
 * word stays in the text tokens, so a colour-blind reader still gets the
 * label, the number and the verdict.
 *
 * Geometry: centre (50, 56), radius 40, sweep from 225° (bottom-left) over
 * the top to −45° (bottom-right). `frac` 0 → 225°, 1 → −45°.
 */

export const TONE_HEX: Record<Tone, string> = {
  ok: '#2dd4bf',
  warn: '#ff9e16',
  bad: '#fb5d5d',
  off: '#46586a',
  info: '#7aa7d9',
}
const TRACK = '#1a3552'

const CX = 50, CY = 56, R = 40
const START_DEG = 225, SWEEP_DEG = 270

function pt(frac: number, r = R): [number, number] {
  const a = ((START_DEG - SWEEP_DEG * frac) * Math.PI) / 180
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}

/** SVG arc path from `from` to `to` (fractions of the sweep, from < to). */
function arc(from: number, to: number, r = R): string {
  const [x1, y1] = pt(from, r)
  const [x2, y2] = pt(to, r)
  const large = (to - from) * SWEEP_DEG > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export interface GaugeProps {
  /** Display-unit value (already converted). */
  value: number
  min: number
  max: number
  bands: { to: number; tone: Tone }[]
  tone: Tone
  /** The big number, already formatted ("194", "12.8"). */
  text: string
  unit: string
  label: string
  /** One-line verdict under the label ("Running hot"). */
  words?: string | null
  /** "as of 3h ago" when the reading is older than the newest fix. */
  stale?: string | null
  size?: number
}

export function Gauge({ value, min, max, bands, tone, text, unit, label, words, stale, size = 96 }: GaugeProps) {
  const span = Math.max(1e-9, max - min)
  const clamp = (v: number) => Math.max(0, Math.min(1, (v - min) / span))
  const frac = clamp(value)
  const [nx, ny] = pt(frac, R - 2)
  const [hx, hy] = pt(frac, 10)
  const hex = TONE_HEX[tone] ?? TONE_HEX.info
  const bigSize = text.length > 5 ? 15 : text.length > 4 ? 17 : 19

  return (
    <figure
      role="img"
      aria-label={`${label} ${text}${unit ? ' ' + unit : ''}${words ? ', ' + words : ''}`}
      className="m-0 flex flex-col items-center"
      style={{ width: size }}
    >
      <svg viewBox="0 0 100 92" width={size} height={size * 0.92} className="block overflow-visible">
        {/* track */}
        <path d={arc(0, 1)} stroke={TRACK} strokeWidth={7} fill="none" strokeLinecap="round" />
        {/* bands, faint — the map of "where is normal" */}
        {bands.map((b, i) => {
          const from = i === 0 ? 0 : clamp(bands[i - 1].to)
          const to = clamp(b.to)
          if (to <= from) return null
          return <path key={i} d={arc(from, to)} stroke={TONE_HEX[b.tone]} strokeOpacity={0.28} strokeWidth={7} fill="none" />
        })}
        {/* the value, in its own tone */}
        {frac > 0.005 && <path d={arc(0, frac)} stroke={hex} strokeWidth={7} fill="none" strokeLinecap="round" />}
        {/* needle */}
        <line x1={hx} y1={hy} x2={nx} y2={ny} stroke="#e8f0f7" strokeWidth={2} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={4} fill="#e8f0f7" />
        <circle cx={CX} cy={CY} r={2} fill="#0b1f33" />
        {/* the number */}
        <text x={CX} y={84} textAnchor="middle" fontSize={bigSize} fontWeight={700} fill="#e8f0f7" fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {text}
          {unit && <tspan fontSize={8} fontWeight={600} fill="#9fb6cc" dx={2}>{unit}</tspan>}
        </text>
      </svg>
      <figcaption className="mt-0.5 text-center leading-tight">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">{label}</span>
        {words && (
          <span className="block text-[10.5px] font-semibold" style={{ color: tone === 'off' || tone === 'info' ? '#9fb6cc' : hex }}>{words}</span>
        )}
        {stale && <span className="block text-[9.5px] text-amber/80">as of {stale}</span>}
      </figcaption>
    </figure>
  )
}
