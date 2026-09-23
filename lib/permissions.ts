/**
 * Roles v2 (Sep 4 2026 — Brian's ladder):
 *
 *   Master Admin  the company's one owner login. Shows to everyone else as a
 *                 plain Admin. Sets the view-levels table for every role,
 *                 Admin included. Not a stored role: the profile whose id IS
 *                 the company id (the account that created the company).
 *   Admin         sees everything unless the Master says otherwise; sets the
 *                 view levels for the roles below Admin.
 *   Manager       a set of things the admins choose — defaults to the minor
 *                 financials (job costs, receipts) but not the books.
 *   Foreman       a set of things the admins choose — defaults to no dollars.
 *   Associate     the crew login: clock in, daily reports, maintenance, the
 *                 map, tags — plus whatever the admins switch on.
 *
 * Two layers, both explainable in a sentence:
 *   1. The VIEW LEVELS table — per role, which features are on. Company-wide,
 *      stored as companies.role_policy (a sparse override on the defaults).
 *   2. The three per-person switches that already existed (see $ / billing /
 *      manage team) for the exceptions.
 *
 * Pure module: safe to import from client components.
 */

export type Role = 'admin' | 'manager' | 'foreman' | 'associate' | 'prospect'
export const ROLES: Role[] = ['admin', 'manager', 'foreman', 'associate', 'prospect']

/** Rank on the ladder. Master is 4 (derived, never stored). A Prospective
 *  Client shares the Associate's rank for what they may SEE on the map
 *  (everyone-visible machines), but is otherwise outside the ladder: only
 *  the Master can create, see, manage or preview one (migration 118). */
export const RANK: Record<Role, number> = { prospect: 0, associate: 0, foreman: 1, manager: 2, admin: 3 }
export const MASTER_RANK = 4

/** Roles only the company owner may hand out, see on /team, or preview. */
export const MASTER_ONLY_ROLES: Role[] = ['prospect']

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', manager: 'Manager', foreman: 'Foreman', associate: 'Associate', prospect: 'Prospective Client',
}

export const ROLE_BLURB: Record<Role, string> = {
  admin: 'Everything — billing, team, settings',
  manager: 'Runs operations; sees job costs, not the books',
  foreman: 'Runs the day — no dollar figures',
  associate: 'Crew login — clock in, logs, maintenance, the map',
  prospect: 'Looks around the live account — the map, Command Center, the machines and sites; the crew, office and money pages show locked; invisible to everyone but you; changes nothing',
}

/**
 * Everything the view-levels table can switch. Page keys gate a route and
 * its nav entry; the Abilities gate what you can do inside pages.
 */
export type FeatureKey =
  | 'map' | 'command' | 'alerts' | 'aircraft'
  | 'clock' | 'logs' | 'assets' | 'zones' | 'measurements' | 'tags' | 'maintenance' | 'track'
  | 'reports' | 'accounting' | 'receipts' | 'finance' | 'team' | 'activity'
  | 'trackers' | 'hardware' | 'settings'
  | 'costs' | 'edit' | 'billing' | 'manage_team' | 'ask_ai'

export interface FeatureDef {
  key: FeatureKey
  label: string
  group: 'Watch' | 'Field' | 'Office' | 'Setup' | 'Abilities'
  hint: string
  href?: string
  /** The company owner's seat alone. Never grantable, never listed in the
   *  view-levels table, stripped from everyone else's features — so the page
   *  is absent from the navs, 404s on a typed URL, and nobody below the
   *  owner learns it exists (Brian, Sep 11: "they should not know they
   *  exist if it is not shared with them"). */
  masterOnly?: true
}

