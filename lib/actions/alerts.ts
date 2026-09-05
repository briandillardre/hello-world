'use server'

import { requireEditOrThrow } from '@/lib/permissions-server'
import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { acknowledgeAlert, acknowledgeAlerts, acknowledgeAllAlerts, createAlertRule, updateAlertRule, deleteAlertRule, bulkSetZoneRules } from '@/lib/db/alerts'
import type { AlertRule, AlertRuleParams, AlertTrigger } from '@/lib/types'

export async function acknowledgeAlertAction(id: string): Promise<{ ok: boolean }> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false }
  try {
    await acknowledgeAlert(id)
  } catch {
    return { ok: false }
  }
  revalidatePath('/alerts')
  return { ok: true }
}

/** Ack a SPECIFIC visible set — replaces blanket ack-all in the UI so
 *  critical theft rows can never ride along unseen (Aug 22 rebuild). */
export async function acknowledgeManyAlertsAction(ids: string[]): Promise<{ ok: boolean }> {
  // Strict UUIDs only — one malformed id used to fail the whole .in()
  // UPDATE silently while the UI painted everything acked (sec-check P2).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const clean = (Array.isArray(ids) ? ids : []).filter((v): v is string => typeof v === 'string' && UUID.test(v)).slice(0, 500)
  try {
    await acknowledgeAlerts(clean)
  } catch {
    return { ok: false }
  }
  revalidatePath('/alerts')
  return { ok: true }
}

export async function acknowledgeAllAlertsAction() {
  const companyId = await getCurrentCompanyId()
  await acknowledgeAllAlerts(companyId)
  revalidatePath('/alerts')
}

export async function createAlertRuleAction(input: {
  geofence_id: string
  asset_id: string | null
  trigger: AlertTrigger
  idle_minutes: number | null
  params?: AlertRuleParams | null
}): Promise<AlertRule | null> {
  await requireEditOrThrow()
  const companyId = await getCurrentCompanyId()
  // null = demo mode or insert failure — the form uses this to avoid closing
  // as if the rule saved.
  const rule = await createAlertRule(companyId, input)
  revalidatePath('/alerts')
  return rule
}

export async function toggleAlertRuleAction(id: string, active: boolean) {
  await requireEditOrThrow()
  await updateAlertRule(id, { active })
  revalidatePath('/alerts')
}

/** Edit a rule's tuning in place (idle minutes, speed limit, watch window…). */
export async function updateAlertRuleAction(id: string, patch: {
  idle_minutes?: number | null
  params?: AlertRuleParams | null
  asset_id?: string | null
  active?: boolean
}) {
  await requireEditOrThrow()
  await updateAlertRule(id, patch)
  revalidatePath('/alerts')
}

/** The matrix's bulk lever: one trigger across many zones, on or off. */
export async function bulkZoneRulesAction(zoneIds: string[], trigger: AlertTrigger, enable: boolean) {
  await requireEditOrThrow()
  const companyId = await getCurrentCompanyId()
  await bulkSetZoneRules(companyId, zoneIds, trigger, enable)
  revalidatePath('/alerts')
}

export async function deleteAlertRuleAction(id: string) {
  await requireEditOrThrow()
  await deleteAlertRule(id)
  revalidatePath('/alerts')
}
