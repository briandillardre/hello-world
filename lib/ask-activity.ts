/**
 * Ask AI — "since Friday morning" into a time window, and a window's
 * activity into the words a crew lead reads.
 *
 * Sep 28: a crew lead asked "How many miles from Friday morning until now did
 * the ram 2500 drive" and got "I don't have a range that lines up exactly …
 * over the trailing 7 days …" — the activity tool knew only fixed buckets.
 * Now the tool takes any window (`from` / `to`), the model is told the clock
 * and the company's zone (askClock), and the built-in engine — the one that
 * answers while the AI service is down — reads the common phrases itself.
 *
 * Pure: no DB, no React. `scripts/ask-activity-test.mjs` asserts it; run it
 * after ANY change here or to the fuel math in lib/asset-stats.ts.
 */
import { addDaysKey, dayKey, isDayKey, tzOffsetMs } from './dates'
import { IDLE_GAL_PER_H, FUEL_NOISE_PCT, type FuelGauge, type RangeStats } from './asset-stats'

/** The widest window one question reads (asset_locations is big). */
export const MAX_WINDOW_DAYS = 31
/** "Morning" starts here unless the user names a time. */
export const MORNING_HOUR = 6

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

// ── Local clock arithmetic ──────────────────────────────────────────────────

/** Epoch ms of a wall-clock time on a local calendar day in `tz`. DST-safe
 *  (the same one-refinement trick as zonedMidnightMs); hour 24 = next midnight. */
export function zonedLocalMs(key: string, hour: number, minute: number, tz: string): number {
  const [y, m, d] = key.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hour, minute)
  return guess - tzOffsetMs(tz, guess - tzOffsetMs(tz, guess))
}

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD" key. */
const dowOf = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const FORMATS = new Map<string, Intl.DateTimeFormat>()
function partsOf(ms: number, tz: string, withTime: boolean): Record<string, string> {
  const id = `${tz}|${withTime}`
  let f = FORMATS.get(id)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    })
    FORMATS.set(id, f)
  }
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
}

/** "Fri Sep 25" in tz. */
export function fmtDayShort(ms: number, tz: string): string {
  const p = partsOf(ms, tz, false)
  return `${p.weekday} ${p.month} ${p.day}`
}

/** "Fri Sep 25 6:00 AM" in tz. */
export function fmtWhen(ms: number, tz: string): string {
  const p = partsOf(ms, tz, true)
  return `${p.weekday} ${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}`
}

/** The window as an answer says it: "Fri Sep 25 6:00 AM → now",
 *  "Mon Sep 21 – Sun Sep 27" for whole days, "Sat Sep 26 (all day)". */
export function windowWords(fromMs: number, toMs: number, nowMs: number, tz: string): string {
  if (toMs >= nowMs - 60_000) return `${fmtWhen(fromMs, tz)} → now`
  const fromKey = dayKey(fromMs, tz)
  const toKey = dayKey(toMs, tz)
  if (fromMs === zonedLocalMs(fromKey, 0, 0, tz) && toMs === zonedLocalMs(toKey, 0, 0, tz)) {
    const lastKey = addDaysKey(toKey, -1)
    if (lastKey === fromKey) return `${fmtDayShort(fromMs, tz)} (all day)`
    return `${fmtDayShort(fromMs, tz)} – ${fmtDayShort(zonedLocalMs(lastKey, 12, 0, tz), tz)}`
  }
  return `${fmtWhen(fromMs, tz)} → ${fmtWhen(toMs, tz)}`
}

/** The clock the model gets on every question: now, the company's zone and
 *  its offset, and the past week by date — so "Friday" is a date. Eight
 *  days, so asked on a Monday both Mondays are on the list. */
export function askClock(nowMs: number, tz: string): string {
  const off = tzOffsetMs(tz, Math.floor(nowMs / 60_000) * 60_000) / 60_000
  const hhmm = `${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`
  const now = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(nowMs))
  const today = dayKey(nowMs, tz)
  const week = Array.from({ length: 8 }, (_, i) => addDaysKey(today, i - 7))
    .map((k, i) => `${fmtDayShort(zonedLocalMs(k, 12, 0, tz), tz)}${i === 7 ? ' (today)' : ''}`)
  return [
    `Right now it is ${now} in the company's timezone, ${tz} (UTC${off < 0 ? '-' : '+'}${hhmm}).`,
    `The past week by date: ${week.join(' · ')}.`,
  ].join('\n')
}