export const FEATURES: FeatureDef[] = [
  { key: 'map',          group: 'Watch',  label: 'Live map',        hint: 'Where everything is right now', href: '/map' },
  { key: 'command',      group: 'Watch',  label: 'Command Center',  hint: 'The wall display', href: '/command' },
  { key: 'alerts',       group: 'Watch',  label: 'Alerts',          hint: 'Theft, after-hours, left-site', href: '/alerts' },
  { key: 'aircraft',     group: 'Watch',  label: 'Flight log',      hint: 'Aircraft history by tail number', href: '/aircraft' },
  { key: 'clock',        group: 'Field',  label: 'Time clock',      hint: 'Clock in and out', href: '/clock' },
  { key: 'logs',         group: 'Field',  label: 'Daily logs',      hint: 'Daily reports from the field', href: '/logs' },
  { key: 'assets',       group: 'Field',  label: 'Assets',          hint: 'The fleet list and each machine', href: '/assets' },
  { key: 'zones',        group: 'Field',  label: 'Zones',           hint: 'Sites, yards, boundaries', href: '/zones' },
  { key: 'measurements', group: 'Field',  label: 'Measurements',    hint: 'Measure on the map', href: '/measurements' },
  { key: 'tags',         group: 'Field',  label: 'Tag scanner',     hint: 'Bluetooth tool tags', href: '/tags' },
  { key: 'maintenance',  group: 'Field',  label: 'Maintenance',     hint: 'Service schedules and work orders', href: '/maintenance' },
  { key: 'track',        group: 'Field',  label: 'Share location',  hint: 'Put your own phone on the map', href: '/track' },
  { key: 'reports',      group: 'Office', label: 'Reports',         hint: 'Utilization, safety grades', href: '/reports' },
  { key: 'accounting',   group: 'Office', label: 'Accounting',      hint: 'QuickBooks, invoices, expenses', href: '/accounting' },
  { key: 'receipts',     group: 'Office', label: 'Receipts',        hint: 'Receipt capture and chase', href: '/receipts' },
  { key: 'finance',      group: 'Office', label: 'Financials',      hint: 'Revenue, margin, valuation', href: '/finance' },
  { key: 'team',         group: 'Office', label: 'Team',            hint: 'Who is on the team', href: '/team' },
  { key: 'activity',     group: 'Office', label: 'Team activity',   hint: 'Who did what, when', href: '/activity', masterOnly: true },
  { key: 'trackers',     group: 'Setup',  label: 'Trackers',        hint: 'The drawer, swaps, undo', href: '/trackers' },
  { key: 'hardware',     group: 'Setup',  label: 'Hardware setup',  hint: 'SIM + config checklist per box', href: '/assets/onboard' },
  { key: 'settings',     group: 'Setup',  label: 'Settings',        hint: 'Company settings (your own account is always yours)', href: '/settings' },
  { key: 'costs',        group: 'Abilities', label: 'See $ figures',  hint: 'Rates, job costs, $/day on the map' },
  { key: 'edit',         group: 'Abilities', label: 'Edit things',    hint: 'Add/edit assets, zones, alerts, maintenance' },
  { key: 'billing',      group: 'Abilities', label: 'Billing & QBO',  hint: 'Subscription, QuickBooks connect' },
  { key: 'manage_team',  group: 'Abilities', label: 'Manage team',    hint: 'Invite, remove, change roles' },
  { key: 'ask_ai',       group: 'Abilities', label: 'Ask AI',         hint: 'The in-app assistant' },
]

export const FEATURE_KEYS = FEATURES.map((f) => f.key)
/** Owner-seat features — see FeatureDef.masterOnly. */
export const MASTER_ONLY: FeatureKey[] = FEATURES.filter((f) => f.masterOnly).map((f) => f.key)
/** What a Prospective Client can never be given, whatever the view-levels
 *  table says: every write ability, every people page, every money page,
 *  the crew's own side (clock, logs, tags, share location — each would put
 *  THEIR phone or their words into the company's records) and the office
 *  side (receipts, accounting, settings, trackers, hardware — the tables
 *  behind them are unreadable for the role, 119), plus the AI (its tools
 *  read the whole company with the service role). Since Sep 23 these show
 *  in the navs as LOCKED (see navStateFor) instead of not existing —
 *  except PROSPECT_HIDDEN. Everything else — the map, Command Center,
 *  alerts, the flight log, assets, zones, measurements, maintenance,
 *  reports — the Master switches per company in the view-levels table. */
export const PROSPECT_NEVER: FeatureKey[] = ['edit', 'costs', 'billing', 'manage_team', 'ask_ai', 'team', 'activity', 'finance', 'clock', 'logs', 'track', 'tags', 'receipts', 'accounting', 'settings', 'trackers', 'hardware']
/** The pages a Prospective Client must not even see in a nav (Brian, Sep
 *  23: "they should not see team or financials or be seen by anyone else on
 *  the team except for me"). Absent from every nav, 404 on a typed URL. */
export const PROSPECT_HIDDEN: FeatureKey[] = ['team', 'activity', 'finance']
/** What the view-levels table is allowed to show and store. */
export const GRANTABLE_FEATURES: FeatureDef[] = FEATURES.filter((f) => !f.masterOnly)

const ALL_ON = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>
const on = (...keys: FeatureKey[]): Record<FeatureKey, boolean> => {
  const out = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>
  for (const k of keys) out[k] = true
  return out
}

