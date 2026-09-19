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

/**
 * The same read, with the reason attached — for a cron that needs to say WHY
 * its memory came back empty (Sep 19: the founder feed repeated the silent
 * set at 3 PM, 4 PM and 4:05 PM although the rows were on disk; this is how
 * the next run tells "no row" from "read failed" from "wrong shape").
 */
export async function readStateDetailed(db: SupabaseClient, key: string): Promise<
  { status: 'ok'; value: unknown } | { status: 'none' } | { status: 'error'; error: string }
> {
  try {
    const { data, error } = await db.from('system_state').select('key, value').eq('key', key).limit(1)
    if (error) return { status: 'error', error: `${error.code ?? ''} ${error.message}`.trim() }
    const row = data?.[0]
    if (!row) return { status: 'none' }
    let value: unknown = row.value
    // A JSONB column comes back as an object; a stored string that parses as
    // JSON is read as that JSON rather than as a blob nobody can use.
    if (typeof value === 'string') { try { value = JSON.parse(value) } catch { /* keep the string */ } }
    return { status: 'ok', value }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
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
