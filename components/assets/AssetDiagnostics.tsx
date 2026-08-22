'use client'

import { useMemo, useState } from 'react'
import { Activity, ChevronDown, Search, Copy, Check } from 'lucide-react'

/**
 * Full raw telemetry from the tracker, collapsed by default. The map + top
 * stats show the 5 things a foreman acts on; this is the "everything else"
 * drawer — one tap away, grouped and humanized so more data never means more
 * clutter. Renders whatever the device reported (Teltonika/flespi dotted keys,
 * OBD PIDs, CAN fields, voltages, DTCs…) without inventing units.
 */

type Raw = Record<string, unknown> | null | undefined

// Which humanized group a key falls into (first match wins).
const GROUPS: { label: string; test: (k: string) => boolean }[] = [
  { label: 'Position & GPS', test: (k) => /^(position|gnss|gps|altitude|hdop|satellites|pdop)/.test(k) },
  { label: 'Power & battery', test: (k) => /(battery|external|power|voltage|charg)/.test(k) },
  { label: 'Engine & OBD', test: (k) => /^(engine|obd|can|fuel|rpm|coolant|dtc|vin|odometer|throttle|load)/.test(k) },
  { label: 'Inputs & movement', test: (k) => /(movement|accel|ignition|din|dout|towing|crash|idle|trip)/.test(k) },
  { label: 'Network & device', test: (k) => /(gsm|network|signal|operator|sleep|sim|imei|iccid|record|codec)/.test(k) },
]
const OTHER = 'Other signals'

// Redundant leading namespace words we drop *only* when a real word follows,
// so `movement.status` stays "Movement" instead of collapsing to nothing.
const NAMESPACE = /^(position|gnss|engine|battery|external|gsm|movement|network|obd|can)$/i

function humanize(key: string): string {
  const words = key
    .replace(/[._]/g, ' ')
    .replace(/\bstatus\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length > 1 && NAMESPACE.test(words[0])) words.shift()
  const label = words.join(' ') || key.replace(/[._]/g, ' ')
  return label.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Units for known telemetry keys. flespi normalizes Teltonika CAN/OBD fields
// to METRIC (km, km/h, °C, liters) — display imperial first for a US crew,
// with the reported metric value alongside so nothing looks doctored.
const n0 = (x: number) => Math.round(x).toLocaleString()
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString()
const UNIT_RULES: { test: RegExp; fmt: (v: number) => string }[] = [
  { test: /vehicle\.mileage|total\.mileage|odometer/, fmt: (v) => `${n0(v * 0.621371)} mi (${n0(v)} km)` },
  { test: /mil\.mileage/, fmt: (v) => `${n0(v * 0.621371)} mi` },
  { test: /vehicle\.speed|wheel\.speed|\bspeed$/, fmt: (v) => `${n0(v * 0.621371)} mph (${n0(v)} km/h)` },
  { test: /coolant\.temperature|engine\.temperature|ambient\.temperature|intake\.temperature/, fmt: (v) => `${n0(v * 9 / 5 + 32)}°F (${n0(v)}°C)` },
  { test: /fuel\.volume/, fmt: (v) => `${n1(v * 0.264172)} gal (${n1(v)} L)` },
  { test: /fuel\.consumed/, fmt: (v) => `${n1(v * 0.264172)} gal` },
  { test: /fuel\.rate/, fmt: (v) => `${n1(v * 0.264172)} gal/h` },
  { test: /fuel\.level|battery\.level|\.load$|throttle/, fmt: (v) => `${n0(v)}%` },
  { test: /engine\.rpm/, fmt: (v) => `${n0(v)} rpm` },
  { test: /engine\.hours|\.hours$/, fmt: (v) => `${n1(v)} hrs` },
  // Teltonika raw voltages arrive in millivolts; flespi-normalized ones in volts.
  { test: /voltage/, fmt: (v) => (v > 1000 ? `${n1(v / 1000)} V` : `${n1(v)} V`) },
  { test: /position\.altitude/, fmt: (v) => `${n0(v * 3.28084)} ft (${n0(v)} m)` },
  { test: /position\.direction|heading/, fmt: (v) => `${n0(v)}°` },
  { test: /gsm\.signal/, fmt: (v) => `${n0(v)} / 5` },
  { test: /idle\.time|sleep\.timeout/, fmt: (v) => `${n0(v)} min` },
  { test: /position\.satellites/, fmt: (v) => `${n0(v)} sats` },
]

function fmtVal(key: string, v: unknown): string {
  if (typeof v === 'boolean') {
    if (/ignition/.test(key)) return v ? 'On' : 'Off'
    if (/movement|moving/.test(key)) return v ? 'Moving' : 'Stopped'
    return v ? 'Yes' : 'No'
  }
  if (typeof v === 'number') {
    const rule = UNIT_RULES.find((r) => r.test.test(key))
    if (rule) return rule.fmt(v)
    return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1e5) / 1e5)
  }
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** "3h ago" style stamp from an ISO timestamp. */
function ago(ts: string): string {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  // Human past 36h: days + hours (Brian, Aug 22).
  const d = Math.floor(s / 86400)
  const hr = Math.floor((s % 86400) / 3600)
  return hr ? `${d}d ${hr}h ago` : `${d}d ago`
}

type History = Record<string, { value: unknown; ts: string }>

