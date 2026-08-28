'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { upsertDevice, setDeviceStep, deleteDevice } from '@/lib/db/devices'
import { imeiLooksValid, MODELS, modelFromImei, type DeviceModel } from '@/lib/devices'
import { createAsset } from '@/lib/db/assets'

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

/**
 * Add a whole shipment at once from the packing slip. Fifteen digits typed
 * fourteen times is the single most error-prone part of a rollout, and a
 * mistyped Tracker ID produces a device that connects perfectly and never
 * appears — indistinguishable from dead hardware.
 *
 * Accepts anything paste-shaped: newlines, commas, spaces, or an IMEI column
 * copied out of a spreadsheet. Each IMEI picks its own model from its TAC, so
 * a mixed shipment sorts itself; `fallbackModel` covers unknown prefixes.
 * Invalid entries are REPORTED, never silently dropped — a quietly skipped
 * device is exactly the kind of hole this page exists to close.
 */
export async function addDevicesBulkAction(
  text: string,
  fallbackModel: DeviceModel,
): Promise<{ ok: boolean; added: number; skipped: { value: string; reason: string }[]; error?: string }> {
  const tokens = text.split(/[^0-9]+/).map((t) => t.trim()).filter(Boolean)
  if (!tokens.length) return { ok: false, added: 0, skipped: [], error: 'Nothing to add — paste a list of IMEIs.' }
  if (tokens.length > 200) return { ok: false, added: 0, skipped: [], error: 'That is more than 200 entries. Add them in smaller batches.' }

  const companyId = await getCurrentCompanyId()
  const skipped: { value: string; reason: string }[] = []
  const seen = new Set<string>()
  let added = 0

  for (const token of tokens) {
    if (seen.has(token)) continue           // the same IMEI twice in one paste
    seen.add(token)
    const check = imeiLooksValid(token)
    if (!check.ok) { skipped.push({ value: token, reason: check.reason ?? 'not a valid IMEI' }); continue }
    const res = await upsertDevice(companyId, { imei: token, model: modelFromImei(token) ?? fallbackModel })
    if (res.ok) added++
    else skipped.push({ value: token, reason: res.error ?? 'could not save' })
  }

  revalidatePath('/assets/onboard')
  return { ok: added > 0, added, skipped }
}

/**
 * Create the HammerTrack asset for a device without leaving this page.
 *
 * Registering the asset is a genuine prerequisite, not paperwork: the ingest
 * resolves an incoming report by tracker_id, so a device that reaches us
 * before its asset exists has its readings dropped on the floor. Doing it
 * here — with the IMEI carried over rather than retyped — is what lets the
 * "Registered in HammerTrack" stage tick itself.
 */
export async function registerDeviceAssetAction(
  imei: string,
  name: string,
  type: 'vehicle' | 'equipment' | 'tool',
): Promise<{ ok: boolean; assetId?: string; error?: string }> {
  const clean = imei.replace(/\D/g, '')
  if (!imeiLooksValid(clean).ok) return { ok: false, error: 'That IMEI does not look right.' }
  const label = name.trim()
  if (!label) return { ok: false, error: 'Give the asset a name — the truck or machine it is going on.' }

  const companyId = await getCurrentCompanyId()
  const { asset, error } = await createAsset(companyId, {
    name: label,
    type,
    tracker_id: clean,
    metadata: { source: 'onboarding' },
  })

  if (error) {
    // 23505 is the one a user can actually act on: migration 082 allows only
    // one ACTIVE owner per 15-digit IMEI platform-wide, so this means the
    // device is already registered — here or on a deactivated asset.
    if (error.code === '23505') {
      return { ok: false, error: 'That IMEI is already on another asset. Search your Assets list for it — it may be on an inactive one.' }
    }
    console.error('onboarding asset create failed:', error.message)
    return { ok: false, error: 'Could not create that asset. Try again from the Assets page.' }
  }

  revalidatePath('/assets/onboard')
  revalidatePath('/assets')
  revalidatePath('/map')
  return { ok: true, assetId: asset?.id }
}
