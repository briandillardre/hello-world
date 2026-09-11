/**
 * Divisions — the PURE half (migration 106). Client components import this;
 * `lib/db/divisions.ts` is server-only (it reaches for supabase-server, which
 * imports next/headers and cannot be bundled into the browser).
 */

/** Does a row belong to the picked division? `null` = show everything;
 *  'none' = the unassigned pile. One rule, shared by every filtered surface,
 *  so the map and the lists can never disagree. */
export function inDivision(rowDivisionId: string | null | undefined, picked: string | null): boolean {
  if (!picked) return true
  if (picked === 'none') return !rowDivisionId
  return rowDivisionId === picked
}

/** The swatches the settings card offers and the pickers echo. */
export const DIVISION_SWATCHES = [
  '#2dd4bf', '#ff9e16', '#60a5fa', '#a78bfa', '#f472b6', '#34d399', '#ef4444', '#e8f0f7',
]
export const DIVISION_DEFAULT_COLOR = DIVISION_SWATCHES[0]
