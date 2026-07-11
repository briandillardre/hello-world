/**
 * Role presets + per-user overrides → one resolved permission set.
 *
 * Philosophy: roles for the 90%, three sensitive toggles for the exceptions.
 * A full per-user × per-feature matrix is a support nightmare for a
 * contractor-owner admin; this stays explainable in one sentence:
 * "Pick a role; flip a switch if someone's an exception."
 */

export type Role = 'admin' | 'manager' | 'foreman' | 'viewer'

export interface Permissions {
  role: Role
  /** Edit assets/zones/alerts/maintenance (operate the system). */
  canEdit: boolean
  /** See dollar figures: asset rates, job costs, invoices, reports $. */
  canViewCosts: boolean
  /** Accounting page, QuickBooks connect/invoices/expenses, subscription. */
  canManageBilling: boolean
  /** Invite/remove members, change roles + these toggles. */
  canManageTeam: boolean
}

/** What each role gets before any per-user override. */
export const ROLE_DEFAULTS: Record<Role, Omit<Permissions, 'role'>> = {
  admin:   { canEdit: true,  canViewCosts: true,  canManageBilling: true,  canManageTeam: true },
  manager: { canEdit: true,  canViewCosts: true,  canManageBilling: false, canManageTeam: false },
  foreman: { canEdit: true,  canViewCosts: false, canManageBilling: false, canManageTeam: false },
  viewer:  { canEdit: false, canViewCosts: false, canManageBilling: false, canManageTeam: false },
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', manager: 'Manager', foreman: 'Foreman', viewer: 'Viewer',
}

export const ROLE_BLURB: Record<Role, string> = {
  admin: 'Everything — billing, team, settings',
  manager: 'Full operations + costs; no billing/team',
  foreman: 'Runs the day — no dollar figures',
  viewer: 'Read-only, no costs',
}

export interface ProfileOverrides {
  role?: string | null
  can_view_costs?: boolean | null
  can_manage_billing?: boolean | null
  can_manage_team?: boolean | null
}

/** Merge a profile row (role + nullable overrides) into a resolved set.
 *  NULL override = inherit role default. Admins always keep everything. */
export function resolvePermissions(p: ProfileOverrides | null | undefined, isOwner = false): Permissions {
  const role = (['admin', 'manager', 'foreman', 'viewer'].includes(p?.role ?? '') ? p!.role : isOwner ? 'admin' : 'viewer') as Role
  const d = ROLE_DEFAULTS[role]
  if (role === 'admin') return { role, ...d } // overrides can't demote an admin
  return {
    role,
    canEdit: d.canEdit,
    canViewCosts: p?.can_view_costs ?? d.canViewCosts,
    canManageBilling: p?.can_manage_billing ?? d.canManageBilling,
    canManageTeam: p?.can_manage_team ?? d.canManageTeam,
  }
}