/** The defaults Brian set. Admins change these per company on /team. */
export const ROLE_FEATURE_DEFAULTS: Record<Role, Record<FeatureKey, boolean>> = {
  admin: ALL_ON,
  manager: on(
    'map', 'command', 'alerts', 'aircraft',
    'clock', 'logs', 'assets', 'zones', 'measurements', 'tags', 'maintenance', 'track',
    'reports', 'receipts', 'team', 'trackers', 'hardware',
    'costs', 'edit', 'ask_ai',
  ),
  foreman: on(
    'map', 'command', 'alerts', 'aircraft',
    'clock', 'logs', 'assets', 'zones', 'measurements', 'tags', 'maintenance', 'track',
    'reports', 'receipts', 'trackers', 'hardware',
    'edit', 'ask_ai',
  ),
  associate: on(
    'map', 'alerts', 'aircraft',
    'clock', 'logs', 'assets', 'zones', 'tags', 'maintenance', 'track',
    'receipts',
    'ask_ai',
  ),
  // A prospect looks at the product the way the owner does (Brian, Sep 23:
  // "they should see what I see — command center, all buttons"): every page
  // the role CAN hold is on by default; the Master narrows per company in
  // the view-levels table. The crew's side, the office side, people and
  // money are PROSPECT_NEVER — locked in the navs, never switchable.
  prospect: on('map', 'command', 'alerts', 'aircraft', 'assets', 'zones', 'measurements', 'maintenance', 'reports'),
}

/** Company-wide override on the defaults: role → feature → on/off. Sparse. */
export type RolePolicy = Partial<Record<Role, Partial<Record<FeatureKey, boolean>>>>

export interface Permissions {
  role: Role
  /** The one owner login — shows as Admin to everyone else. */
  isMaster: boolean
  /** Effective feature set after the view-levels table + per-person switches. */
  features: FeatureKey[]
  /** Edit assets/zones/alerts/maintenance (operate the system). */
  canEdit: boolean
  /** See dollar figures: asset rates, job costs, invoices, reports $. */
  canViewCosts: boolean
  /** Accounting page, QuickBooks connect/invoices/expenses, subscription. */
  canManageBilling: boolean
  /** Invite/remove members, change roles + the view levels below you. */
  canManageTeam: boolean
  /** Set when an admin is previewing the app as someone else (read-only). */
  viewingAs?: { id: string; name: string; role: Role } | null
}

/** Back-compat view of the four booleans, for code that reads ROLE_DEFAULTS. */
export const ROLE_DEFAULTS: Record<Role, Pick<Permissions, 'canEdit' | 'canViewCosts' | 'canManageBilling' | 'canManageTeam'>> = Object.fromEntries(
  ROLES.map((r) => [r, {
    canEdit: ROLE_FEATURE_DEFAULTS[r].edit,
    canViewCosts: ROLE_FEATURE_DEFAULTS[r].costs,
    canManageBilling: ROLE_FEATURE_DEFAULTS[r].billing,
    canManageTeam: ROLE_FEATURE_DEFAULTS[r].manage_team,
  }]),
) as Record<Role, Pick<Permissions, 'canEdit' | 'canViewCosts' | 'canManageBilling' | 'canManageTeam'>>

export interface ProfileOverrides {
  role?: string | null
  can_view_costs?: boolean | null
  can_manage_billing?: boolean | null
  can_manage_team?: boolean | null
}

/** Accept the stored role, mapping the retired 'viewer' to Associate. */
export function normalizeRole(raw: string | null | undefined, fallback: Role): Role {
  if (raw === 'viewer') return 'associate'
  return (ROLES as string[]).includes(raw ?? '') ? (raw as Role) : fallback
}

/** The effective feature map for a role under a company policy. */
export function featuresForRole(role: Role, policy: RolePolicy | null | undefined): Record<FeatureKey, boolean> {
  const out = { ...ROLE_FEATURE_DEFAULTS[role] }
  const p = policy?.[role]
  if (p) for (const k of FEATURE_KEYS) if (typeof p[k] === 'boolean') out[k] = p[k] as boolean
  return out
}

/**
 * Merge a profile row + the company's view levels into one resolved set.
 *   - The Master keeps everything, always.
 *   - Admins follow the table (only the Master can edit their row).
 *   - Everyone else: table, then the three per-person switches on top.
 */
