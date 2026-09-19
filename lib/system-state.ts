import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Platform-level memory for crons (migration 112: `system_state`, service
 * role only). A lambda forgets everything between runs; this is where a cron
 * keeps the little it needs to tell "still broken" from "newly broken".
 *
 * `readState` returns `undefined` when the table itself is unavailable (a
 * pre-112 database, a network error) and `null` when the key simply has no
 * row yet — callers can tell "no memory" from "no state".
 */
export async function readState<T>(db: SupabaseClient, key: string): Promise<T | null | undefined> {
  try {
    const { data, error } = await db.from('system_state').select('value').eq('key', key).maybeSingle()
    if (error) return undefined
    return data ? (data.value as T) : null
  } catch {
    return undefined
  }
}

export async function writeState(db: SupabaseClient, key: string, value: unknown): Promise<boolean> {
  try {
    const { error } = await db
      .from('system_state')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return !error
  } catch {
    return false
  }
}
