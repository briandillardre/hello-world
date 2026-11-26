'use server'

/**
 * Books writes (migration 167). Members hold SELECT only on books_snapshots /
 * books_closes, and only at Admin or the Master with costs — so every write
 * runs on the service role AFTER the same checks (edit, not a preview, not a
 * prospect, the finance level, costs, Admin+), company pinned on every row.
 * Nothing here writes to QuickBooks: a refresh only reads it.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { keyRateLimited } from '@/lib/rate-limit'
import { CLOSE_STEPS, monthStart, SIGN_ROLES, STEP_KEYS, stepsDone, type SignRole, type StepTick } from '@/lib/books/close'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const REFRESH_EVERY_MS = 5 * 60_000

async function owner() {
  const perms = await requireEditOrThrow()
  if (perms.viewingAs) throw new Error('Read-only preview — exit View as to make changes.')
  if (isProspect(perms)) throw new Error('Not for this login.')
  if (!perms.features.includes('finance')) throw new Error('Financials aren’t open for your login.')
  if (!perms.canViewCosts) throw new Error('The books are for logins that can see costs.')
  if (rankOf(perms) < RANK.admin) throw new Error('The books are for Admins and the owner.')
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) throw new Error('Sign in again.')
  const svc = createServiceClient()
  const { data: prof } = await svc.from('profiles').select('name').eq('id', user.id).eq('company_id', companyId).maybeSingle()
  if (!prof) throw new Error('Not a member of this company.')
  return { companyId, userId: user.id, name: (prof.name as string | null)?.trim() || 'Someone', svc }
}

const fail = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' })

/** Read QuickBooks now (at most once per 5 minutes per company). */
export async function refreshBooksAction(): Promise<Res<{ takenAt: string; missing: string[] }>> {
  if (isMock) return { ok: false, error: 'Demo mode — there’s no QuickBooks to read.' }
  try {
    const w = await owner()
    if (keyRateLimited(w.companyId, 'books-refresh', 1, REFRESH_EVERY_MS)) return { ok: false, error: 'Read a few minutes ago — try again in 5 minutes.' }
    const { data: last } = await w.svc.from('books_snapshots').select('taken_at').eq('company_id', w.companyId)
      .order('taken_at', { ascending: false }).limit(1).maybeSingle()
    if (last && Date.now() - Date.parse(String(last.taken_at)) < REFRESH_EVERY_MS) return { ok: false, error: 'Read a few minutes ago — try again in 5 minutes.' }
    const { pullBooks } = await import('@/lib/books/qbo-read')
    const r = await pullBooks(w.companyId)
    revalidatePath('/finance', 'layout')
    return r.ok ? { ok: true, takenAt: r.takenAt, missing: r.missing } : { ok: false, error: r.error }
  } catch (err) { return fail(err) }
}

type Row = { items: Record<string, StepTick> | null; signed_at: string | null; updated_at: string }

/** Tick (or untick) one step of a month's close, with an optional note. */
export async function tickCloseStepAction(month: string, key: string, done: boolean, note?: string | null): Promise<Res<{ done: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const m = monthStart(month)
  if (!m) return { ok: false, error: 'That isn’t a month.' }
  if (typeof key !== 'string' || !STEP_KEYS.includes(key)) return { ok: false, error: 'That isn’t a close step.' }
  if (typeof done !== 'boolean') return { ok: false, error: 'Tick or untick.' }
  const cleanNote = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
  try {
    const w = await owner()
    const thisMonth = new Date().toISOString().slice(0, 8) + '01'
    if (m > thisMonth || m < '2020-01-01') return { ok: false, error: 'Only months that have started can be closed.' }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: cur } = await w.svc.from('books_closes').select('items, signed_at, updated_at')
        .eq('company_id', w.companyId).eq('month', m).maybeSingle()
      const row = cur as Row | null
      if (row?.signed_at) return { ok: false, error: 'This month is signed off — it can’t change.' }
      const items: Record<string, StepTick> = { ...(row?.items ?? {}) }
      for (const k of Object.keys(items)) if (!STEP_KEYS.includes(k)) delete items[k]
      if (done) items[key] = { by: w.userId, name: w.name.slice(0, 120), at: new Date().toISOString(), note: cleanNote }
      else delete items[key]
      const now = new Date().toISOString()
      if (!row) {
        const { error } = await w.svc.from('books_closes').insert({ company_id: w.companyId, month: m, items, updated_at: now })
        if (!error) { revalidatePath('/finance', 'layout'); return { ok: true, done: stepsDone({ items }) } }
        if (error.code !== '23505') return { ok: false, error: 'Couldn’t save that step.' }
        continue // someone else started this month a moment ago — read it again
      }
      // Compare-and-set on the stamp: two people ticking at once never drop a tick.
      const { data: upd, error } = await w.svc.from('books_closes').update({ items, updated_at: now })
        .eq('company_id', w.companyId).eq('month', m).eq('updated_at', row.updated_at).is('signed_at', null).select('month')
      if (error) return { ok: false, error: 'Couldn’t save that step.' }
      if (upd && upd.length) { revalidatePath('/finance', 'layout'); return { ok: true, done: stepsDone({ items }) } }
    }
    return { ok: false, error: 'Someone else is changing this close — reload and try again.' }
  } catch (err) { return fail(err) }
}

/** Sign a month off — only once every step is ticked. Records who, as what, and when. */
export async function signCloseAction(month: string, role: SignRole, name: string): Promise<Res<{ signedAt: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const m = monthStart(month)
  if (!m) return { ok: false, error: 'That isn’t a month.' }
  if (!SIGN_ROLES.some((r) => r.key === role)) return { ok: false, error: 'Sign as the owner, the bookkeeper or the CPA.' }
  const signedName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (signedName.length < 2) return { ok: false, error: 'Type the name of the person signing.' }
  try {
    const w = await owner()
    const { data: cur } = await w.svc.from('books_closes').select('items, signed_at, updated_at')
      .eq('company_id', w.companyId).eq('month', m).maybeSingle()
    const row = cur as Row | null
    if (row?.signed_at) return { ok: false, error: 'Already signed off.' }
    const missing = CLOSE_STEPS.filter((s) => !row?.items?.[s.key])
    if (missing.length) return { ok: false, error: `Tick every step first — ${missing.length} left (${missing[0].words.toLowerCase()}${missing.length > 1 ? ', …' : ''}).` }
    const signedAt = new Date().toISOString()
    const { data: upd, error } = await w.svc.from('books_closes')
      .update({ signed_by: w.userId, signed_name: signedName, signed_role: role, signed_at: signedAt, updated_at: signedAt })
      .eq('company_id', w.companyId).eq('month', m).eq('updated_at', row!.updated_at).is('signed_at', null).select('month')
    if (error) return { ok: false, error: 'Couldn’t sign it off.' }
    if (!upd?.length) return { ok: false, error: 'The close changed a moment ago — reload and sign again.' }
    revalidatePath('/finance', 'layout')
    return { ok: true, signedAt }
  } catch (err) { return fail(err) }
}