export function resolvePermissions(
  p: ProfileOverrides | null | undefined,
  isOwner = false,
  policy: RolePolicy | null = null,
): Permissions {
  const role = normalizeRole(p?.role, isOwner ? 'admin' : 'associate')
  if (isOwner) {
    return { role: 'admin', isMaster: true, features: [...FEATURE_KEYS], canEdit: true, canViewCosts: true, canManageBilling: true, canManageTeam: true, viewingAs: null }
  }
  const f = featuresForRole(role, policy)
  if (role !== 'admin') {
    if (p?.can_view_costs != null) f.costs = p.can_view_costs
    if (p?.can_manage_billing != null) f.billing = p.can_manage_billing
    if (p?.can_manage_team != null) f.manage_team = p.can_manage_team
  }
  // Master-only features are stripped LAST: not the defaults, not a stored
  // policy row, not an admin editing the table can hand one out.
  for (const k of MASTER_ONLY) f[k] = false
  // A Prospective Client can be shown MORE of the product by the Master, but
  // never handed a door to people, money or writes: 118 keeps their JWT
  // read-only, and these are the service-role doors the view-levels table
  // could otherwise open (sec-check, Sep 21).
  if (MASTER_ONLY_ROLES.includes(role)) for (const k of PROSPECT_NEVER) f[k] = false
  return {
    role, isMaster: false,
    features: FEATURE_KEYS.filter((k) => f[k]),
    canEdit: f.edit, canViewCosts: f.costs, canManageBilling: f.billing, canManageTeam: f.manage_team,
    viewingAs: null,
  }
}

export function rankOf(p: Pick<Permissions, 'role' | 'isMaster'>): number {
  return p.isMaster ? MASTER_RANK : RANK[p.role]
}

/** A Prospective Client login — never the Master; a Master's view-as preview
 *  of one counts, so the preview shows exactly what the prospect gets. */
export function isProspect(p: Pick<Permissions, 'role' | 'isMaster'>): boolean {
  return !p.isMaster && p.role === 'prospect'
}

/** May `actor` manage / preview / read the AI chats of `target`? Strictly
 *  DOWN the ladder; the Master over everyone; nobody over the Master. A
 *  Prospective Client answers to the Master alone (118). */
export function outranks(actor: Pick<Permissions, 'role' | 'isMaster'>, target: { role: Role; isMaster: boolean }): boolean {
  if (target.isMaster) return false
  if (MASTER_ONLY_ROLES.includes(target.role)) return actor.isMaster
  return rankOf(actor) > RANK[target.role]
}

/** May `actor` know `target` exists at all — on /team, in a roster, in a
 *  view-as list? Everyone sees the ladder; a prospect is seen by the Master
 *  and by themselves, and sees nobody but themselves. Mirrors 118's RLS. */
export function canSeeMember(
  actor: Pick<Permissions, 'role' | 'isMaster'> & { id?: string | null },
  target: { id?: string | null; role: Role },
): boolean {
  if (actor.id && target.id && actor.id === target.id) return true
  if (!actor.isMaster && actor.role === 'prospect') return false
  if (MASTER_ONLY_ROLES.includes(target.role)) return actor.isMaster
  return true
}

/** Roles whose view-levels row this actor may edit. */
export function rolesEditableBy(actor: Pick<Permissions, 'role' | 'isMaster' | 'canManageTeam'>): Role[] {
  if (actor.isMaster) return ROLES
  if (actor.role === 'admin' || actor.canManageTeam) return ROLES.filter((r) => RANK[r] < rankOf(actor) && !MASTER_ONLY_ROLES.includes(r))
  return []
}

/**
 * Routes that are deliberately ungated for every signed-in person, even
 * though a longer-prefix rule below would otherwise catch them.
 *
 * /settings/phone is the one switch nobody needs permission for: quieting
 * your own phone. `settings` is an Admin-only view level, so without this a
 * Manager, Foreman or Associate could not reach their own notification
 * switches at all (ship-check, Sep 12).
 */
const UNGATED_PATHS = ['/settings/phone']

/** Which feature gates a route. Longest prefix wins; unknown = ungated. */
export function featureForPath(pathname: string): FeatureKey | null {
  if (UNGATED_PATHS.some((u) => pathname === u || pathname.startsWith(u + '/'))) return null
  const map: [string, FeatureKey][] = [
    ['/assets/onboard', 'hardware'],
    ['/map', 'map'], ['/command', 'command'], ['/alerts', 'alerts'], ['/aircraft', 'aircraft'],
    ['/clock', 'clock'], ['/timecards', 'clock'], ['/logs', 'logs'], ['/photos', 'logs'], ['/assets', 'assets'], ['/zones', 'zones'],
    ['/measurements', 'measurements'], ['/tags', 'tags'], ['/maintenance', 'maintenance'], ['/track', 'track'],
    ['/reports', 'reports'], ['/accounting', 'accounting'], ['/receipts', 'receipts'], ['/finance', 'finance'],
    ['/team', 'team'], ['/activity', 'activity'], ['/trackers', 'trackers'], ['/settings', 'settings'],
  ]
  let best: [string, FeatureKey] | null = null
  for (const m of map) if (pathname === m[0] || pathname.startsWith(m[0] + '/')) if (!best || m[0].length > best[0].length) best = m
  return best?.[1] ?? null
}