// ── Phrases → a window ──────────────────────────────────────────────────────

export interface PhraseWindow {
  from: number
  to: number
  /** The words that said it, as they appear in the normalized question. */
  match: string
}

/** Lowercase, apostrophes out, a.m./p.m. folded, punctuation to spaces. */
export function normalizeAsk(s: string): string {
  return s.toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\ba\.m\.?/g, 'am')
    .replace(/\bp\.m\.?/g, 'pm')
    .replace(/[?!,;:()"](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const WD_FULL = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday'
// Short forms only where a day is expected ("since sat") — bare, "the truck
// sat" and "in the sun" are not days.
const WD_SHORT = 'sun|mon|tues?|wed|thu(?:rs?)?|fri|sat'
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec'
const MONTH_DAY = `(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?`
const DAY_BARE = `today|yesterday|tonight|last night|this (?:morning|afternoon|evening)|(?:(?:last|this|on) )?(?:${WD_FULL})|${MONTH_DAY}`
// "1/2" is a half tank until something says it is a date.
const DAY_AFTER_WORD = `today|yesterday|tonight|last night|this (?:morning|afternoon|evening)|(?:(?:last|this|on) )?(?:${WD_FULL}|${WD_SHORT})\\.?|${MONTH_DAY}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?`
const CLOCK = '\\d{1,2}(?::\\d{2})? ?(?:am|pm)|noon|midnight'
// Groups: part-of-day word, clock.
const PART = `(?: (?:in the )?(morning|afternoon|evening|night)| (?:at |around |about )?(${CLOCK}))?`
const NUM = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty|twenty[ -]four)'
const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, thirty: 30, 'twenty four': 24, 'twenty-four': 24,
}
const LEAD = '(?:(?:in|over|during|for) )?(?:the )?'

/** Nothing word-like may follow a matched day: "after sunrise" is not Sunday. */
const END_OF_WORD = '(?![a-z0-9/])'
const RE_HOURS = new RegExp(`\\b${LEAD}(?:last|past|previous) (?:${NUM} )?(?:hours?|hrs?)\\b`)
const RE_DAYS = new RegExp(`\\b${LEAD}(?:last|past|previous) ${NUM} (days?|weeks?)\\b`)
// "In the last week" / "the past month" / "this past week" = the last 7 / 30
// days (the panel's rows); a bare "last week" is the calendar week before this one.
const RE_PAST = /\b(?:(?:in|over|during|for) )?(?:the (?:past|last)|past) (week|month)\b/
const RE_CALENDAR = /\b(?:(since|from) )?(this|last|previous) (week|month)\b|\b(week|month) to date\b/
const RE_WEEKEND = /\b(?:(since|from) )?(this|last|over the|the) weekend\b/
// Groups: lead word, clock before the day, day, part word, clock after.
const RE_SINCE = new RegExp(`\\b(since|from|starting(?: on| from)?|beginning(?: on)?|after|between) (?:(?:at |around )?(${CLOCK}) (?:on )?)?(${DAY_AFTER_WORD})${PART}${END_OF_WORD}`)
const RE_SINCE_CLOCK = new RegExp(`\\b(?:since|from|after|starting(?: at)?) (?:at |around )?(${CLOCK})${END_OF_WORD}`)
// Groups: joiner, now, day, part word, clock.
const RE_END = new RegExp(`^ ?(until|till|til|to|through|thru|and|-|–|—) (?:((?:right )?now)\\b|(${DAY_AFTER_WORD})${PART}${END_OF_WORD})`)
// Groups: day, part word, clock.
const RE_BARE = new RegExp(`\\b(${DAY_BARE})${PART}${END_OF_WORD}`)

type Part = 'morning' | 'afternoon' | 'evening' | 'night'
interface DayRef { key: string; weekday: boolean; part?: Part; lastNight?: boolean }

