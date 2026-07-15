import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Live satellite orbits for the map's Satellites layer.
 *
 * Serves current TLE element sets (the orbital "recipes") from CelesTrak —
 * free, public, updated continuously. The CLIENT does the physics: positions
 * are propagated in the browser with satellite.js every couple of seconds,
 * so one cheap fetch here powers smooth live motion with zero per-frame
 * server work. Cached 6h (elements drift slowly).
 *
 * Groups: the ISS + brightest satellites, the GPS fleet, and the weather
 * birds (including the very GOES satellites whose imagery our cloud/lightning
 * layers draw). ~150 total — enough to feel alive, small enough to propagate
 * on a phone.
 */

interface Tle { name: string; l1: string; l2: string; group: string }

let cache: { at: number; sats: Tle[] } | null = null
const TTL_MS = 6 * 3_600_000

const GROUPS: { id: string; url: string; cap: number }[] = [
  { id: 'stations', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', cap: 15 },
  { id: 'weather', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle', cap: 40 },
  { id: 'gps', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle', cap: 32 },
  { id: 'bright', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle', cap: 70 },
]

function parseTle(text: string, group: string, cap: number): Tle[] {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean)
  const out: Tle[] = []
  for (let i = 0; i + 2 < lines.length + 1 && out.length < cap; i += 3) {
    const name = lines[i]
    const l1 = lines[i + 1]
    const l2 = lines[i + 2]
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) break
    out.push({ name: name.trim(), l1, l2, group })
  }
  return out
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ sats: cache.sats }, { headers: { 'Cache-Control': 'public, s-maxage=21600' } })
  }
  const sats: Tle[] = []
  const seen = new Set<string>()
  for (const g of GROUPS) {
    try {
      const r = await fetch(g.url, { signal: AbortSignal.timeout(12_000), cache: 'no-store' })
      if (!r.ok) continue
      for (const s of parseTle(await r.text(), g.id, g.cap)) {
        // The bright list overlaps stations/weather — first group wins.
        const key = s.l2.slice(2, 7)
        if (seen.has(key)) continue
        seen.add(key)
        sats.push(s)
      }
    } catch { /* group down — serve the rest */ }
  }
  if (!sats.length) {
    if (cache) return NextResponse.json({ sats: cache.sats })
    return NextResponse.json({ error: 'CelesTrak unreachable' }, { status: 503 })
  }
  cache = { at: Date.now(), sats }
  return NextResponse.json({ sats }, { headers: { 'Cache-Control': 'public, s-maxage=21600' } })
}
