import type { Role } from './permissions'

/**
 * WHO gets a push, person by person (Brian, Sep 12: "the push need to be per
 * person and admins can go in to change this for people").
 *
 * The company preferences (`companies.digest_prefs`) decide whether a summary
 * exists at all, when it goes out, and whether it also emails or texts the
 * company's alert address. This decides whose PHONE lights up. Both have to
 * say yes: a company that turned the evening digest off sends nothing to
 * anyone, and a person who muted it gets nothing even when the company
 * sends it.
 *
 * Stored on `profiles.notify_prefs` (migration 107) — one row per person per
 * company, which is exactly the grain we need.
 */

export const PUSH_KINDS = ['alerts', 'evening', 'monday', 'nag', 'receipts'] as const
export type PushKind = (typeof PUSH_KINDS)[number]

export type PersonNotifyPrefs = Record<PushKind, boolean>

export interface PushKindMeta {
  key: PushKind
  label: string
  blurb: string
  /** Safety traffic — allowed to be off, but we say what that means. */
  serious?: boolean
}

export const PUSH_KIND_META: PushKindMeta[] = [
  { key: 'alerts', label: 'Theft & alerts', blurb: 'A machine moving after hours, leaving a site, or a tracker going quiet.', serious: true },
  { key: 'receipts', label: 'Missing receipts', blurb: 'Only for cards mapped to this person. Stops the moment the photo is in.' },
  { key: 'evening', label: 'Evening digest', blurb: 'The end-of-day wrap for the whole company.' },
  { key: 'monday', label: 'Monday agenda', blurb: 'Last week’s problems as this week’s list.' },
  { key: 'nag', label: 'Still on the clock', blurb: 'Who never clocked out.' },
]

/**
 * Defaults by role, so a new crew member is quiet without anyone configuring
 * them. Alerts and their own receipts reach everybody — one is safety, the
 * other is about a card they personally ran. The company-wide summaries only
 * default on for the people who run the company; an Associate is on the map
 * and the clock, not the digest.
 */
export function defaultPersonNotify(role: Role): PersonNotifyPrefs {
  const runsTheCompany = role === 'admin' || role === 'manager' || role === 'foreman'
  return {
    alerts: true,
    receipts: true,
    evening: runsTheCompany,
    monday: runsTheCompany,
    nag: role === 'admin' || role === 'manager',
  }
}

/**
 * Merge a stored (possibly partial/null) blob over the role defaults.
 *
 * OWN properties only. A bare `p[k]` walks the prototype chain, so an object
 * carrying a `__proto__` key — an object literal, or any deserializer that
 * honours it — could hand us inherited booleans and quietly flip somebody's
 * switches. `hasOwnProperty.call` rather than `Object.hasOwn`: this module is
 * bundled into client components and old Android WebViews lack the latter
 * (see the Object.hasOwn note in CLAUDE.md).
 */
export function resolvePersonNotify(raw: unknown, role: Role): PersonNotifyPrefs {
  const base = defaultPersonNotify(role)
  if (!raw || typeof raw !== 'object') return base
  const p = raw as Record<string, unknown>
  const out = { ...base }
  for (const k of PUSH_KINDS) {
    if (Object.prototype.hasOwnProperty.call(p, k) && typeof p[k] === 'boolean') out[k] = p[k] as boolean
  }
  return out
}

/** Exactly the five booleans, nothing else, before it hits the database. */
export function cleanPersonNotify(prefs: Partial<Record<PushKind, unknown>>, role: Role): PersonNotifyPrefs {
  return resolvePersonNotify(prefs, role)
}

export const allPushOff = (p: PersonNotifyPrefs): boolean => PUSH_KINDS.every((k) => !p[k])
