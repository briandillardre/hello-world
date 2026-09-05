'use server'

import { requireEditOrThrow } from '@/lib/permissions-server'
import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { upsertDevice, upsertDevices, setDeviceStep, deleteDevice } from '@/lib/db/devices'
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
  await requireEditOrThrow()
  if (!MODELS[input.model]) return { ok: false, error: 'Pick a device model.' }

  // A BLE beacon has no IMEI — its identity is a hex tag id. Holding it to the
  // 15-digit Luhn check made all ten Eye Beacons in the KORE order impossible
  // to add, and took their gotchas (Eddystone → iBeacon, unique Minor, mark
  // the tag) offline with them (ship-check, Aug 28 — P1).
  const identifier = input.model === 'EYE_BEACON'
    ? input.imei.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
    : input.imei.replace(/\D/g, '')

  if (input.model === 'EYE_BEACON') {
    if (identifier.length < 4 || identifier.length > 32) {
      return { ok: false, error: 'Enter the tag’s Minor or its MAC — 4 to 32 hex characters.' }
    }
  } else {
    // Validate server-side too — the client check is a convenience, not a gate,
    // and a mistyped IMEI here produces a device that looks broken forever.
    const check = imeiLooksValid(identifier)
    if (!check.ok) return { ok: false, error: check.reason }
  }

  const companyId = await getCurrentCompanyId()
  // Cap the free-text columns. They are bare TEXT, and nothing else bounds
  // them (sec-check, Aug 28).
  const res = await upsertDevice(companyId, {
    imei: identifier,
    model: input.model,
    label: input.label?.trim().slice(0, 120) || null,
    iccid: input.iccid?.replace(/\s/g, '').slice(0, 22) || null,
    notes: input.notes?.trim().slice(0, 2000) || null,
  })
  if (!res.ok) return res

  revalidatePath('/assets/onboard')
  return { ok: true }
}

export async function setDeviceStepAction(imei: string, stepKey: string, done: boolean) {
  await requireEditOrThrow()
  const companyId = await getCurrentCompanyId()
  const res = await setDeviceStep(companyId, imei, stepKey, done)
  revalidatePath('/assets/onboard')
  return res
}

export async function deleteDeviceAction(imei: string): Promise<{ ok: boolean; error?: string }> {
  await requireEditOrThrow()
  const companyId = await getCurrentCompanyId()
  const res = await deleteDevice(companyId, imei)
  revalidatePath('/assets/onboard')
  return res
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
  await requireEditOrThrow()
  // Only IMEI-SHAPED runs. Splitting on every non-digit turned a real
  // spreadsheet paste into noise: ICCIDs, dates and the "00" out of FMM00A all
  // became "entries", blowing the cap on a 40-row shipment and burying the
  // real result under a skipped list longer than the added one. A 14–16 digit
  // window still catches genuine typos, which is what the report is for
  // (ship-check, Aug 28).
  const tokens = text.match(/(?<!\d)\d{14,16}(?!\d)/g) ?? []
  if (!tokens.length) return { ok: false, added: 0, skipped: [], error: 'No IMEIs found in that text. They are 15 digits each.' }
  if (tokens.length > 200) return { ok: false, added: 0, skipped: [], error: `That is ${tokens.length} IMEIs. Add them in batches of 200 or fewer.` }

  const skipped: { value: string; reason: string }[] = []
  const seen = new Set<string>()
  const valid: { imei: string; model: DeviceModel }[] = []

  for (const token of tokens) {
    if (seen.has(token)) continue           // the same IMEI twice in one paste
    seen.add(token)
    const check = imeiLooksValid(token)
    if (!check.ok) { skipped.push({ value: token, reason: check.reason ?? 'not a valid IMEI' }); continue }
    valid.push({ imei: token, model: modelFromImei(token) ?? fallbackModel })
  }

  if (!valid.length) return { ok: false, added: 0, skipped, error: 'None of those were valid IMEIs.' }

  const companyId = await getCurrentCompanyId()
  const res = await upsertDevices(companyId, valid)
  if (!res.ok) return { ok: false, added: 0, skipped, error: res.error }

  revalidatePath('/assets/onboard')
  return { ok: true, added: valid.length, skipped }
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
  await requireEditOrThrow()
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
    // 23505 is the one a user can actually act on. Migration 084 allows only
    // one ACTIVE owner per 15-digit IMEI platform-wide, so this means the
    // device is already registered — in this company or another one. Without
    // that index this action would let anyone claim a live IMEI and silently
    // kill the real fleet's telemetry, so the two ship together.
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
