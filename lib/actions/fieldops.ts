'use server'

import { revalidatePath } from 'next/cache'
import type { ClockCategory } from '@/lib/field-types'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

async function requireUser() {
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: profile } = await supabase.from('profiles').select('company_id, name').eq('id', user.id).single()
  return {
    supabase,
    userId: user.id,
    companyId: profile?.company_id ?? user.id,
    personName: profile?.name || user.email || 'Crew',
  }
}

export async function clockInAction(input: {
  category: ClockCategory
  projectGeofenceId?: string | null
  plan?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in on the live app to clock in.' }
  try {
    const { supabase, userId, companyId, personName } = await requireUser()
    // One open entry per person — idempotent against double taps.
    const { data: open } = await supabase
      .from('time_entries').select('id').eq('user_id', userId).is('clock_out_at', null).limit(1)
    if (open?.length) return { ok: true }
    const { error } = await supabase.from('time_entries').insert({
      company_id: companyId,
      user_id: userId,
      person_name: personName,
      category: input.category,
      project_geofence_id: input.category === 'project' ? (input.projectGeofenceId ?? null) : null,
      plan: (input.plan ?? '').slice(0, 500),
    })
    if (error) return { ok: false, error: error.message }
    revalidatePath('/clock')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Clock-in failed' }
  }
}

/** Upload one log photo to the public field-photos bucket (service client —
 *  the bucket has no client write policies). Never throws. */
async function uploadFieldPhoto(companyId: string, file: File): Promise<string | null> {
  if (!file.size || !file.type.startsWith('image/')) return null
  if (file.size > 6 * 1024 * 1024) return null
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const supabase = createServiceClient()
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${companyId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage
      .from('field-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (error) {
      console.error('Field photo upload failed', error)
      return null
    }
    return supabase.storage.from('field-photos').getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.error('Field photo upload failed', err)
    return null
  }
}

/**
 * The toll gate: writes the daily log AND closes the open time entry in one
 * action, so there is no clock-out path that skips the log.
 * FormData fields: writeup (required), safety, trucksFueled, equipmentFueled,
 * photos (files), receipts (files).
 */
export async function clockOutAction(form: FormData): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in on the live app to clock out.' }
  try {
    const { supabase, userId, companyId, personName } = await requireUser()
    const writeup = String(form.get('writeup') ?? '').trim().slice(0, 4000)
    if (writeup.length < 10) return { ok: false, error: 'Write up the day first — a couple of sentences minimum.' }

    const { data: open } = await supabase
      .from('time_entries').select('id').eq('user_id', userId).is('clock_out_at', null)
      .order('clock_in_at', { ascending: false }).limit(1)
    const entryId = open?.[0]?.id as string | undefined
    if (!entryId) return { ok: false, error: "You aren't clocked in." }

    const photos: { url: string; kind: 'photo' | 'receipt' }[] = []
    for (const kind of ['photos', 'receipts'] as const) {
      for (const f of form.getAll(kind)) {
        if (!(f instanceof File)) continue
        const url = await uploadFieldPhoto(companyId, f)
        if (url) photos.push({ url, kind: kind === 'receipts' ? 'receipt' : 'photo' })
      }
    }

    const safety = String(form.get('safety') ?? '').trim().slice(0, 2000)

    const { error: logErr } = await supabase.from('daily_logs').insert({
      company_id: companyId,
      user_id: userId,
      time_entry_id: entryId,
      writeup,
      safety,
      trucks_fueled: form.get('trucksFueled') === null ? null : form.get('trucksFueled') === 'yes',
      equipment_fueled: form.get('equipmentFueled') === null ? null : form.get('equipmentFueled') === 'yes',
      photos,
    })
    if (logErr) return { ok: false, error: logErr.message }

    const { error: outErr } = await supabase
      .from('time_entries')
      .update({ clock_out_at: new Date().toISOString() })
      .eq('id', entryId)
      .eq('user_id', userId)
    if (outErr) return { ok: false, error: outErr.message }

    // Safety triage (stage 3 of the AI ladder): anything written in the
    // safety field goes to the owner's phone NOW, not in tonight's digest.
    if (safety) {
      const url = process.env.NOTIFY_WEBHOOK_URL
      if (url && (/(^|\/\/|\.)ntfy\./.test(url) || url.includes('ntfy.sh/'))) {
        fetch(url, {
          method: 'POST',
          headers: { Title: 'Safety report', Priority: 'high', Tags: 'warning', Click: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hammertrackjune28.vercel.app'}/logs` },
          body: `${personName}: ${safety}`,
        }).catch((err) => console.error('Safety push failed', err))
      }
    }

    revalidatePath('/clock')
    revalidatePath('/logs')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Clock-out failed' }
  }
}

/** One QR tap at the machine: log a maintenance touch-point. */
export async function addEquipmentCheckAction(
  assetId: string,
  checkType: string,
  note = ''
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    const { supabase, userId, companyId } = await requireUser()
    const { error } = await supabase.from('equipment_checks').insert({
      company_id: companyId,
      asset_id: assetId,
      user_id: userId,
      check_type: checkType,
      note: note.slice(0, 300),
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Check failed' }
  }
}