const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** A date the user named, as a local day key (never in the future). */
function dayRef(raw: string, todayKey: string): DayRef | null {
  const r = raw.replace(/\.$/, '').trim()
  if (r === 'today') return { key: todayKey, weekday: false }
  if (r === 'yesterday') return { key: addDaysKey(todayKey, -1), weekday: false }
  if (r === 'tonight') return { key: todayKey, weekday: false, part: 'evening' }
  if (r === 'last night') return { key: addDaysKey(todayKey, -1), weekday: false, lastNight: true }
  let m = /^this (morning|afternoon|evening)$/.exec(r)
  if (m) return { key: todayKey, weekday: false, part: m[1] as Part }
  m = new RegExp(`^(?:(last|this|on) )?(${WD_FULL}|${WD_SHORT})$`).exec(r)
  if (m) {
    const back = (dowOf(todayKey) - WEEKDAY_INDEX[m[2].slice(0, 3)] + 7) % 7
    // "last Friday" said on a Friday is a week ago; a bare "Friday" is today.
    return { key: addDaysKey(todayKey, -(m[1] === 'last' && back === 0 ? 7 : back)), weekday: true }
  }
  let y: number | null = null, mo: number, d: number
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(r)
  if (m) {
    mo = Number(m[1]); d = Number(m[2])
    if (m[3]) y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  } else {
    m = new RegExp(`^(${MONTHS})\\.? (\\d{1,2})(?:st|nd|rd|th)?$`).exec(r)
    if (!m) return null
    mo = MONTH_INDEX[m[1].slice(0, 3)]; d = Number(m[2])
  }
  const thisYear = Number(todayKey.slice(0, 4))
  const keyFor = (yr: number) => `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  let key = keyFor(y ?? thisYear)
  // "Since 12/20" in January means last December.
  if (y == null && key > todayKey) key = keyFor(thisYear - 1)
  return isDayKey(key) ? { key, weekday: false } : null
}

function clockOf(raw: string): [number, number] | null {
  if (raw === 'noon') return [12, 0]
  if (raw === 'midnight') return [0, 0]
  const m = /^(\d{1,2})(?::(\d{2}))? ?(am|pm)$/.exec(raw)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2] ?? 0)
  if (h < 1 || h > 12 || mi > 59) return null
  return [(h % 12) + (m[3] === 'pm' ? 12 : 0), mi]
}

/** Where a named day (and part of it) begins… */
function startOf(ref: DayRef, part: Part | undefined, clock: [number, number] | null, tz: string): number {
  if (clock) return zonedLocalMs(ref.key, clock[0], clock[1], tz)
  if (ref.lastNight) return zonedLocalMs(ref.key, 17, 0, tz)
  const p = part ?? ref.part
  const h = p === 'morning' ? MORNING_HOUR : p === 'afternoon' ? 12 : p === 'evening' || p === 'night' ? 17 : 0
  return zonedLocalMs(ref.key, h, 0, tz)
}

/** …and where it ends. */
function endOf(ref: DayRef, part: Part | undefined, clock: [number, number] | null, tz: string): number {
  if (ref.lastNight) return zonedLocalMs(addDaysKey(ref.key, 1), MORNING_HOUR, 0, tz)
  const p = clock ? undefined : part ?? ref.part
  return zonedLocalMs(ref.key, p === 'morning' ? 12 : p === 'afternoon' ? 17 : 24, 0, tz)
}

const numOf = (s: string | undefined, fallback: number): number =>
  s == null ? fallback : /^\d+$/.test(s) ? Number(s) : NUM_WORDS[s] ?? fallback

/**
 * The window a question names, in the company's timezone — or null when it
 * names none. "Morning" = 6:00 AM; "since Friday" = the most recent Friday
 * (today if it is Friday) at 12:00 AM; "this week" = Monday 12:00 AM → now;
 * "last week" = the Monday before → this Monday; "last N days" = 12:00 AM
 * N days ago → now (the asset panel's "7 days" row, exactly). The window
 * always ends by now.
 */
export function resolveWindowPhrase(text: string, nowMs: number, tz: string): PhraseWindow | null {
  const q = normalizeAsk(text)
  const today = dayKey(nowMs, tz)
  const done = (from: number, to: number, match: string): PhraseWindow | null => {
    const end = Math.min(to, nowMs)
    return Number.isFinite(from) && from < end ? { from, to: end, match } : null
  }

  let m = RE_HOURS.exec(q)
  if (m) {
    const n = numOf(m[1], 1)
    return n >= 1 && n <= MAX_WINDOW_DAYS * 24 ? done(nowMs - n * HOUR_MS, nowMs, m[0]) : null
  }
  m = RE_DAYS.exec(q)
  if (m) {
    const n = numOf(m[1], 0) * (m[2].startsWith('week') ? 7 : 1)
    return n >= 1 && n <= 366 ? done(zonedLocalMs(addDaysKey(today, -n), 0, 0, tz), nowMs, m[0]) : null
  }
  m = RE_PAST.exec(q)
  if (m) return done(zonedLocalMs(addDaysKey(today, m[1] === 'week' ? -7 : -30), 0, 0, tz), nowMs, m[0])

  m = RE_CALENDAR.exec(q)
  if (m) {
    const which = m[2] ?? 'this'
    const unit = m[3] ?? m[4]
    const since = !!m[1] || !!m[4]
    if (unit === 'week') {
      // Weeks run Monday–Sunday, like the pay week on the time cards.
      const monday = addDaysKey(today, -((dowOf(today) + 6) % 7))
      const start = which === 'this' ? monday : addDaysKey(monday, -7)
      return done(zonedLocalMs(start, 0, 0, tz), which === 'this' || since ? nowMs : zonedLocalMs(monday, 0, 0, tz), m[0])
    }
    const first = `${today.slice(0, 8)}01`
    const prevFirst = `${addDaysKey(first, -1).slice(0, 8)}01`
    const start = which === 'this' ? first : prevFirst
    return done(zonedLocalMs(start, 0, 0, tz), which === 'this' || since ? nowMs : zonedLocalMs(first, 0, 0, tz), m[0])
  }

  m = RE_WEEKEND.exec(q)
  if (m) {
    const dow = dowOf(today)
    let sat = dow === 6 ? today : addDaysKey(today, -(dow + 1))
    if (m[2] === 'last' && (dow === 6 || dow === 0)) sat = addDaysKey(sat, -7)
    return done(zonedLocalMs(sat, 0, 0, tz), m[1] ? nowMs : zonedLocalMs(addDaysKey(sat, 2), 0, 0, tz), m[0])
  }

  // "since/from <day> [part] [until <day|now>]"
  m = RE_SINCE.exec(q)
  if (m) {
    const ref = dayRef(m[3], today)
    if (ref) {
      const clock = clockOf(m[2] ?? m[5] ?? '')
      let from = startOf(ref, m[4] as Part | undefined, clock, tz)
      if (from > nowMs && ref.weekday) from -= 7 * DAY_MS // "since Friday morning", asked before 6 AM on a Friday
      const after = q.slice(m.index + m[0].length)
      const end = RE_END.exec(after)
      const to = end ? endWords(end, from, today, tz, nowMs) : nowMs
      return to == null ? null : done(from, to, m[0] + (end ? end[0] : ''))
    }
  }
  m = RE_SINCE_CLOCK.exec(q)
  if (m) {
    const clock = clockOf(m[1])
    if (clock) {
      let from = zonedLocalMs(today, clock[0], clock[1], tz)
      if (from > nowMs) from = zonedLocalMs(addDaysKey(today, -1), clock[0], clock[1], tz)
      return done(from, nowMs, m[0])
    }
  }

  // "<day> [part]" alone ("yesterday", "Friday morning", "on Sep 20"), or
  // "<day> [part] to now".
  m = RE_BARE.exec(q)
  if (m) {
    const ref = dayRef(m[1].replace(/^on /, ''), today)
    if (!ref) return null
    const clock = clockOf(m[3] ?? '')
    let from = startOf(ref, m[2] as Part | undefined, clock, tz)
    let span = endOf(ref, m[2] as Part | undefined, clock, tz)
    if (from > nowMs && ref.weekday) { from -= 7 * DAY_MS; span -= 7 * DAY_MS }
    const after = q.slice(m.index + m[0].length)
    const end = RE_END.exec(after)
    if (end) {
      const to = endWords(end, from, today, tz, nowMs)
      return to == null ? null : done(from, to, m[0] + end[0])
    }
    return done(from, span, m[0])
  }
  return null
}

/** Where "… until X" ends: now; the start of a named part ("until Saturday
 *  morning"); the end of a named day ("to Saturday", "through Saturday").
 *  A weekday that lands before the start is the one after it ("from Monday
 *  to Friday", asked on a Wednesday). */
function endWords(end: RegExpExecArray, fromMs: number, today: string, tz: string, nowMs: number): number | null {
  if (end[2]) return nowMs
  const ref = dayRef(end[3], today)
  if (!ref) return null
  if (ref.key === today && !end[4] && !end[5] && !ref.part) return nowMs
  const clock = clockOf(end[5] ?? '')
  const part = end[4] as Part | undefined
  const through = end[1] === 'through' || end[1] === 'thru' || end[1] === 'and'
  const to = (part || clock) && !through ? startOf(ref, part, clock, tz) : endOf(ref, part, clock, tz)
  return to <= fromMs && ref.weekday ? to + 7 * DAY_MS : to
}

// ── Tool input → a window ───────────────────────────────────────────────────

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i

/**
 * One end of a window from the tool's input: an ISO 8601 instant (exact);
 * a local time without an offset (read in the company's zone — a date-only
 * `from` is the start of that day, a date-only `to` the end of it); "now";
 * or, failing those, a phrase ("friday morning"). Null when unreadable.
 */
export function parseWhen(value: unknown, end: 'start' | 'end', nowMs: number, tz: string): number | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  if (/^(right )?now$/i.test(s)) return nowMs
  const m = ISO.exec(s)
  if (m) {
    const key = `${m[1]}-${m[2]}-${m[3]}`
    if (!isDayKey(key)) return null
    const h = Number(m[4] ?? 0), mi = Number(m[5] ?? 0), sec = Number(m[6] ?? 0)
    if (h > 23 || mi > 59 || sec > 59) return null
    if (m[7]) {
      const z = m[7].toUpperCase() === 'Z' ? 'Z'
        : m[7].length === 3 ? `${m[7]}:00`
        : m[7].includes(':') ? m[7] : `${m[7].slice(0, 3)}:${m[7].slice(3)}`
      const ms = Date.parse(`${key}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}${z}`)
      return Number.isFinite(ms) ? ms : null
    }
    if (m[4] == null) return zonedLocalMs(end === 'end' ? addDaysKey(key, 1) : key, 0, 0, tz)
    return zonedLocalMs(key, h, mi, tz) + sec * 1000
  }
  const w = resolveWindowPhrase(s, nowMs, tz)
  return w ? (end === 'start' ? w.from : w.to) : null
}

export interface ClampedWindow { from: number; to: number; notes: string[] }

/**
 * Bound a window before anything reads it: never past now, never wider than
 * `maxDays` (MAX_WINDOW_DAYS), never before the tracker's first report — and
 * a plain sentence for every cut, so the answer says what it covers.
 */
export function clampWindow(
  fromMs: number,
  toMs: number,
  o: { nowMs: number; tz: string; earliestMs?: number | null; maxDays?: number },
): ClampedWindow | { error: string } {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return { error: 'That time window could not be read.' }
  const notes: string[] = []
  const to = Math.min(toMs, o.nowMs)
  let from = fromMs
  if (from >= o.nowMs) return { error: `That window hasn't started yet — it is ${fmtWhen(o.nowMs, o.tz)} now.` }
  if (from >= to) return { error: 'That window ends before it starts.' }
  const maxDays = o.maxDays ?? MAX_WINDOW_DAYS
  if (to - from > maxDays * DAY_MS) {
    from = to - maxDays * DAY_MS
    notes.push(`Ask AI reads at most ${maxDays} days at a time, so these numbers cover only the last ${maxDays} days of that (from ${fmtWhen(from, o.tz)}).`)
  }
  if (o.earliestMs != null && from < o.earliestMs) {
    if (o.earliestMs >= to) return { error: `No reports in that window — this tracker's first report was ${fmtWhen(o.earliestMs, o.tz)}.` }
    if (o.earliestMs - from > 10 * 60_000) notes.push(`This tracker's first report was ${fmtWhen(o.earliestMs, o.tz)}, so the numbers start there.`)
    from = o.earliestMs
  }
  return { from, to, notes }
}

