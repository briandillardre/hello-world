import { qboFetch, qboQuery, type LiveConnection } from './qbo'

/**
 * QuickBooks TimeActivity — HammerTrack clock-ins/outs become QBO timesheet
 * rows (employee, date, hours, CustomerRef = the job-site zone) so payroll
 * and job costing run off GPS-verified hours.
 *
 * Uses the EXISTING QBO connection + token refresh from lib/qbo.ts — this is
 * the accounting API's TimeActivity entity, NOT QuickBooks Time. Server-side
 * only (goes through the authed fetch, tokens never reach the client).
 */

export interface QboEmployee {
  id: string
  name: string
}

/** Active employees in the connected QBO company, for the mapping card. */
export async function listQboEmployees(conn: LiveConnection): Promise<QboEmployee[]> {
  const resp = await qboQuery(
    conn,
    'select Id, DisplayName from Employee where Active = true maxresults 1000'
  )
  const qr = resp.QueryResponse as
    | { Employee?: { Id: string; DisplayName?: string }[] }
    | undefined
  return (qr?.Employee ?? [])
    .map((e) => ({ id: e.Id, name: e.DisplayName ?? `Employee ${e.Id}` }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface TimeActivityInput {
  qboEmployeeId: string
  /** Work date (YYYY-MM-DD, already in the company's timezone). */
  dateIso: string
  /** Clock in/out — preferred when both exist (QBO shows real start/end). */
  startIso?: string | null
  endIso?: string | null
  /** Decimal-hours fallback when the entry lacks a start/end pair. */
  hours?: number | null
  /** QBO customer (the job/zone) for job costing; omit for shop/overhead. */
  qboCustomerId?: string | null
  description: string
}

/**
 * Create one TimeActivity row. QBO wants EITHER StartTime+EndTime OR
 * Hours+Minutes — never both — so the entry's shape decides.
 */
export async function createTimeActivity(
  conn: LiveConnection,
  input: TimeActivityInput
): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    NameOf: 'Employee',
    EmployeeRef: { value: input.qboEmployeeId },
    TxnDate: input.dateIso.slice(0, 10),
    Description: input.description.slice(0, 4000),
    ...(input.qboCustomerId ? { CustomerRef: { value: input.qboCustomerId } } : {}),
  }
  if (input.startIso && input.endIso) {
    body.StartTime = input.startIso
    body.EndTime = input.endIso
  } else {
    const h = Math.max(0, input.hours ?? 0)
    let hours = Math.floor(h)
    let minutes = Math.round((h - hours) * 60)
    if (minutes === 60) { hours += 1; minutes = 0 }
    body.Hours = hours
    body.Minutes = minutes
  }
  const created = await qboFetch(conn, '/timeactivity', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return { id: (created.TimeActivity as { Id: string }).Id }
}

/**
 * A UTC instant rendered as an ISO-8601 local datetime WITH OFFSET in the
 * given IANA timezone (e.g. 2026-08-21T07:02:00-04:00) — the format QBO's
 * StartTime/EndTime expect, so the books show wall-clock times the foreman
 * recognizes instead of UTC.
 */
export function isoInTz(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(new Date(iso))
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  // "GMT-04:00" → "-04:00"; plain "GMT" (UTC) → "+00:00".
  const offset = (p.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00'
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`
}
