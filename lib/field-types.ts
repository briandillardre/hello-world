/**
 * Field-ops shared types + constants — client-safe (no server imports).
 * The server-side reads live in lib/db/fieldops.ts.
 */

export type ClockCategory = 'project' | 'shop' | 'overhead' | 'maintenance'

export interface TimeEntry {
  id: string
  user_id: string
  person_name: string
  category: ClockCategory
  project_geofence_id: string | null
  plan: string
  clock_in_at: string
  clock_out_at: string | null
}

export interface DailyLog {
  id: string
  user_id: string
  time_entry_id: string | null
  log_date: string
  writeup: string
  safety: string
  trucks_fueled: boolean | null
  equipment_fueled: boolean | null
  photos: { url: string; kind: 'photo' | 'receipt' }[]
  /** Custom-question answers, self-describing (migration 059). */
  answers?: { id: string; label: string; value: string | number | boolean | string[] }[]
  /** Where the phone was when the log was submitted (migration 059). */
  lat?: number | null
  lng?: number | null
  /** Present when the log arrived via the offline queue's replay (066). */
  idempotency_key?: string | null
  /** Required-photo rules were waived on an offline replay (067). */
  photos_waived?: boolean | null
  created_at: string
}

export interface EquipmentCheck {
  id: string
  asset_id: string
  user_id: string | null
  check_type: string
  note: string
  created_at: string
}

/** QR-tap touch-points and how stale each is allowed to get before it
 *  renders red ("DUE") on the machine page. */
export const CHECK_TYPES: { key: string; label: string; intervalDays: number }[] = [
  { key: 'greased', label: 'Greased', intervalDays: 7 },
  { key: 'fueled', label: 'Fueled', intervalDays: 2 },
  { key: 'radiator_blowout', label: 'Radiator blown out', intervalDays: 14 },
  { key: 'air_filter', label: 'Air filter blown out', intervalDays: 14 },
  { key: 'oil_check', label: 'Oil checked', intervalDays: 7 },
  { key: 'washed', label: 'Washed', intervalDays: 30 },
]