// ── Which activity question is this? ────────────────────────────────────────

export type ActivityFocus = 'fuel' | 'speed' | 'idle' | 'time' | 'miles' | 'summary'

const FUEL_ALWAYS = /\b(gallons?|gals?|mpg|refuel(?:ed|s|ing)?|fill ?ups?|filled up|fueled up)\b/
const FUEL_WORD = /\b(fuel|diesel|gas|gasoline)\b/
const FUEL_USE = /\b(burn|burns|burned|burnt|burning|use|used|uses|using|consum\w*|go(?:es)? through|went through|gone through)\b/
/** "How much fuel does it have" is the gauge right now, not fuel used. */
const FUEL_NOW = /\b(level|left|remaining|have|has|in the tank|right now|currently)\b/
/** "Did it stop at a gas station" is a stops question. */
const FUEL_PLACE = /\b(?:gas|fuel) stations?\b|\bstop(?:ped|s)?\b/
const SPEED = /\b(top speed|fastest|how fast|max(?:imum)? speed|highest speed|speeding)\b/
const IDLE = /\bidl(?:e|ed|es|ing)\b/
const TIME = /\b(drive time|driving time|moving time|run ?time|engine hours|engine starts?|how many starts|(?:how long|how many hours) (?:did|has|was|were) .{0,40}\b(?:drive|driving|driven|drove|move|moving|moved|run|running|ran|on the road))\b/
const MILES = /\b(miles?|mileage|how far|distance|drove|driven|travell?ed|put on)\b/
/** "How far is it from the yard" is a distance-now question (eta_to_zone). */
const NOT_MILES = /\b(away|odometer)\b|\bhow far (?:is|are)\b|\bmiles? from (?:the |here|there)\b/
const SUMMARY = /\b(what (?:did|has|was|were) .{0,40}\b(?:do|doing|done|up to)|activity|usage|utiliz\w*|summary|recap|how busy)\b/

