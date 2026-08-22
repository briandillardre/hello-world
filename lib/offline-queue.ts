'use client'

/**
 * Offline field queue — jobsites are dead zones. When a clock-in, clock-out,
 * or QR equipment check can't REACH the server (transport failure — not a
 * server "no"), the attempt is saved here and replayed FIFO when coverage
 * returns. A server rejection is never queued: retrying a "no" doesn't help.
 *
 * - localStorage-backed (`ht_offline_queue_v1`), capped at 200 entries
 *   (oldest dropped first), every storage access wrapped in try/catch
 *   (private mode / blocked storage — repo convention).
 * - Every entry carries a client-generated idempotency key
 *   (crypto.randomUUID). The server actions use it as a unique-insert guard
 *   (migration 066), so a replay that races an attempt that actually landed
 *   is a safe no-op — the earlier attempt wins, the replay returns ok.
 * - PHOTO DECISION (clock-out): File objects can't live in localStorage.
 *   The full FormData (files included) is stashed in a memory-only Map for
 *   this browsing session; if the app is closed before sync, the replay
 *   rebuilds a text-only FormData flagged `_offlineReplay=1`, which tells the
 *   server to accept the log without required photos rather than bounce the
 *   whole writeup. The UI copy discloses this honestly ("photos attach only
 *   if sync happens before you close the app"). Chosen over data-URL storage:
 *   a phone camera shot is 2–8 MB and localStorage's ~5 MB budget would make
 *   "saved on your phone" a lie exactly when it matters.
 *
 * Events (window):
 * - 'ht:queue-changed'  — after any enqueue/remove; payload-free, recount via pending().
 * - 'ht:queue-flushed'  — detail { entry, ok, error? } after a replay got a
 *   server answer (ok:true = landed, ok:false = server rejected → removed).
 */

import { clockInAction, clockOutAction, addEquipmentCheckAction } from '@/lib/actions/fieldops'
import type { ClockCategory } from '@/lib/field-types'

export type QueueAction = 'clock-in' | 'clock-out' | 'equipment-check'

export interface QueueEntry {
  /** The idempotency key — doubles as the entry id. */
  id: string
  action: QueueAction
  payload: Record<string, unknown>
  queuedAt: string
}

export interface QueueFlushDetail {
  entry: QueueEntry
  ok: boolean
  error?: string
}

const LS_KEY = 'ht_offline_queue_v1'
const CAP = 200

/** Session-only stash for clock-out FormData (photos are Files — memory only). */
const formStash = new Map<string, FormData>()

