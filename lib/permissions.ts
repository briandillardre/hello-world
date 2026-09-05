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

export type Role = 'admin' | 'manager' | 'foreman' | 'associate'
export const ROLES: Role[] = ['admin', 'manager', 'foreman', 'associate']

/** Rank on the ladder. Master is 4 (derived, never stored). */
export const RANK: Record<Role, number> = { associate: 0, foreman: 1, manager: 2, admin: 3 }
export const MASTER_RANK = 4

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', manager: 'Manager', foreman: 'Foreman', associate: 'Associate',
}

export const ROLE_BLURB: Record<Role, string> = {
  admin: 'Everything — billing, team, settings',
  manager: 'Runs operations; sees job costs, not the books',
  foreman: 'Runs the day — no dollar figures',
  associate: 'Crew login — clock in, logs, maintenance, the map',
}

/**
 * Everything the view-levels table can switch. Page keys gate a route and
 * its nav entry; the Abilities gate what you can do inside pages.
 */
export type FeatureKey =
  | 'map' | 'command' | 'alerts'
  | 'clock' | 'logs' | 'assets' | 'zones' | 'measurements' | 'tags' | 'maintenance' | 'track'
  | 'reports' | 'accounting' | 'receipts' | 'finance' | 'team' | 'activity'
  | 'trackers' | 'hardware' | 'settings'
  | 'costs' | 'edit' | 'billing' | 'manage_team' | 'ask_ai'

export interface FeatureDef { key: FeatureKey; label: string; group: 'Watch' | 'Field' | 'Office' | 'Setup' | 'Abilities'; hint: string; href?: string }

export const FEATURES: FeatureDef[] = [
  { key: 'map',          group: 'Watch',  label: 'Live map',        hint: 'Where everything is right now', href: '/map' },
  { key: 'command',      group: 'Watch',  label: 'Command Center',  hint: 'The wall display', href: '/command' },
  { key: 'alerts',       group: 'Watch',  label: 'Alerts',          hint: 'Theft, after-hours, left-site', href: '/alerts' },
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
  { key: 'activity',     group: 'Office', label: 'Team activity',   hint: 'Who did what, when', href: '/activity' },
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
    'map', 'command', 'alerts',
    'clock', 'logs', 'assets', 'zones', 'measurements', 'tags', 'maintenance', 'track',
    'reports', 'receipts', 'team', 'activity', 'trackers', 'hardware',
    'costs', 'edit', 'ask_ai',
  ),
  foreman: on(
    'map', 'command', 'alerts',
    'clock', 'logs', 'assets', 'zones', 'measurements', 'tags', 'maintenance', 'track',
    'reports', 'receipts', 'trackers', 'hardware',
    'edit', 'ask_ai',
  ),
  associate: on(
    'map', 'alerts',
    'clock', 'logs', 'assets', 'zones', 'tags', 'maintenance', 'track',
    'receipts',
    'ask_ai',
  ),
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

/** May `actor` manage / preview / read the AI chats of `target`? Strictly
 *  DOWN the ladder; the Master over everyone; nobody over the Master. */
export function outranks(actor: Pick<Permissions, 'role' | 'isMaster'>, target: { role: Role; isMaster: boolean }): boolean {
  if (target.isMaster) return false
  return rankOf(actor) > RANK[target.role]
}

/** Roles whose view-levels row this actor may edit. */
export function rolesEditableBy(actor: Pick<Permissions, 'role' | 'isMaster' | 'canManageTeam'>): Role[] {
  if (actor.isMaster) return ROLES
  if (actor.role === 'admin' || actor.canManageTeam) return ROLES.filter((r) => RANK[r] < rankOf(actor))
  return []
}

/** Which feature gates a route. Longest prefix wins; unknown = ungated. */
export function featureForPath(pathname: string): FeatureKey | null {
  const map: [string, FeatureKey][] = [
    ['/assets/onboard', 'hardware'],
    ['/map', 'map'], ['/command', 'command'], ['/alerts', 'alerts'],
    ['/clock', 'clock'], ['/logs', 'logs'], ['/assets', 'assets'], ['/zones', 'zones'],
    ['/measurements', 'measurements'], ['/tags', 'tags'], ['/maintenance', 'maintenance'], ['/track', 'track'],
    ['/reports', 'reports'], ['/accounting', 'accounting'], ['/receipts', 'receipts'], ['/finance', 'finance'],
    ['/team', 'team'], ['/activity', 'activity'], ['/trackers', 'trackers'], ['/settings', 'settings'],
  ]
  let best: [string, FeatureKey] | null = null
  for (const m of map) if (pathname === m[0] || pathname.startsWith(m[0] + '/')) if (!best || m[0].length > best[0].length) best = m
  return best?.[1] ?? null
}
