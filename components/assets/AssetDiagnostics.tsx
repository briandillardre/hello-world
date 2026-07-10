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

function fmtVal(key: string, v: unknown): string {
  if (typeof v === 'boolean') {
    if (/ignition/.test(key)) return v ? 'On' : 'Off'
    if (/movement|moving/.test(key)) return v ? 'Moving' : 'Stopped'
    return v ? 'Yes' : 'No'
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1e5) / 1e5)
  }
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function AssetDiagnostics({ raw, timestamp }: { raw: Raw; timestamp?: string | null }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)

  const entries = useMemo(
    () =>
      Object.entries(raw ?? {})
        .filter(([k, v]) => k !== 'source' && v !== null && v !== undefined && v !== '')
        .sort((a, b) => a[0].localeCompare(b[0])),
    [raw]
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
            {timestamp ? ' · latest report' : ''}
          </p>
        </div>
        {count > 0 && (
          <span className="font-mono text-[11px] text-faint tabular-nums flex-none">{count}</span>
        )}
        <ChevronDown className={`h-4 w-4 text-faint flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-navy-800 p-4 space-y-4">
          {count === 0 ? (
            <p className="text-sm text-faint">
              This tracker is only reporting its position so far. Voltages, engine data, and fault codes
              appear here as soon as the device sends them.
            </p>
          ) : (
            <>
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
                        <span className="font-mono text-[9.5px] text-faint/70 truncate block" title={k}>{k}</span>
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
