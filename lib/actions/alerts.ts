'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { acknowledgeAlert, createAlertRule, updateAlertRule, deleteAlertRule } from '@/lib/db/alerts'
import type { AlertTrigger } from '@/lib/types'

export async function acknowledgeAlertAction(id: string) {
  await acknowledgeAlert(id)
  revalidatePath('/alerts')
}

export async function createAlertRuleAction(input: {
  geofence_id: string
  asset_id: string | null
  trigger: AlertTrigger
  idle_minutes: number | null
}) {
  const companyId = await getCurrentCompanyId()
  await createAlertRule(companyId, input)
  revalidatePath('/alerts')
}

export async function toggleAlertRuleAction(id: string, active: boolean) {
  await updateAlertRule(id, { active })
  revalidatePath('/alerts')
}

export async function deleteAlertRuleAction(id: string) {
  await deleteAlertRule(id)
  revalidatePath('/alerts')
}