/** The activity a question asks about, or null. Idling, and "what did X
 *  do", need a window — without one they are right-now questions. */
export function activityFocus(question: string, hasWindow: boolean): ActivityFocus | null {
  const q = normalizeAsk(question)
  if (FUEL_ALWAYS.test(q) || (FUEL_WORD.test(q) && !FUEL_PLACE.test(q) && (FUEL_USE.test(q) || (hasWindow && !FUEL_NOW.test(q))))) return 'fuel'
  if (SPEED.test(q)) return 'speed'
  if (IDLE.test(q) && hasWindow) return 'idle'
  if (TIME.test(q)) return 'time'
  if (MILES.test(q) && !NOT_MILES.test(q)) return 'miles'
  if (hasWindow && SUMMARY.test(q)) return 'summary'
  return null
}

/** The question's own words, minus the window and the activity vocabulary —
 *  what is left names the machine ("the ram 2500"). */
const ACTIVITY_WORDS = /\b(how|many|much|far|fast|long|miles?|mileage|distance|drove|driven|drive|driving|travel\w*|went|go|gone|put|fuel|diesel|gas|gasoline|gallons?|gals?|mpg|burn\w*|use[ds]?|using|consum\w*|through|refuel\w*|fill\w*|up|tank|top|speed|fastest|max\w*|highest|idl\w*|engine|hours?|starts?|run\w*|time|moving|moved|move|activity|usage|utiliz\w*|summary|recap|busy|until|till|now|right)\b/g

