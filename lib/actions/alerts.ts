'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { acknowledgeAlert, acknowledgeAllAlerts, createAlertRule, updateAlertRule, deleteAlertRule, bulkSetZoneRules } from '@/lib/db/alerts'
import type { AlertRuleParams, AlertTrigger } from '@/lib/types'

export async function acknowledgeAlertAction(id: string) {
  await acknowledgeAlert(id)
  revalidatePath('/alerts')
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
}) {
  const companyId = await getCurrentCompanyId()
  await createAlertRule(companyId, input)
  revalidatePath('/alerts')
}

export async function toggleAlertRuleAction(id: string, active: boolean) {
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
  await updateAlertRule(id, patch)
  revalidatePath('/alerts')
}

/** The matrix's bulk lever: one trigger across many zones, on or off. */
export async function bulkZoneRulesAction(zoneIds: string[], trigger: AlertTrigger, enable: boolean) {
  const companyId = await getCurrentCompanyId()
  await bulkSetZoneRules(companyId, zoneIds, trigger, enable)
  revalidatePath('/alerts')
}

export async function deleteAlertRuleAction(id: string) {
  await deleteAlertRule(id)
  revalidatePath('/alerts')
}
