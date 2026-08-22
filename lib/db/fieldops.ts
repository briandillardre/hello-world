/**
 * Field ops reads — time clock, daily logs, QR equipment checks.
 * All server-side, RLS-scoped through the caller's session. Every helper
 * returns empty/null in demo mode or before migration 015, so the pages
 * render an explanatory shell instead of crashing.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export type { ClockCategory, TimeEntry, DailyLog, EquipmentCheck } from '../field-types'
export { CHECK_TYPES } from '../field-types'
import type { TimeEntry, DailyLog, EquipmentCheck } from '../field-types'

/** The caller's open (not clocked out) entry, plus their display name. */
export async function getMyClockState(): Promise<{
  userId: string | null
  personName: string
  openEntry: TimeEntry | null
  available: boolean
}> {
  const empty = { userId: null, personName: '', openEntry: null, available: false }
  if (isMock) return empty
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return empty
    const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).single()
    const personName = profile?.name || user.email || 'Crew'
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', user.id)
      .is('clock_out_at', null)
      .order('clock_in_at', { ascending: false })
      .limit(1)
    // Table missing (migration 015 not run) → clock UI shows setup note.
    if (error) return { userId: user.id, personName, openEntry: null, available: false }
    return { userId: user.id, personName, openEntry: (data?.[0] as TimeEntry) ?? null, available: true }
  } catch {
    return empty
  }
}

/** The company's daily-log form config (raw jsonb; resolveLogForm() it).
 *  Null in demo mode, pre-059, or when the admin never customized. */
export async function getLogFormRaw(companyId: string): Promise<unknown> {
  if (isMock) return null
  try {
    const { createClient } = await import('../supabase-server')
    const { data } = await createClient().from('companies').select('log_form').eq('id', companyId).single()
    return data?.log_form ?? null
  } catch {
    return null
  }
}

/** Recent entries + logs for the office view, newest day first. */
export async function getRecentFieldDays(companyId: string, days = 7): Promise<{
  entries: TimeEntry[]
  logs: DailyLog[]
  available: boolean
}> {
  if (isMock) return { entries: [], logs: [], available: false }
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()
    const [e, l] = await Promise.all([
      supabase.from('time_entries').select('*').eq('company_id', companyId)
        .gte('clock_in_at', sinceIso).order('clock_in_at', { ascending: false }).limit(500),
      supabase.from('daily_logs').select('*').eq('company_id', companyId)
        .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(500),
    ])
    if (e.error || l.error) return { entries: [], logs: [], available: false }
    return {
      entries: (e.data ?? []) as TimeEntry[],
      logs: ((l.data ?? []) as DailyLog[]).map((r) => ({ ...r, photos: Array.isArray(r.photos) ? r.photos : [] })),
      available: true,
    }
  } catch {
    return { entries: [], logs: [], available: false }
  }
}

/** Time-entry ids already pushed to QuickBooks as TimeActivity rows (065),
 *  for the per-day pushed/total badge on /logs. Empty in demo mode, before
 *  migration 065, or on any error — the push button still works either way. */
export async function getQboPushedEntryIds(companyId: string): Promise<string[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('qbo_time_pushes')
      .select('time_entry_id')
      .eq('company_id', companyId)
      .eq('status', 'pushed')
      .order('pushed_at', { ascending: false })
      .limit(2000)
    if (error) return []
    return (data ?? []).map((r) => r.time_entry_id as string)
  } catch {
    return []
  }
}

/** Asset + its recent checks for the QR page. Slug is unique per asset. */
export async function getAssetByQrSlug(slug: string): Promise<{
  asset: { id: string; name: string; type: string } | null
  checks: EquipmentCheck[]
}> {
  if (isMock || !slug) return { asset: null, checks: [] }
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: asset } = await supabase
      .from('assets')
      .select('id, name, type')
      .eq('qr_slug', slug)
      .single()
    if (!asset) return { asset: null, checks: [] }
    const { data: checks } = await supabase
      .from('equipment_checks')
      .select('*')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(60)
    return { asset, checks: (checks ?? []) as EquipmentCheck[] }
  } catch {
    return { asset: null, checks: [] }
  }
}

/** Equipment + vehicles with slugs, for the printable sticker sheet. */
export async function getQrAssets(companyId: string): Promise<{ id: string; name: string; type: string; qr_slug: string | null }[]> {
  if (isMock) return []
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data } = await supabase
      .from('assets')
      .select('id, name, type, qr_slug')
      .eq('company_id', companyId)
      .in('type', ['equipment', 'vehicle'])
      .order('name')
    return (data ?? []) as { id: string; name: string; type: string; qr_slug: string | null }[]
  } catch {
    return []
  }
}