// ── How a nav entry shows ───────────────────────────────────────────────────
export type NavState = 'open' | 'locked' | 'hidden'
/**
 * Everyone: a page outside your view levels does not exist for you — absent
 * from the navs, 404 on a typed URL (Brian, Sep 11). A Prospective Client is
 * the one exception (Brian, Sep 23: "they should see what I see — command
 * center, all buttons, but the ones they don't have access to should show
 * some 'sorry, you do not have access to this'"): every page shows, LOCKED
 * when it is off for them, and the lock opens /locked, which says so —
 * except the people and money pages (PROSPECT_HIDDEN), which stay hidden.
 * `role` is the EFFECTIVE role (a Master previewing a prospect passes
 * 'prospect'), so the preview is the prospect's own screen.
 */
export function navStateFor(pathname: string, features: string[] | null | undefined, role?: string | null): NavState {
  const k = featureForPath(pathname)
  if (!features || !k || features.includes(k)) return 'open'
  if (role === 'prospect' && !PROSPECT_HIDDEN.includes(k)) return 'locked'
  return 'hidden'
}
/** Pages whose nav label is not their feature's label — the locked page
 *  names what you tapped ("Time cards", not "Time clock"). */
export const PATH_LABELS: Record<string, string> = { '/timecards': 'Time cards', '/photos': 'Photos' }
/** Where a locked nav entry goes: the page that says what is locked and why. */
export function lockedHref(pathname: string): string {
  const p = pathname in PATH_LABELS ? `&p=${encodeURIComponent(pathname)}` : ''
  return `/locked?f=${featureForPath(pathname) ?? ''}${p}`
}
/** The view-levels label for a feature key (the /locked page's headline). */
export function featureLabel(key: string | null | undefined): string | null {
  return FEATURES.find((f) => f.key === key)?.label ?? null
}
/** The first page these view levels open — the "home" door when the map
 *  itself is switched off (the locked page must never send you back to a
 *  lock). null = nothing is open at all. */
export function firstOpenHref(features: string[]): string | null {
  return FEATURES.find((f) => f.href && features.includes(f.key))?.href ?? null
}

// ── Per-asset visibility (111) ──────────────────────────────────────────────
// Who may see ONE asset, on top of the feature gates above. Stored as
// assets.metadata.visibility (absent = everyone); enforced by RLS so every
// reader obeys it, and mirrored here so "view app as" previews and the UI
// can reason about it without a round trip. Ranks line up with RANK /
// MASTER_RANK: a viewer sees an asset when rankOf(viewer) >= its rank.
export type AssetVisibility = 'everyone' | 'managers' | 'admins' | 'master'
export const ASSET_VISIBILITY: { key: AssetVisibility; rank: number; label: string; blurb: string }[] = [
  { key: 'everyone', rank: 0, label: 'Everyone', blurb: 'The whole company, as usual' },
  { key: 'managers', rank: 2, label: 'Managers+', blurb: 'Managers, Admins and the owner' },
  { key: 'admins', rank: 3, label: 'Admins', blurb: 'Admins and the owner' },
  { key: 'master', rank: MASTER_RANK, label: 'Owner only', blurb: 'Only the account owner' },
]
export function assetVisibility(meta: unknown): AssetVisibility {
  const v = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).visibility : undefined
  return v === 'managers' || v === 'admins' || v === 'master' ? v : 'everyone'
}
export function visibilityRank(v: AssetVisibility): number {
  return ASSET_VISIBILITY.find((d) => d.key === v)?.rank ?? 0
}
export function visibilityLabel(v: AssetVisibility): string {
  return ASSET_VISIBILITY.find((d) => d.key === v)?.label ?? 'Everyone'
}
/** May this viewer see an asset with this metadata (and type)? A Prospective
 *  Client never sees a person — crew phones are `personnel` assets (118). */
export function canSeeAsset(p: Pick<Permissions, 'role' | 'isMaster'>, meta: unknown, type?: string | null): boolean {
  if (!p.isMaster && p.role === 'prospect' && type === 'personnel') return false
  return rankOf(p) >= visibilityRank(assetVisibility(meta))
}
/** The subset of `list` this viewer may see. */
export function visibleAssets<T extends { metadata?: unknown; type?: string | null }>(list: T[], p: Pick<Permissions, 'role' | 'isMaster'>): T[] {
  return list.filter((a) => canSeeAsset(p, a.metadata, a.type))
}
