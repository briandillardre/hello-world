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

export const DEFAULT_TZ = 'America/New_York'
