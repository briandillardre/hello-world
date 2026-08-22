'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { getLiveConnection, findOrCreateCustomer } from '@/lib/qbo'
import { listQboEmployees, createTimeActivity, isoInTz, type QboEmployee } from '@/lib/qbo-time'

/**
 * QuickBooks timesheet actions — the payroll flow:
 *   getQboTimeStatusAction     — connection + crew ↔ QBO-employee mapping state
 *   saveEmployeeMappingAction  — pin one worker to one QBO employee
 *   pushQboDayAction           — a day's completed clock entries → TimeActivity
 * Same trust model as lib/actions/qbo.ts: reads/writes go through the caller's
 * RLS session; only lib/qbo touches the service client (token refresh).
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const NOT_CONNECTED = 'QuickBooks isn’t connected — connect it on the Accounting page (/accounting) first.'
const NO_PERMISSION = 'You need the Billing & QBO permission (Team page) to push timesheets.'

/** Migration 065 not applied yet (missing table) — PostgREST speaks in codes. */
function missingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|schema cache/i.test(error.message ?? ''))
}

const CATEGORY_LABEL: Record<string, string> = {
  project: 'Project', shop: 'Shop', overhead: 'Overhead', maintenance: 'Maintenance',
}

function dayKeyInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function safeTz(tz: string): string {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return 'America/New_York' }
}

// ── Status for the mapping card ──────────────────────────────────────────────

export interface QboTimeStatus {
  demo: boolean
  connected: boolean
  workers: { userId: string; name: string }[]
  employees: QboEmployee[]
  /** userId → QBO employee id */
  mappings: Record<string, string>
  error?: string
}

export async function getQboTimeStatusAction(): Promise<QboTimeStatus> {
  const empty: QboTimeStatus = { demo: false, connected: false, workers: [], employees: [], mappings: {} }
  if (isMock) return { ...empty, demo: true }
  try {
    if (!(await getMyPermissions()).canManageBilling) return { ...empty, error: NO_PERMISSION }
    const companyId = await getCurrentCompanyId()

    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const [{ data: profiles }, mapRes, conn] = await Promise.all([
      supabase.from('profiles').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('qbo_employee_map').select('user_id, qbo_employee_id').eq('company_id', companyId),
      getLiveConnection(companyId),
    ])
    if (missingTable(mapRes.error)) {
      return { ...empty, connected: !!conn, error: 'Timesheet tables aren’t set up yet — deploy the latest build (migration 065 runs automatically).' }
    }

    const workers = (profiles ?? []).map((p) => ({ userId: p.id as string, name: (p.name as string) || 'Crew member' }))
    const mappings: Record<string, string> = {}
    for (const m of mapRes.data ?? []) mappings[m.user_id as string] = m.qbo_employee_id as string

    if (!conn) return { ...empty, workers, mappings }

    let employees: QboEmployee[] = []
    try {
      employees = await listQboEmployees(conn)
    } catch (e) {
      return {
        ...empty, connected: true, workers, mappings,
        error: e instanceof Error ? `Couldn’t read employees from QuickBooks: ${e.message}` : 'Couldn’t read employees from QuickBooks.',
      }
    }
    return { demo: false, connected: true, workers, employees, mappings }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : 'Status check failed.' }
  }
}

// ── Mapping save ─────────────────────────────────────────────────────────────

