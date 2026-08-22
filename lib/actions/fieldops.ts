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

/** PostgREST signals an unknown column as PGRST204 (schema cache) or 42703 —
 *  both just mean migration 059 hasn't run; callers retry without the new
 *  columns so field ops never breaks on a lagging database. */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(error.message ?? ''))
}

const validCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Client-generated idempotency key (offline queue replays, migration 066).
 *  Sanitized to a UUID-ish token; anything else is treated as absent. */
const validIdem = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null

/** 23505 = unique_violation on the idempotency index — the earlier attempt
 *  already landed, so the replay reports success without inserting twice. */
const isDuplicateKey = (error: { code?: string } | null): boolean => error?.code === '23505'

/** Offline replays carry WHEN the tap actually happened, so a clock-in synced
 *  three hours later doesn't shift the timesheet. Sane values only: parseable,
 *  not in the future (2 min skew allowed), no older than 30 days — a phone
 *  left in a truck for a couple of weeks still replays with honest times. */
const validPastIso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return null
  const now = Date.now()
  if (t > now + 2 * 60_000 || t < now - 30 * 86_400_000) return null
  return new Date(t).toISOString()
}

/** The calendar day an instant falls on in the viewer's timezone (ht_tz
 *  cookie, set by TzCookie). A 9 PM Eastern writeup is 1 AM UTC the NEXT
 *  day — log_date must follow the crew's clock, not the server's. */
async function localLogDate(iso: string): Promise<string> {
  let tz = 'America/New_York'
  try {
    const { cookies } = await import('next/headers')
    const raw = cookies().get('ht_tz')?.value
    if (raw) {
      const candidate = decodeURIComponent(raw)
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }) // throws on garbage
      tz = candidate
    }
  } catch { /* missing/invalid cookie — Eastern fallback */ }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