export interface ActivityIntent {
  focus: ActivityFocus
  window: PhraseWindow | null
  /** The question with the window and the activity words taken out. */
  rest: string
}

export function activityIntent(question: string, nowMs: number, tz: string): ActivityIntent | null {
  const q = normalizeAsk(question)
  const window = resolveWindowPhrase(q, nowMs, tz)
  const focus = activityFocus(q, !!window)
  if (!focus) return null
  const rest = (window ? q.replace(window.match, ' ') : q).replace(ACTIVITY_WORDS, ' ').replace(/\s+/g, ' ').trim()
  return { focus, window, rest }
}

/** "What did the trucks do today" asks about the fleet, so it never borrows
 *  the one machine the last question was about. */
export function asksWholeFleet(question: string): boolean {
  return /\b(trucks|machines|vehicles|fleet|everything|everyone|all|each|every|crews)\b/.test(normalizeAsk(question))
}

const FOLLOW_ON = /^(?:and|what about|how about)\b/

/** "And the F350?" / "what about yesterday?" right after an activity
 *  question: the same question, with whatever the new words change. */
export function followOnIntent(question: string, before: ActivityIntent | null, nowMs: number, tz: string): ActivityIntent | null {
  const q = normalizeAsk(question)
  if (!before || !FOLLOW_ON.test(q)) return null
  const window = resolveWindowPhrase(q, nowMs, tz)
  const rest = (window ? q.replace(window.match, ' ') : q).replace(FOLLOW_ON, ' ').replace(/\s+/g, ' ').trim()
  return { focus: before.focus, window, rest }
}

// ── A window's activity, in words ───────────────────────────────────────────

export interface ActivityFuel {
  /** Read off the truck's own gauge (null: no usable readings in the window). */
  gauge: FuelGauge | null
  /** The truck's computer has sent a fuel level at some point. */
  reportsFuel: boolean
  /** Miles driven while the gauge was silent (null without a gauge). */
  silentMiles: number | null
  tankGallons: number | null
  tankSource: 'specs' | 'notes' | null
  /** The mpg behind the distance ballpark (estMpgForSpecs). */
  estMpg: number
}

export interface ActivityFacts {
  asset: string
  fromMs: number
  toMs: number
  nowMs: number
  tz: string
  /** Plain sentences for every cut made to the window. */
  notes: string[]
  fixes: number
  truncated: boolean
  stats: RangeStats
  lastReportMs: number | null
  /** Trucks and machines only. */
  fuel: ActivityFuel | null
}