export async function saveEmployeeMappingAction(
  userId: string,
  qboEmployeeId: string | null,
  qboEmployeeName = ''
): Promise<{ ok: true } | { error: string }> {
  if (isMock) return { error: 'Demo mode — connect Supabase + QuickBooks first.' }
  try {
    if (!(await getMyPermissions()).canManageBilling) return { error: NO_PERMISSION }
    const companyId = await getCurrentCompanyId()
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()

    const { error } = qboEmployeeId
      ? await supabase.from('qbo_employee_map').upsert({
          company_id: companyId,
          user_id: userId,
          qbo_employee_id: qboEmployeeId,
          qbo_employee_name: qboEmployeeName.slice(0, 200),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id,user_id' })
      : await supabase.from('qbo_employee_map').delete()
          .eq('company_id', companyId).eq('user_id', userId)
    if (missingTable(error)) return { error: 'Timesheet tables aren’t set up yet — deploy the latest build (migration 065 runs automatically).' }
    if (error) return { error: error.message }
    revalidatePath('/accounting')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Save failed.' }
  }
}

// ── The push: one day's completed entries → TimeActivity rows ────────────────

export interface PushDayResult {
  ok: true
  pushed: number
  skipped: number
  failed: { person: string; error: string }[]
  /** Entry ids now recorded as pushed (for optimistic UI). */
  pushedEntryIds: string[]
}

export async function pushQboDayAction(
  dayKey: string,
  tz: string
): Promise<PushDayResult | { error: string }> {
  if (isMock) return { error: 'Demo mode — sign in on the live app to push timesheets.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return { error: 'Bad date.' }
  const zone = safeTz(tz)
  try {
    if (!(await getMyPermissions()).canManageBilling) return { error: NO_PERMISSION }
    const companyId = await getCurrentCompanyId()
    const conn = await getLiveConnection(companyId)
    if (!conn) return { error: NOT_CONNECTED }

    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()

    // The day's COMPLETED entries. Window is ±1 day around the key, then
    // filtered by the day the clock-in falls on in the company's timezone —
    // same grouping the /logs feed shows, so what you approve is what posts.
    const windowFrom = new Date(new Date(`${dayKey}T00:00:00Z`).getTime() - 86_400_000).toISOString()
    const windowTo = new Date(new Date(`${dayKey}T00:00:00Z`).getTime() + 2 * 86_400_000).toISOString()
    const { data: allEntries, error: entriesErr } = await supabase
      .from('time_entries')
      .select('id, user_id, person_name, category, project_geofence_id, clock_in_at, clock_out_at')
      .eq('company_id', companyId)
      .gte('clock_in_at', windowFrom)
      .lt('clock_in_at', windowTo)
      .not('clock_out_at', 'is', null)
      .order('clock_in_at', { ascending: true })
      .limit(2000)
    if (entriesErr) return { error: entriesErr.message }
    const entries = (allEntries ?? []).filter((e) => dayKeyInTz(e.clock_in_at as string, zone) === dayKey)
    if (!entries.length) return { ok: true, pushed: 0, skipped: 0, failed: [], pushedEntryIds: [] }

    const entryIds = entries.map((e) => e.id as string)
    const zoneIds = Array.from(new Set(entries.map((e) => e.project_geofence_id as string | null).filter((z): z is string => !!z)))
    const [mapRes, pushRes, fenceRes] = await Promise.all([
      supabase.from('qbo_employee_map').select('user_id, qbo_employee_id').eq('company_id', companyId),
      supabase.from('qbo_time_pushes').select('time_entry_id, status')
        .eq('company_id', companyId).in('time_entry_id', entryIds),
      zoneIds.length
        ? supabase.from('geofences').select('id, name, qbo_customer_id').in('id', zoneIds)
        : Promise.resolve({ data: [], error: null } as { data: { id: string; name: string; qbo_customer_id: string | null }[]; error: null }),
    ])
    if (missingTable(mapRes.error) || missingTable(pushRes.error)) {
      return { error: 'Timesheet tables aren’t set up yet — deploy the latest build (migration 065 runs automatically).' }
    }
    const employeeOf: Record<string, string> = {}
    for (const m of mapRes.data ?? []) employeeOf[m.user_id as string] = m.qbo_employee_id as string
    const pushStateOf: Record<string, string> = {}
    for (const p of pushRes.data ?? []) pushStateOf[p.time_entry_id as string] = p.status as string
    const fences = new Map((fenceRes.data ?? []).map((f) => [f.id as string, f as { id: string; name: string; qbo_customer_id: string | null }]))

    // Zone → QBO customer, resolved once per zone (reuses the invoice flow's
    // geofences.qbo_customer_id and back-fills it via find-or-create).
    const customerOf = new Map<string, string | null>()
    const resolveCustomer = async (fenceId: string): Promise<string | null> => {
      if (customerOf.has(fenceId)) return customerOf.get(fenceId) ?? null
      const fence = fences.get(fenceId)
      let custId = fence?.qbo_customer_id ?? null
      if (!custId && fence) {
        try {
          custId = await findOrCreateCustomer(conn!, fence.name)
          await supabase.from('geofences').update({ qbo_customer_id: custId }).eq('id', fenceId)
        } catch { custId = null } // job costing degrades; the hours still post
      }
      customerOf.set(fenceId, custId)
      return custId
    }

    let pushed = 0
    let skipped = 0
    const failed: { person: string; error: string }[] = []
    const pushedEntryIds: string[] = []

    for (const e of entries) {
      const entryId = e.id as string
      const person = (e.person_name as string) || 'Crew member'
      const already = pushStateOf[entryId]
      if (already === 'pushed') { skipped++; continue }

      const qboEmployeeId = employeeOf[e.user_id as string]
      if (!qboEmployeeId) {
        failed.push({ person, error: 'No QuickBooks employee mapped — map them on the Accounting page.' })
        continue
      }

      const hours = Math.round(Math.max(0,
        (new Date(e.clock_out_at as string).getTime() - new Date(e.clock_in_at as string).getTime()) / 3_600_000
      ) * 100) / 100

      // Claim the entry BEFORE calling QBO — the UNIQUE(time_entry_id) row is
      // the idempotency lock: a concurrent push loses the insert and skips.
      if (already === 'error') {
        const { data: claimed } = await supabase.from('qbo_time_pushes')
          .update({ status: 'pending', error: null, hours, pushed_at: new Date().toISOString() })
          .eq('company_id', companyId).eq('time_entry_id', entryId).eq('status', 'error').select('id')
        if (!claimed?.length) { skipped++; continue }
      } else if (already === 'pending') {
        // A crash mid-push strands rows as 'pending' forever (ship-check P1):
        // re-claim ONLY when the claim is stale (>10 min old — pushed_at is
        // stamped at claim time). A live concurrent push keeps its claim.
        const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString()
        const { data: claimed } = await supabase.from('qbo_time_pushes')
          .update({ error: null, hours, pushed_at: new Date().toISOString() })
          .eq('company_id', companyId).eq('time_entry_id', entryId).eq('status', 'pending').lt('pushed_at', staleBefore)
          .select('id')
        if (!claimed?.length) { skipped++; continue }
      } else {
        const { error: claimErr } = await supabase.from('qbo_time_pushes')
          .insert({ company_id: companyId, time_entry_id: entryId, hours, status: 'pending' })
        if (claimErr?.code === '23505') { skipped++; continue }
        if (missingTable(claimErr)) return { error: 'Timesheet tables aren’t set up yet — deploy the latest build (migration 065 runs automatically).' }
        if (claimErr) { failed.push({ person, error: claimErr.message }); continue }
      }

      const fence = e.project_geofence_id ? fences.get(e.project_geofence_id as string) : undefined
      const description = fence
        ? `${fence.name} — GPS-verified by HammerTrack`
        : `${CATEGORY_LABEL[e.category as string] ?? 'Time'} — logged by HammerTrack`
      try {
        const qboCustomerId = e.project_geofence_id
          ? await resolveCustomer(e.project_geofence_id as string)
          : null
        const created = await createTimeActivity(conn, {
          qboEmployeeId,
          dateIso: dayKey,
          startIso: isoInTz(e.clock_in_at as string, zone),
          endIso: isoInTz(e.clock_out_at as string, zone),
          hours,
          qboCustomerId,
          description,
        })
        await supabase.from('qbo_time_pushes').update({
          qbo_timeactivity_id: created.id,
          status: 'pushed',
          error: null,
          pushed_at: new Date().toISOString(),
        }).eq('company_id', companyId).eq('time_entry_id', entryId)
        pushed++
        pushedEntryIds.push(entryId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'QuickBooks rejected this entry.'
        await supabase.from('qbo_time_pushes')
          .update({ status: 'error', error: msg.slice(0, 2000) })
          .eq('company_id', companyId).eq('time_entry_id', entryId)
        failed.push({ person, error: msg })
      }
    }

    revalidatePath('/logs')
    return { ok: true, pushed, skipped, failed, pushedEntryIds }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Timesheet push failed.' }
  }
}
