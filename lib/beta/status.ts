/**
 * The public status page — pure. The health cron writes one status_checks
 * row an hour (database answering · tracker data arriving · AI answering);
 * this turns them into per-day bars and uptime percentages. A day with no
 * check at all is "no data", never "up": a status page that fills its own
 * gaps with green is the kind nobody believes.
 */

export interface Check { at: string; db: boolean; ingest: boolean | null; ai: boolean | null }
export type Component = 'app' | 'ingest' | 'ai'
export const COMPONENTS: { key: Component; label: string; hint: string }[] = [
  { key: 'app', label: 'App & database', hint: 'hammertrack.ai and the data behind it' },
  { key: 'ingest', label: 'Tracker data', hint: 'Positions arriving from trackers' },
  { key: 'ai', label: 'Ask AI', hint: 'The assistant (the app answers from its built-in engine when it is down)' },
]
export type DayState = 'up' | 'partial' | 'down' | 'none'

const val = (c: Check, k: Component) => (k === 'app' ? c.db : k === 'ingest' ? c.ingest : c.ai)

export function dailyBars(checks: Check[], days: number, todayKey: string): Record<Component, { day: string; state: DayState; up: number; total: number }[]> {
  const keys = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${todayKey}T12:00:00Z`) - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10))
  const out = {} as Record<Component, { day: string; state: DayState; up: number; total: number }[]>
  for (const { key } of COMPONENTS) {
    out[key] = keys.map((day) => {
      const vals = checks.filter((c) => c.at.slice(0, 10) === day).map((c) => val(c, key)).filter((v): v is boolean => v !== null)
      const up = vals.filter(Boolean).length
      const total = vals.length
      const state: DayState = !total ? 'none' : up === total ? 'up' : up === 0 ? 'down' : 'partial'
      return { day, state, up, total }
    })
  }
  return out
}

export function uptime(checks: Check[], k: Component): number | null {
  const vals = checks.map((c) => val(c, k)).filter((v): v is boolean => v !== null)
  return vals.length ? Math.round((vals.filter(Boolean).length / vals.length) * 10000) / 100 : null
}

/** Right now: the newest check, if it is under 2 hours old. */
export function current(checks: Check[], nowMs: number): Record<Component, 'up' | 'down' | 'unknown'> {
  const newest = [...checks].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  const fresh = newest && nowMs - Date.parse(newest.at) < 2 * 3_600_000
  const r = {} as Record<Component, 'up' | 'down' | 'unknown'>
  for (const { key } of COMPONENTS) {
    const v = fresh ? val(newest, key) : null
    r[key] = v === null ? 'unknown' : v ? 'up' : 'down'
  }
  return r
}