const round1 = (n: number) => Math.round(n * 10) / 10
const fmtNum = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

/** "10 h 40 min" / "45 min". */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** The gauge missed enough of the driving that its figure undercounts. */
function gaugePartial(f: ActivityFacts): boolean {
  const silent = f.fuel?.silentMiles ?? 0
  return silent >= Math.max(5, 0.1 * f.stats.miles)
}

function refuelWords(r: FuelGauge['refuels'][number], f: ActivityFacts): string {
  const when = r.atMs - r.beforeMs > HOUR_MS
    ? `between ${fmtWhen(r.beforeMs, f.tz)} and ${fmtWhen(r.atMs, f.tz)}`
    : fmtWhen(r.atMs, f.tz)
  const gal = f.fuel?.tankGallons ? `, ~${fmtNum(round1((r.addedPct / 100) * f.fuel.tankGallons))} gal` : ''
  return `${when} +${Math.round(r.addedPct)}%${gal}`
}

/** What the model gets back from asset_activity. */
export function activityToolResult(f: ActivityFacts): Record<string, unknown> {
  const s = f.stats
  const out: Record<string, unknown> = {
    asset: f.asset,
    window: windowWords(f.fromMs, f.toMs, f.nowMs, f.tz),
    timezone: f.tz,
    ...(f.notes.length ? { notes: f.notes } : {}),
    fixes: f.fixes,
    ...(f.fixes ? {} : { lastReport: f.lastReportMs != null ? fmtWhen(f.lastReportMs, f.tz) : null }),
    miles: s.miles,
    topSpeedMph: s.maxMph,
    movingMin: s.movingMin,
    idleMin: s.idleMin,
    parkedMin: s.parkedMin,
    starts: s.starts,
  }
  const fuel = f.fuel
  if (fuel) {
    const g = fuel.gauge
    const tank = fuel.tankGallons
    out.fuel = {
      measuredBy: g ? 'the truck\'s own fuel gauge' : 'nothing — estimate only',
      ...(g
        ? {
            gaugeUsedPctOfTank: Math.round(g.usedPct),
            ...(tank ? { gaugeUsedGallons: round1((g.usedPct / 100) * tank) } : {}),
            gaugeStartPct: Math.round(g.startPct),
            gaugeEndPct: Math.round(g.endPct),
            // Counted for the model: listing three fills, it once said
            // "refueled twice" (live check, Sep 28).
            refuelCount: g.refuels.length,
            refuels: g.refuels.map((r) => ({
              at: fmtWhen(r.atMs, f.tz),
              ...(r.atMs - r.beforeMs > HOUR_MS ? { sometimeAfter: fmtWhen(r.beforeMs, f.tz) } : {}),
              addedPctOfTank: Math.round(r.addedPct),
              fromPct: Math.round(r.fromPct),
              toPct: Math.round(r.toPct),
              ...(tank ? { addedGallons: round1((r.addedPct / 100) * tank) } : {}),
            })),
            gaugeCoverage: gaugePartial(f)
              ? `partial — the gauge was silent for ${fuel.silentMiles} of ${s.miles} mi, so the gauge figure undercounts`
              : 'whole window',
          }
        : { why: fuel.reportsFuel ? 'the fuel gauge did not report during this window' : 'this truck\'s computer does not report a fuel level' }),
      tankGallons: tank,
      ...(fuel.tankSource ? { tankFrom: fuel.tankSource === 'notes' ? 'the asset\'s notes' : 'the asset\'s specs' } : {}),
      estimateGallons: s.fuelGalEst,
      estimateBasis: `${s.miles} mi at ~${fuel.estMpg} mpg + ${round1(s.idleMin / 60)} h idling at ${IDLE_GAL_PER_H} gal/h — a ballpark from distance, not a measurement`,
    }
  }
  if (f.truncated) out.dataTruncated = true
  out.note = 'Say which window these cover (the `window` text) and pass along any `notes`. Fuel: when measuredBy is the gauge, lead with gaugeUsedPctOfTank (over 100 = more than one tank, refilled along the way) and the refuels — refuelCount is how many, never count them yourself; give gallons only from gaugeUsedGallons or a tank size the user states — never assume a tank size. estimateGallons is a ballpark from distance: call it an estimate.'
  return out
}