export async function clockInAction(input: {
  category: ClockCategory
  projectGeofenceId?: string | null
  plan?: string
  lat?: number | null
  lng?: number | null
  /** Offline-queue replay guard — retries with the same key are no-ops. */
  idempotencyKey?: string | null
  /** Offline replays only: when the tap actually happened. */
  at?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode — sign in on the live app to clock in.' }
  try {
    const { supabase, userId, companyId, personName } = await requireUser()
    // One open entry per person — idempotent against double taps. But a
    // REPLAY (queued offline clock-in) colliding with a different open
    // entry must say so, not pretend it landed (ship-check P2).
    const { data: open } = await supabase
      .from('time_entries').select('id').eq('user_id', userId).is('clock_out_at', null).limit(1)
    if (open?.length) {
      if (input.idempotencyKey) {
        return { ok: false, error: 'You already have an open shift — the queued clock-in was skipped, not recorded.' }
      }
      return { ok: true }
    }
    const idem = validIdem(input.idempotencyKey)
    const at = validPastIso(input.at)
    // A replay whose timestamp is too old (or garbage) must not open a shift
    // stamped "now" — that fabricates hours weeks after the fact (ship P2-9).
    if (idem && input.at && !at) {
      return { ok: false, error: 'This queued clock-in is too old to record accurately — add the shift manually.' }
    }
    const base = {
      ...(at ? { clock_in_at: at } : {}), // column exists since 015 — safe in the fallback too
      company_id: companyId,
      user_id: userId,
      person_name: personName,
      category: input.category,
      project_geofence_id: input.category === 'project' ? (input.projectGeofenceId ?? null) : null,
      plan: (input.plan ?? '').slice(0, 500),
    }
    const hasPos = validCoord(input.lat) && validCoord(input.lng)
    const full = {
      ...base,
      ...(hasPos ? { in_lat: input.lat, in_lng: input.lng } : {}),
      ...(idem ? { idempotency_key: idem } : {}),
    }
    let { error } = await supabase.from('time_entries').insert(full)
    if (isDuplicateKey(error)) return { ok: true } // replay — the first attempt won
    // Lagging schema (059 pos columns or 066 idempotency_key) → plain insert.
    if (missingColumn(error) && (hasPos || idem)) ({ error } = await supabase.from('time_entries').insert(base))
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

    // Offline-queue replay guard (migration 066): if a log with this key
    // already exists, the earlier attempt won — report success, change nothing.
    const idem = validIdem(form.get('idempotencyKey'))
    // Set only when the offline queue replays WITHOUT the in-session photo
    // Files (app was closed) — required-photo rules relax so the writeup
    // isn't lost to a now-unmeetable requirement (see lib/offline-queue.ts).
    const offlineReplay = form.get('_offlineReplay') === '1'
    // When the queue replays, the clock-out happened at queue time — not now.
    const backAt = validPastIso(form.get('_queuedAt'))
    // Only the queue's replay executor sends _queuedAt — its presence (valid
    // or not) is the honest "this arrived via offline sync" marker. The
    // online path also sends idempotency keys, so the key can't be the badge.
    const offlineSynced = form.get('_queuedAt') !== null || offlineReplay
    if (idem) {
      const { data: dup, error: dupErr } = await supabase
        .from('daily_logs').select('id')
        .eq('company_id', companyId).eq('idempotency_key', idem).limit(1)
      if (!dupErr && dup?.length) return { ok: true }
    }

    // Staleness policy (#32, decided Aug 22 — mirrors clock-in): a replay
    // whose queue timestamp is missing, garbage, or >30 days old must NOT
    // close the shift stamped "now" — that invents a weeks-long shift ending
    // today and bills it to this week. The person closes it manually with
    // honest times instead.
    if (form.get('_queuedAt') !== null && !backAt) {
      return { ok: false, error: 'This queued clock-out is too old to record accurately — close the shift manually with the real times.' }
    }

    // The company's form drives validation + which answers exist. Tolerant:
    // any read failure falls back to the default form (pre-059 behavior).
    const { resolveLogForm } = await import('@/lib/log-form')
    const { data: co } = await supabase.from('companies').select('log_form').eq('id', companyId).single()
    const items = resolveLogForm(co?.log_form ?? null).filter((it) => it.enabled)

    const writeupItem = items.find((it) => it.std === 'writeup')
    const writeup = String(form.get('writeup') ?? '').trim().slice(0, 4000)
    if (writeupItem?.required && writeup.length < 10) {
      return { ok: false, error: 'Write up the day first — a couple of sentences minimum.' }
    }

    const { data: open } = await supabase
      .from('time_entries').select('id, project_geofence_id').eq('user_id', userId).is('clock_out_at', null)
      .order('clock_in_at', { ascending: false }).limit(1)
    const entryId = open?.[0]?.id as string | undefined
    const entryProject = (open?.[0]?.project_geofence_id as string | null) ?? null
    if (!entryId) return { ok: false, error: "You aren't clocked in." }

    // Uploads + custom answers, walked from the form definition.
    const photos: { url: string; kind: 'photo' | 'receipt' }[] = []
    const answers: { id: string; label: string; value: string | number | boolean | string[] }[] = []
    // Records that a required-photo rule was relaxed for this replay, so the
    // office sees "photos skipped" instead of assuming a complete form (067).
    let photosWaived = false
    for (const it of items) {
      if (it.std === 'writeup' || it.std === 'safety') continue // legacy columns below
      if (it.type === 'photos') {
        const name = it.std === 'photos' ? 'photos' : it.std === 'receipts' ? 'receipts' : `f_${it.id}`
        let uploaded = 0
        for (const f of form.getAll(name)) {
          if (!(f instanceof File)) continue
          const url = await uploadFieldPhoto(companyId, f)
          if (url) { photos.push({ url, kind: it.std === 'receipts' ? 'receipt' : 'photo' }); uploaded++ }
        }
        if (it.required && !uploaded) {
          if (!offlineReplay) return { ok: false, error: `“${it.label}” needs at least one photo.` }
          photosWaived = true
        }
        continue
      }
      if (it.std === 'trucks_fueled' || it.std === 'equipment_fueled') {
        const v = form.get(it.std === 'trucks_fueled' ? 'trucksFueled' : 'equipmentFueled')
        if (it.required && v === null) return { ok: false, error: `Answer “${it.label}” first.` }
        continue // written to its legacy column below
      }
      // Custom items → answers array
      const name = `a_${it.id}`
      if (it.type === 'checklist') {
        const vals = form.getAll(name).map((v) => String(v).slice(0, 120)).filter(Boolean).slice(0, 24)
        if (it.required && !vals.length) return { ok: false, error: `Check at least one option on “${it.label}”.` }
        if (vals.length) answers.push({ id: it.id, label: it.label, value: vals })
        continue
      }
      const raw = String(form.get(name) ?? '').trim()
      if (it.required && !raw) return { ok: false, error: `“${it.label}” is required.` }
      if (!raw) continue
      if (it.type === 'number') {
        const n = Number(raw)
        if (!Number.isFinite(n)) return { ok: false, error: `“${it.label}” needs a number.` }
        answers.push({ id: it.id, label: it.label, value: n })
      } else if (it.type === 'yesno') {
        answers.push({ id: it.id, label: it.label, value: raw === 'yes' })
      } else {
        answers.push({ id: it.id, label: it.label, value: raw.slice(0, 2000) })
      }
    }

    const safety = String(form.get('safety') ?? '').trim().slice(0, 2000)
    const lat = Number(form.get('lat')), lng = Number(form.get('lng'))
    const hasPos = Number.isFinite(lat) && Number.isFinite(lng) && form.get('lat') !== null

    const baseRow = {
      // The day it was WRITTEN (replay = queue time), on the crew's clock —
      // the DB default is the UTC day, which shifts evening logs forward.
      log_date: await localLogDate(backAt ?? new Date().toISOString()),
      company_id: companyId,
      user_id: userId,
      time_entry_id: entryId,
      writeup,
      safety,
      trucks_fueled: form.get('trucksFueled') === null ? null : form.get('trucksFueled') === 'yes',
      equipment_fueled: form.get('equipmentFueled') === null ? null : form.get('equipmentFueled') === 'yes',
      photos,
    }
    const fullRow = {
      ...baseRow, answers,
      ...(hasPos ? { lat, lng } : {}),
      ...(idem ? { idempotency_key: idem } : {}),
      ...(photosWaived ? { photos_waived: true } : {}),
      ...(offlineSynced ? { offline_synced: true } : {}),
    }
    let { data: logRow, error: logErr } = await supabase.from('daily_logs').insert(fullRow).select('id').single()
    // Replay raced an attempt that already landed (unique idempotency index):
    // just make sure the entry is closed, then report success.
    if (isDuplicateKey(logErr)) {
      await supabase.from('time_entries')
        .update({ clock_out_at: backAt ?? new Date().toISOString() })
        .eq('id', entryId).eq('user_id', userId).is('clock_out_at', null)
      revalidatePath('/clock')
      revalidatePath('/logs')
      return { ok: true }
    }
    // Migration 059/066 not applied yet → store what the schema knows.
    if (missingColumn(logErr)) {
      ({ data: logRow, error: logErr } = await supabase.from('daily_logs').insert(baseRow).select('id').single())
    }
    if (logErr) return { ok: false, error: logErr.message }

    // Receipt photos also land in the receipts inbox (migration 017) so the
    // office can extract + approve them into QuickBooks. Tolerant: absent
    // table just means the inbox feature isn't turned on yet.
    const receiptPhotos = photos.filter((ph) => ph.kind === 'receipt')
    if (receiptPhotos.length) {
      const { error: rcptErr } = await supabase.from('receipts').insert(
        receiptPhotos.map((ph) => ({
          company_id: companyId,
          user_id: userId,
          daily_log_id: logRow?.id ?? null,
          project_geofence_id: entryProject,
          url: ph.url,
        }))
      )
      if (rcptErr) console.error('Receipt indexing skipped:', rcptErr.message)
    }

    const outAt = backAt ?? new Date().toISOString()
    const outPatch = hasPos
      ? { clock_out_at: outAt, out_lat: lat, out_lng: lng }
      : { clock_out_at: outAt }
    let { error: outErr } = await supabase
      .from('time_entries')
      .update(outPatch)
      .eq('id', entryId)
      .eq('user_id', userId)
    if (missingColumn(outErr) && hasPos) {
      ({ error: outErr } = await supabase
        .from('time_entries')
        .update({ clock_out_at: outAt })
        .eq('id', entryId)
        .eq('user_id', userId))
    }
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
  note = '',
  /** Offline-queue replay guard — retries with the same key are no-ops. */
  idempotencyKey?: string | null,
  /** Offline replays only: when the tap actually happened. */
  occurredAt?: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  try {
    const { supabase, userId, companyId } = await requireUser()
    const idem = validIdem(idempotencyKey)
    const at = validPastIso(occurredAt)
    // Same policy as clock-in: a replay too old to timestamp honestly is
    // rejected, not silently recorded as if it happened now (ship P2-9).
    if (idem && occurredAt && !at) {
      return { ok: false, error: 'This queued check is too old to record accurately — it was skipped.' }
    }
    const base = {
      ...(at ? { created_at: at } : {}), // column exists since 015 — safe in the fallback too
      company_id: companyId,
      asset_id: assetId,
      user_id: userId,
      check_type: checkType,
      note: note.slice(0, 300),
    }
    let { error } = await supabase.from('equipment_checks')
      .insert({ ...base, ...(idem ? { idempotency_key: idem } : {}) })
    if (isDuplicateKey(error)) return { ok: true } // replay — the first tap won
    // Migration 066 not applied yet → insert without the key.
    if (missingColumn(error) && idem) ({ error } = await supabase.from('equipment_checks').insert(base))
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Check failed' }
  }
}