export function AssetDiagnostics({ raw, timestamp, history }: { raw: Raw; timestamp?: string | null; history?: History }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)
  // 'latest' = this report only; 'all' = every signal seen in the last 7 days
  // (so a parked/engine-off unit still shows its full OBD set).
  const [mode, setMode] = useState<'latest' | 'all'>('latest')

  const latestKeys = useMemo(
    () => new Set(Object.keys(raw ?? {}).filter((k) => k !== 'source')),
    [raw]
  )

  // How many extra signals live in history beyond this report — drives the toggle.
  const extraCount = useMemo(() => {
    if (!history) return 0
    return Object.keys(history).filter((k) => !latestKeys.has(k)).length
  }, [history, latestKeys])

  const showAll = mode === 'all' && !!history
  // When each key was last seen, for the "all" view stamp.
  const seenAt = useMemo(() => {
    const m: Record<string, string> = {}
    if (history) for (const [k, { ts }] of Object.entries(history)) m[k] = ts
    return m
  }, [history])

  const entries = useMemo(
    () => {
      const src: [string, unknown][] = showAll && history
        ? Object.entries(history).map(([k, { value }]) => [k, value])
        : Object.entries(raw ?? {})
      return src
        .filter(([k, v]) => k !== 'source' && v !== null && v !== undefined && v !== '')
        .sort((a, b) => a[0].localeCompare(b[0]))
    },
    [raw, history, showAll]
  )

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? entries.filter(([k]) => k.toLowerCase().includes(needle) || humanize(k).toLowerCase().includes(needle))
      : entries
    const buckets = new Map<string, [string, unknown][]>()
    for (const e of filtered) {
      const g = GROUPS.find((grp) => grp.test(e[0]))?.label ?? OTHER
      if (!buckets.has(g)) buckets.set(g, [])
      buckets.get(g)!.push(e)
    }
    // Keep a stable, sensible order
    const order = [...GROUPS.map((g) => g.label), OTHER]
    return order.filter((l) => buckets.has(l)).map((l) => [l, buckets.get(l)!] as const)
  }, [entries, q])

  const count = entries.length

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(raw ?? {}, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — ignore */ }
  }

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-navy-800/60 transition-colors"
        aria-expanded={open}
      >
        <Activity className="h-4 w-4 text-teal flex-none" />
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-ink text-[15px]">Diagnostics</p>
          <p className="text-xs text-faint mt-0.5 truncate">
            {count > 0 ? `${count} signal${count === 1 ? '' : 's'} from the tracker` : 'Position only — no extended telemetry yet'}
            {showAll ? ' · all seen (7d)' : timestamp ? ' · latest report' : ''}
            {!showAll && extraCount > 0 ? ` · +${extraCount} more seen recently` : ''}
          </p>
        </div>
        {count > 0 && (
          <span className="font-mono text-[11px] text-faint tabular-nums flex-none">{count}</span>
        )}
        <ChevronDown className={`h-4 w-4 text-faint flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-navy-800 p-4 space-y-4">
          {/* Latest vs All-seen toggle — lets a parked, engine-off unit still
              show its full OBD signal set from the last time it was running. */}
          {history && extraCount > 0 && (
            <div className="inline-flex rounded-lg border border-navy-700 overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setMode('latest')}
                className={'px-3 py-1.5 transition-colors ' + (!showAll ? 'bg-teal/15 text-teal' : 'text-faint hover:text-ink')}
              >Latest report</button>
              <button
                onClick={() => setMode('all')}
                className={'px-3 py-1.5 transition-colors ' + (showAll ? 'bg-teal/15 text-teal' : 'text-faint hover:text-ink')}
              >All signals (7d)</button>
            </div>
          )}

          {count === 0 ? (
            <p className="text-sm text-faint">
              This tracker is only reporting its position so far. Voltages, engine data, and fault codes
              appear here as soon as the device sends them{history ? ' — or switch to “All signals (7d)” above' : ''}.
            </p>
          ) : (
            <>
              {showAll && (
                <p className="text-[11px] text-faint">
                  Every field this tracker sent in the last 7 days, newest value shown. Engine data (RPM,
                  coolant, fuel, DTCs) reports while the ignition is on.
                </p>
              )}
              {count > 10 && (
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Filter signals…"
                    className="w-full bg-navy-950 border border-navy-700 rounded-lg text-ink text-sm pl-9 pr-3 py-2 outline-none focus:border-amber/60 placeholder:text-faint"
                  />
                </div>
              )}

              {groups.map(([label, items]) => (
                <div key={label}>
                  <h4 className="font-mono text-[10px] uppercase tracking-[0.12em] text-teal mb-2">{label}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-navy-950 border border-navy-800 px-3 py-2 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] text-muted capitalize truncate" title={k}>{humanize(k)}</span>
                          <span className="text-[13px] font-semibold text-ink text-right tabular-nums break-all">{fmtVal(k, v)}</span>
                        </div>
                        <span className="font-mono text-[9.5px] text-faint/70 truncate block" title={k}>
                          {k}
                          {showAll && !latestKeys.has(k) && seenAt[k] ? <span className="text-amber/70"> · {ago(seenAt[k])}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {groups.length === 0 && (
                <p className="text-sm text-faint">No signals match “{q}”.</p>
              )}

              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-faint hover:text-ink border border-navy-700 rounded-lg px-3 py-1.5 transition-colors"
              >
                {copied ? <><Check className="h-3.5 w-3.5 text-teal" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy raw JSON</>}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
