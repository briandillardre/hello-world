'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

/**
 * Layer health board. Two verdicts per layer:
 *  · Server — Vercel fetched a sample request (is the endpoint/URL right?)
 *  · Browser — this device loaded the same sample (is anything blocking the map?)
 * Raster probes use <img> loading, which is exactly how MapLibre pulls tiles.
 */

interface ServerCheck { key: string; label: string; url: string; status: number; contentType: string; bytes: number; ok: boolean; error?: string }

const BROWSER_IMAGE_KEYS = ['stormtops7', 'stormtops6', 'clouds', 'radar', 'flood', 'soils']
const BROWSER_FETCH_KEYS = ['nws', 'usgs']

function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    const done = (v: boolean) => { img.onload = null; img.onerror = null; resolve(v) }
    const t = setTimeout(() => done(false), 10_000)
    img.onload = () => { clearTimeout(t); done(true) }
    img.onerror = () => { clearTimeout(t); done(false) }
    img.src = url
  })
}

export function LayerDiag() {
  const [server, setServer] = useState<ServerCheck[] | null>(null)
  const [serverErr, setServerErr] = useState(false)
  const [browser, setBrowser] = useState<Record<string, boolean | null>>({})

  useEffect(() => {
    fetch('/api/diag/layers')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.checks ? setServer(j.checks) : setServerErr(true)))
      .catch(() => setServerErr(true))
  }, [])

  useEffect(() => {
    if (!server) return
    for (const c of server) {
      if (BROWSER_IMAGE_KEYS.includes(c.key)) {
        setBrowser((b) => ({ ...b, [c.key]: null }))
        probeImage(c.url).then((ok) => setBrowser((b) => ({ ...b, [c.key]: ok })))
      } else if (BROWSER_FETCH_KEYS.includes(c.key)) {
        setBrowser((b) => ({ ...b, [c.key]: null }))
        fetch(c.url, { signal: AbortSignal.timeout(10_000) })
          .then((r) => setBrowser((b) => ({ ...b, [c.key]: r.ok })))
          .catch(() => setBrowser((b) => ({ ...b, [c.key]: false })))
      }
    }
  }, [server])

  const Dot = ({ v }: { v: boolean | null | undefined }) =>
    v === true ? <CheckCircle2 className="h-4 w-4 text-teal inline" />
    : v === false ? <XCircle className="h-4 w-4 text-alert inline" />
    : <Loader2 className="h-4 w-4 text-faint inline animate-spin" />

  if (serverErr) return <p className="text-sm text-alert">Couldn&apos;t run the server probe — reload, or check /api/diag/layers.</p>
  if (!server) return <p className="text-sm text-faint flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Probing every layer…</p>

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-950 overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-navy-900 text-faint font-mono text-[10px] uppercase tracking-[0.1em]">
            <th className="text-left px-3 py-2">Layer</th>
            <th className="text-center px-2 py-2">Server</th>
            <th className="text-center px-2 py-2">Browser</th>
            <th className="text-left px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {server.map((c) => (
            <tr key={c.key} className="border-t border-navy-800/60">
              <td className="px-3 py-2 text-ink">{c.label}</td>
              <td className="px-2 py-2 text-center"><Dot v={c.ok} /></td>
              <td className="px-2 py-2 text-center"><Dot v={browser[c.key]} /></td>
              <td className="px-3 py-2 font-mono text-[10.5px] text-faint">
                {c.status || 'ERR'} · {c.contentType.split(';')[0] || '—'} · {c.bytes.toLocaleString()}B{c.error ? ` · ${c.error.slice(0, 60)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-faint border-t border-navy-800">
        Server = endpoint reachable and returning the right content · Browser = this device can load it the way the map does.
        Screenshot this table if anything shows red.
      </p>
    </div>
  )
}
