'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { upsertDevice, setDeviceStep, deleteDevice } from '@/lib/db/devices'
import { imeiLooksValid, MODELS, type DeviceModel } from '@/lib/devices'

export interface AddDeviceInput {
  imei: string
  model: DeviceModel
  label?: string
  iccid?: string
  notes?: string
}

export async function addDeviceAction(input: AddDeviceInput): Promise<{ ok: boolean; error?: string }> {
  const imei = input.imei.replace(/\D/g, '')
  // Validate server-side too — the client check is a convenience, not a gate,
  // and a mistyped IMEI here produces a device that looks broken forever.
  const check = imeiLooksValid(imei)
  if (!check.ok) return { ok: false, error: check.reason }
  if (!MODELS[input.model]) return { ok: false, error: 'Pick a device model.' }

  const companyId = await getCurrentCompanyId()
  const res = await upsertDevice(companyId, {
    imei,
    model: input.model,
    label: input.label?.trim() || null,
    iccid: input.iccid?.replace(/\s/g, '') || null,
    notes: input.notes?.trim() || null,
  })
  if (!res.ok) return res

  revalidatePath('/assets/onboard')
  return { ok: true }
}

export async function setDeviceStepAction(imei: string, stepKey: string, done: boolean) {
  const companyId = await getCurrentCompanyId()
  const res = await setDeviceStep(companyId, imei, stepKey, done)
  revalidatePath('/assets/onboard')
  return res
}

export async function deleteDeviceAction(imei: string) {
  const companyId = await getCurrentCompanyId()
  await deleteDevice(companyId, imei)
  revalidatePath('/assets/onboard')
}