export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* older webviews */ }
  return `ht-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function readAll(): QueueEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as QueueEntry[]).filter((e) => e && typeof e.id === 'string') : []
  } catch { return [] }
}

function writeAll(list: QueueEntry[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* private mode */ }
}

function emitChanged() {
  try { window.dispatchEvent(new CustomEvent('ht:queue-changed')) } catch { /* SSR */ }
}

/** Save one failed attempt. Returns the entry, or null if storage is blocked
 *  (nothing persisted — caller should fall back to a plain error). */
export function enqueue(action: QueueAction, payload: Record<string, unknown>, idempotencyKey: string): QueueEntry | null {
  if (typeof window === 'undefined') return null
  const entry: QueueEntry = { id: idempotencyKey, action, payload, queuedAt: new Date().toISOString() }
  const list = readAll().filter((e) => e.id !== entry.id) // re-enqueue replaces, never duplicates
  list.push(entry)
  while (list.length > CAP) list.shift() // oldest out first
  writeAll(list)
  // Confirm it actually landed (localStorage can be blocked entirely).
  if (!readAll().some((e) => e.id === entry.id)) return null
  emitChanged()
  return entry
}

/** Everything waiting to sync, FIFO — optionally one action kind only. */
export function pending(action?: QueueAction): QueueEntry[] {
  const list = readAll()
  return action ? list.filter((e) => e.action === action) : list
}

function remove(id: string) {
  writeAll(readAll().filter((e) => e.id !== id))
  formStash.delete(id)
  emitChanged()
}

/** Keep a clock-out's real FormData (with photo Files) for in-session replay. */
export function stashFormData(id: string, fd: FormData) {
  formStash.set(id, fd)
}

/**
 * What one replay came to: 'done' = server answered ok (or the idempotency
 * guard says the earlier attempt already landed) · 'rejected' = server
 * answered no (remove — retrying an identical request can't change its mind).
 * A THROW from the executor means transport is still down: keep + stop.
 */
export type FlushOutcome = { status: 'done' } | { status: 'rejected'; error?: string }
export type Executor = (entry: QueueEntry) => Promise<FlushOutcome>

interface ClockInPayload {
  category: ClockCategory
  projectGeofenceId: string | null
  plan: string
  lat: number | null
  lng: number | null
}

/** Auth failures are RETRYABLE (session refresh after a long offline
 *  stretch), never a server "no" — deleting the writeup over a stale
 *  session would lose real data (ship-check P2). */
function isAuthFailure(error?: string): boolean {
  return !!error && /not signed in|sign in/i.test(error)
}

async function defaultExecutor(entry: QueueEntry): Promise<FlushOutcome> {
  if (entry.action === 'clock-in') {
    const p = entry.payload as unknown as ClockInPayload
    const res = await clockInAction({ ...p, idempotencyKey: entry.id, at: entry.queuedAt })
    return res.ok ? { status: 'done' } : { status: 'rejected', error: res.error }
  }
  if (entry.action === 'clock-out') {
    let fd = formStash.get(entry.id)
    if (!fd) {
      // App was closed since the save — rebuild the text portions; the photos
      // are gone, and _offlineReplay tells the server not to bounce the log
      // over a now-unmeetable photo requirement.
      fd = new FormData()
      const fields = (entry.payload as { fields?: Record<string, string[]> }).fields ?? {}
      for (const [name, values] of Object.entries(fields)) {
        for (const v of values) fd.append(name, v)
      }
      fd.set('_offlineReplay', '1')
    }
    fd.set('idempotencyKey', entry.id)
    fd.set('_queuedAt', entry.queuedAt) // clock-out happened at queue time, not sync time
    const res = await clockOutAction(fd)
    return res.ok ? { status: 'done' } : { status: 'rejected', error: res.error }
  }
  // equipment-check
  const p = entry.payload as { assetId?: string; checkType?: string; note?: string }
  const res = await addEquipmentCheckAction(String(p.assetId ?? ''), String(p.checkType ?? ''), p.note ?? '', entry.id, entry.queuedAt)
  return res.ok ? { status: 'done' } : { status: 'rejected', error: res.error }
}

let flushing = false

/** Replay the queue FIFO. Removes entries the server answered (ok or
 *  rejected), keeps everything from the first transport failure on. */
export async function flush(executor: Executor = defaultExecutor): Promise<void> {
  if (flushing || typeof window === 'undefined') return
  flushing = true
  try {
    for (;;) {
      const entry = readAll()[0]
      if (!entry) break
      let outcome: FlushOutcome
      try {
        outcome = await executor(entry)
      } catch {
        break // still no coverage — keep the entry, stop the run
      }
      if (outcome.status === 'rejected' && isAuthFailure(outcome.error)) {
        break // stale session, not a real rejection — keep everything, retry later
      }
      remove(entry.id)
      try {
        window.dispatchEvent(new CustomEvent<QueueFlushDetail>('ht:queue-flushed', {
          detail: { entry, ok: outcome.status === 'done', error: outcome.status === 'rejected' ? outcome.error : undefined },
        }))
      } catch { /* never let a listener kill the run */ }
    }
  } finally {
    flushing = false
  }
}

// ── Owner guard: on a shared tablet, worker A's queued events must never
// replay under worker B's session (sec-check P2). The queue remembers which
// user it belongs to; a different signed-in user drops it.
const OWNER_KEY = 'ht_offline_queue_owner_v1'
async function ownerGuard(): Promise<void> {
  try {
    const { createClient } = await import('@/lib/supabase')
    const { data } = await createClient().auth.getUser()
    const uid = data.user?.id
    if (!uid) return // signed out — flush will fail auth-retryably anyway
    const owner = localStorage.getItem(OWNER_KEY)
    if (owner && owner !== uid && readAll().length) {
      writeAll([]) // different person now — their taps, not this queue's
      formStash.clear()
      emitChanged()
    }
    localStorage.setItem(OWNER_KEY, uid)
  } catch { /* demo mode / storage blocked — nothing to guard */ }
}

/** Side-effect bootstrap for layouts (OfflineSync) — wiring lives below. */
export function initOfflineQueue(): void { /* module init did the work */ }

// ── Auto-flush wiring: back-online events + module init when already online ──
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  if (!w.__htOfflineQueueWired) {
    w.__htOfflineQueueWired = true
    window.addEventListener('online', () => { void ownerGuard().then(() => flush()) })
    if (navigator.onLine && readAll().length) {
      // Small delay so hydration finishes before server actions fire.
      setTimeout(() => { void ownerGuard().then(() => flush()) }, 1500)
    }
  }
}
