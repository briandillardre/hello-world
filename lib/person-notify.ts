import { normalizeRole, type Role } from './permissions'

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

/**
 * What we actually STORE: only the switches somebody has touched.
 *
 * The first cut wrote all five booleans on every save, which froze a person
 * against their own role. Promote a Foreman to Admin and they should start
 * getting the still-on-the-clock nag; with a full blob on file they never
 * would, because a resolved `false` is indistinguishable from a chosen one.
 * Sparse keeps every untouched key following the role default forever
 * (ship-check, Sep 12).
 *
 * OWN properties only, same reason as resolvePersonNotify.
 */
export function sparsePersonNotify(
  raw: unknown,
  patch: Partial<Record<PushKind, boolean>> = {},
): Partial<Record<PushKind, boolean>> {
  const out: Partial<Record<PushKind, boolean>> = {}
  const take = (o: Record<string, unknown>) => {
    for (const k of PUSH_KINDS) {
      if (Object.prototype.hasOwnProperty.call(o, k) && typeof o[k] === 'boolean') out[k] = o[k] as boolean
    }
  }
  if (raw && typeof raw === 'object') take(raw as Record<string, unknown>)
  take(patch as Record<string, unknown>)
  return out
}

/**
 * Who last changed this phone and when — stored beside the switches as `_by`
 * / `_at`, ignored by every resolver above (they read PUSH_KINDS only).
 *
 * An admin can silence a subordinate's theft alerts. That is deliberate — a
 * shop hand's phone should not scream at 2 AM — but it must never be
 * invisible: the person sees who did it on their own card (sec-check, Sep 12).
 */
export interface PersonNotifyMeta { by: string | null; at: string | null }

export function personNotifyMeta(raw: unknown): PersonNotifyMeta {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const get = (k: string) =>
    Object.prototype.hasOwnProperty.call(p, k) && typeof p[k] === 'string' ? (p[k] as string) : null
  return { by: get('_by'), at: get('_at') }
}

/**
 * The role that decides a person's push defaults. The Master Admin is the
 * company creator (`profiles.id === companies.id`) and reads as Admin
 * everywhere else (lib/db/team.ts) — resolve them the same way here, or an
 * owner whose stored role is blank falls to Associate and silently loses
 * their own evening digest (ship-check, Sep 12).
 */
export function notifyRole(profileId: string, companyId: string, storedRole: string | null): Role {
  return profileId === companyId ? 'admin' : normalizeRole(storedRole, 'associate')
}

export const allPushOff = (p: PersonNotifyPrefs): boolean => PUSH_KINDS.every((k) => !p[k])

/**
 * Which of a company's device tokens this push may go to — the pure half of
 * `audienceTokens` in lib/push.ts, kept here so it can be tested without a
 * database.
 *
 * `wants` maps profile id → their answer for this kind. `rosterKnown` is
 * false when the profiles read failed, which is NOT the same as an empty
 * roster: with no roster we cannot say a token belongs to somebody who left,
 * only that we cannot attribute it.
 */
export function audienceFilter(
  rows: { token: string | null; user_id: string | null }[],
  wants: Map<string, boolean>,
  opts: { rosterKnown: boolean; kind: PushKind },
): string[] {
  return rows
    .filter((r) => {
      if (!r.token) return false
      if (r.user_id && wants.has(r.user_id)) return wants.get(r.user_id)!
      if (r.user_id && opts.rosterKnown) return false // off the team
      return opts.kind === 'alerts' // unattributable: safety only
    })
    .map((r) => r.token as string)
}