/** One sentence (two at most) for the built-in engine. */
export function activityAnswer(f: ActivityFacts, focus: ActivityFocus): string {
  const w = windowWords(f.fromMs, f.toMs, f.nowMs, f.tz)
  const notes = f.notes.length ? ` ${f.notes.join(' ')}` : ''
  if (!f.fixes) {
    const last = f.lastReportMs != null ? ` Its last report was ${fmtWhen(f.lastReportMs, f.tz)}.` : ''
    return `No reports from ${f.asset} for ${w}, so there is nothing to count.${last}${notes}`
  }
  const s = f.stats
  const lead = `${f.asset}, ${w}:`
  const miles = `${fmtNum(s.miles)} mi`
  switch (focus) {
    case 'fuel': return `${lead} ${fuelWords(f)}${notes}`
    case 'speed': return `${lead} top speed ${s.maxMph} mph, over ${miles} driven.${notes}`
    case 'idle':
      return s.idleMin
        ? `${lead} idled ${fmtDur(s.idleMin)} (engine running, not moving), on top of ${fmtDur(s.movingMin)} on the move.${notes}`
        : `${lead} no idling recorded (engine running, not moving) — ${fmtDur(s.movingMin)} on the move.${notes}`
    case 'time':
      return `${lead} ${fmtDur(s.movingMin)} on the move and ${fmtDur(s.idleMin)} idling, ${s.starts} start${s.starts === 1 ? '' : 's'}.${notes}`
    case 'summary': {
      const fw = f.fuel ? fuelWords(f) : ''
      const fuel = fw ? ` ${fw[0].toUpperCase()}${fw.slice(1)}` : ''
      return `${lead} ${miles} driven, ${fmtDur(s.movingMin)} on the move, ${fmtDur(s.idleMin)} idling, ${s.starts} start${s.starts === 1 ? '' : 's'}, top speed ${s.maxMph} mph.${fuel}${notes}`
    }
    case 'miles':
    default:
      return s.miles < 0.1
        ? `${lead} it didn't move${s.idleMin ? ` (idled ${fmtDur(s.idleMin)})` : ''}.${notes}`
        : `${lead} ${miles} driven — ${fmtDur(s.movingMin)} on the move, top speed ${s.maxMph} mph.${notes}`
  }
}

/** Fuel in words: the gauge first, gallons only from a known tank, the
 *  distance ballpark always labeled. */
function fuelWords(f: ActivityFacts): string {
  const s = f.stats
  const fuel = f.fuel
  if (!fuel) return 'fuel only applies to trucks and machines.'
  const idle = s.idleMin ? ` plus ${fmtDur(s.idleMin)} idling` : ''
  const estimate = `about ${fmtNum(s.fuelGalEst)} gal by distance (${fmtNum(s.miles)} mi at ~${fuel.estMpg} mpg${idle}) — an estimate, not a measurement`
  const g = fuel.gauge
  if (!g) {
    const why = fuel.reportsFuel ? 'its fuel gauge didn\'t report in this window' : 'this truck\'s computer doesn\'t report a fuel level'
    return `${estimate}; ${why}.`
  }
  const used = Math.round(g.usedPct)
  const tank = fuel.tankGallons
  const fills = g.refuels.length
    ? `, with ${g.refuels.length} fill-up${g.refuels.length === 1 ? '' : 's'} (${g.refuels.slice(0, 3).map((r) => refuelWords(r, f)).join('; ')}${g.refuels.length > 3 ? `; ${g.refuels.length - 3} more` : ''})`
    : ''
  const partial = gaugePartial(f)
    ? ` The gauge was silent for ${fmtNum(fuel.silentMiles ?? 0)} of the ${fmtNum(s.miles)} mi, so the real figure is higher.`
    : ''
  if (used < FUEL_NOISE_PCT && !g.refuels.length) {
    return `its own fuel gauge shows no measurable drop (under ${FUEL_NOISE_PCT}% of the tank).${partial}`
  }
  const tanks = used >= 100 ? ` — about ${(used / 100).toFixed(1)} tanks` : ''
  if (tank) {
    return `its own fuel gauge shows ${used}% of the ${fmtNum(tank)}-gal tank used${tanks}: about ${fmtNum(round1((g.usedPct / 100) * tank))} gal${fills}.${partial}`
  }
  return `its own fuel gauge shows ${used}% of the tank used${tanks}${fills}. The tank size isn't on file, so in gallons that's ${estimate}.${partial} Add the tank size to the truck's notes (e.g. "32 gal tank") and I'll turn the gauge into gallons.`
}
