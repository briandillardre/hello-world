/**
 * Local-calendar-day windows in an arbitrary IANA timezone, no libraries.
 * The server runs UTC; "Today" must mean the VIEWER's midnight-to-midnight.
 * The browser reports its zone via the ht_tz cookie (see TzCookie).
 */

function tzOffsetMs(tz: string, at: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(at)).map((x) => [x.type, x.value])
  ) as Record<string, string>
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
  return asUTC - at
}

/** Epoch-ms window for the local calendar day `daysAgo` days back (0 = today):
 *  [local 00:00:00, next local 00:00:00). DST shift days are ±1h — fine. */
export function zonedDayWindow(tz: string, daysAgo: number): { from: number; to: number } {
  const startOf = (dAgo: number) => {
    const now = Date.now()
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(now)).split('-').map(Number)
    const utcGuess = Date.UTC(parts[0], parts[1] - 1, parts[2] - dAgo)
    // one refinement handles the offset-at-midnight vs offset-now difference
    return utcGuess - tzOffsetMs(tz, utcGuess - tzOffsetMs(tz, utcGuess))
  }
  return { from: startOf(daysAgo), to: startOf(daysAgo - 1) }
}

/** Local Jan 1 00:00:00 (this year) in `tz`, epoch ms. */
export function startOfYear(tz: string): number {
  const yr = Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date()))
  const guess = Date.UTC(yr, 0, 1)
  return guess - tzOffsetMs(tz, guess - tzOffsetMs(tz, guess))
}

export type TimeRangeKey = 'live' | 'today' | 'yesterday' | '7d' | '30d' | 'ytd' | 'all' | 'custom'

/**
 * Epoch-ms window for a timeline range, in the viewer's timezone. Multi-day
 * ranges start at local midnight N days ago and end at end-of-today, so every
 * tick is a clean day boundary. `earliestMs` is the first-ever data point (for
 * "All time"); custom uses the picker's from/to.
 */
export function rangeWindow(
  tz: string,
  range: TimeRangeKey,
  opts?: { earliestMs?: number | null; customFrom?: number; customTo?: number }
): { from: number; to: number } {
  const today = zonedDayWindow(tz, 0)
  const endToday = today.to
  switch (range) {
    // Live is NOT day-gated: right after local midnight "today" holds zero
    // pings, which blanked the live map until each tracker's next check-in
    // (found Jul 15, 12:30 AM). Live always reaches back at least 4 hours;
    // during normal hours that floor is moot and it matches Today exactly.
    case 'live': return { from: Math.min(today.from, Date.now() - 4 * 3_600_000), to: endToday }
    case 'today': return today
    case 'yesterday': return zonedDayWindow(tz, 1)
    case '7d': return { from: zonedDayWindow(tz, 7).from, to: endToday }
    case '30d': return { from: zonedDayWindow(tz, 30).from, to: endToday }
    case 'ytd': return { from: startOfYear(tz), to: endToday }
    case 'all': return { from: opts?.earliestMs ?? zonedDayWindow(tz, 30).from, to: endToday }
    case 'custom': return { from: opts?.customFrom ?? zonedDayWindow(tz, 7).from, to: opts?.customTo ?? endToday }
  }
}

export const DEFAULT_TZ = 'America/New_York'

/** The viewer's tz from the client-set ht_tz cookie, made safe to hand to
 *  Intl. Next's cookie parser already percent-decodes values, but the value
 *  is client-tamperable and an invalid IANA name makes every Intl formatter
 *  THROW — 500ing a server page or silently blanking a try/caught route.
 *  Every reader validated nothing (and most double-decoded) before this
 *  helper (logged-in review, Aug 26). Decode defensively, validate against
 *  Intl, fall back to Eastern. */
export function safeTz(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_TZ
  let tz = raw
  try { tz = decodeURIComponent(raw) } catch { return DEFAULT_TZ }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TZ
  }
}

// ── Timezone-explicit formatters ─────────────────────────────────────────────
// Server components render on Vercel in UTC, so bare toLocaleTimeString()
// shows times 4-5 hours off for an East-coast crew. Every server-rendered
// timestamp goes through these with the viewer's ht_tz cookie.

/** "6:58 AM" in tz. */
export const fmtTime = (ms: number, tz: string) =>
  new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })

/** "Fri, Jul 11" in tz. */
export const fmtDay = (ms: number, tz: string) =>
  new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })

/** "Friday, Jul 11" in tz. */
export const fmtDayLong = (ms: number, tz: string) =>
  new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' })

/** "7/11/2026, 6:58 AM" in tz (CSV-friendly). */
export const fmtDateTime = (ms: number, tz: string) =>
  new Date(ms).toLocaleString('en-US', { timeZone: tz, month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "2026-07-11" — calendar-day bucket key in tz (groups by LOCAL day, not UTC). */
export const dayKey = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
