'use server'

import { createHmac } from 'crypto'
import { getRealPermissions, getMyPermissions } from '@/lib/permissions-server'
import { normalizeRole } from '@/lib/permissions'
import { BRAND_DOMAIN } from '@/lib/brand'
import {
  cleanSharedView, cleanTitle, mintLinkId, shortLinkUrl,
  FILE_LINK_DAYS, VIEW_LINK_DAYS, LINK_ID_RE,
} from '@/lib/share-links'

/**
 * Share links (migration 113/114) — the server half. Every write here is on
 * the service client AFTER the caller has been resolved, so the tables need
 * no write policies; every read that matters to a person runs through RLS.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

type ExportKind = 'gif' | 'png' | 'pdf'
const EXPORT_MIME: Record<ExportKind, string> = { gif: 'image/gif', png: 'image/png', pdf: 'application/pdf' }
const isExportKind = (k: unknown): k is ExportKind =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(EXPORT_MIME, k)
const MAX_EXPORT_BYTES = 25 * 1024 * 1024
/** Ceilings. The company one is the bucket's daily bill; the person one is
 *  so nobody burns the whole company's day alone (sec-check on 113). A mint
 *  now CREATES the row, so an upload that is never finalized still counts. */
const EXPORTS_PER_DAY = 100
const EXPORTS_PER_PERSON_DAY = 25
const VIEW_LINKS_PER_DAY = 200
const MAX_RECIPIENTS = 25
/** Per link, ever; per sender, per day (114). */
const SENDS_PER_LINK = 100
const SENDS_PER_SENDER_DAY = 100
/** A minted upload has this long to finalize before the row (and, a day
 *  later, the object) is swept. */
const PENDING_HOURS = 2

async function caller(): Promise<{ userId: string; companyId: string; features: string[] } | null> {
  const p = await getRealPermissions()
  if (!p.userId || !p.companyId) return null
  return { userId: p.userId, companyId: p.companyId, features: p.features }
}

/** "View as" is a read-only preview of somebody else's app — nothing it does
 *  may write a row, mint a link or push a phone (Roles v2). */
async function previewing(): Promise<boolean> {
  return !!(await getMyPermissions()).viewingAs
}

type Svc = import('@supabase/supabase-js').SupabaseClient

async function dailyCount(svc: Svc, companyId: string, kind: 'view' | 'file', userId?: string): Promise<number> {
  let q = svc.from('share_links').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('kind', kind)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if (userId) q = q.eq('created_by', userId)
  const { count } = await q
  return count ?? 0
}

/**
 * The storage folder for a company's exports. Signed file URLs are handed to
 * people outside the company (a client, an insurer), and the path is part of
 * the URL — so the folder is an HMAC of the company id, never the id itself
 * (which is also the Master's auth uid). Stable per company, checked the same
 * way at finalize.
 */
function exportFolder(companyId: string): string {
  const key = process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'hammertrack-exports'
  return createHmac('sha256', 'hammertrack-export-folder-v1').update(key).update(companyId).digest('hex').slice(0, 16)
}

// ── Files: GIF / PNG / PDF exports ────────────────────────────────────────

export async function mintExportUploadAction(kind: string, size: number): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  if (!me.features.includes('map')) return { ok: false, error: 'Your role has no map export.' }
  if (await previewing()) return { ok: false, error: 'Leave “View as” first — nothing is exported from a preview.' }
  if (!isExportKind(kind)) return { ok: false, error: 'Not a file we export.' }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_EXPORT_BYTES) return { ok: false, error: 'That file is too big to link (25 MB max).' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const [company, person] = await Promise.all([
    dailyCount(svc, me.companyId, 'file'),
    dailyCount(svc, me.companyId, 'file', me.userId),
  ])
  if (company >= EXPORTS_PER_DAY) {
    return { ok: false, error: `That is ${EXPORTS_PER_DAY} export links today for the company — the daily ceiling. Tomorrow resets it.` }
  }
  if (person >= EXPORTS_PER_PERSON_DAY) {
    return { ok: false, error: `That is ${EXPORTS_PER_PERSON_DAY} export links today for you — the daily ceiling. Tomorrow resets it.` }
  }
  // The link id doubles as the object name, and the ROW exists from this
  // moment (payload.pending) — so the ceiling counts every upload started,
  // finished or not, and the sweep has a row to key on.
  const id = mintLinkId()
  const path = `${exportFolder(me.companyId)}/exports/${id}.${kind}`
  const { error: insErr } = await svc.from('share_links').insert({
    id,
    company_id: me.companyId,
    created_by: me.userId,
    kind: 'file',
    title: null,
    payload: { pending: true, kind, path },
    expires_at: new Date(Date.now() + PENDING_HOURS * 3_600_000).toISOString(),
  })
  if (insErr) return { ok: false, error: insErr.message.includes('relation') ? 'Links are still deploying — try again in a minute.' : 'Couldn’t start the upload — try again.' }
  const { data, error } = await svc.storage.from('exports').createSignedUploadUrl(path)
  if (error || !data) {
    await svc.from('share_links').delete().eq('id', id)
    return { ok: false, error: 'Couldn’t start the upload — try again.' }
  }
  return { ok: true, path: data.path, token: data.token }
}

export async function finalizeExportAction(path: string, filename: string, title: string | null): Promise<
  { ok: true; id: string; url: string; fileUrl: string; expiresAt: string } | { ok: false; error: string }
> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  if (await previewing()) return { ok: false, error: 'Leave “View as” first.' }
  const m = new RegExp(`^${exportFolder(me.companyId)}/exports/([23456789abcdefghjkmnpqrstuvwxyz]{12})\\.(gif|png|pdf)$`).exec(path)
  if (!m) return { ok: false, error: 'Bad upload path' }
  const id = m[1]
  const ext = m[2] as ExportKind

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  // The mint's own row must still be there and still pending — a stranger's
  // id, a finished link or a swept upload all stop here.
  const { data: row } = await svc.from('share_links').select('id, payload')
    .eq('id', id).eq('company_id', me.companyId).eq('created_by', me.userId).eq('kind', 'file').maybeSingle()
  const pending = !!(row?.payload as { pending?: unknown } | null)?.pending
  if (!row || !pending) {
    await svc.storage.from('exports').remove([path])
    return { ok: false, error: row ? 'That link is already made.' : 'The upload took too long — try again.' }
  }

  // The object must really be there, be the type it claims, and fit.
  const slash = path.lastIndexOf('/')
  const { data: objects } = await svc.storage.from('exports').list(path.slice(0, slash), { search: path.slice(slash + 1) })
  const obj = (objects ?? []).find((o) => o.name === path.slice(slash + 1))
  if (!obj) return { ok: false, error: 'Upload didn’t finish — try again.' }
  const meta = (obj.metadata as { size?: number; mimetype?: string } | null) ?? {}
  const uploadedType = String(meta.mimetype ?? '').split(';')[0].trim().toLowerCase()
  if ((meta.size ?? 0) > MAX_EXPORT_BYTES || uploadedType !== EXPORT_MIME[ext]) {
    await svc.storage.from('exports').remove([path])
    await svc.from('share_links').delete().eq('id', id)
    return { ok: false, error: uploadedType !== EXPORT_MIME[ext] ? 'That upload wasn’t the file it claimed to be.' : 'That file is too big to link (25 MB max).' }
  }

  // The name the download lands under: letters, digits, dot, dash, and the
  // right extension — never whatever the client typed.
  const safeName = (String(filename ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'hammertrack-export')
  const finalName = safeName.toLowerCase().endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`
  const expiresAt = new Date(Date.now() + FILE_LINK_DAYS * 86_400_000).toISOString()
  const { error: updErr } = await svc.from('share_links').update({
    title: cleanTitle(title),
    payload: { path, filename: finalName, mime: EXPORT_MIME[ext], bytes: meta.size ?? null },
    expires_at: expiresAt,
  }).eq('id', id).eq('company_id', me.companyId)
  if (updErr) {
    await svc.storage.from('exports').remove([path])
    return { ok: false, error: 'Could not save the link.' }
  }
  // Direct URL for the Save button: an external host, so the shell hands it
  // to the system browser, which downloads it. Seven days; the short link
  // re-mints a fresh one on every open until the row expires.
  const { data: signed, error: signErr } = await svc.storage.from('exports').createSignedUrl(path, 7 * 86_400, { download: finalName })
  if (signErr || !signed?.signedUrl) return { ok: false, error: 'Could not sign the download link.' }
  return { ok: true, id, url: shortLinkUrl(BRAND_DOMAIN, id), fileUrl: signed.signedUrl, expiresAt }
}

// ── Views: "this screen", for the team ─────────────────────────────────────

export async function createViewLinkAction(input: { title: string; view: unknown }): Promise<
  { ok: true; id: string; url: string; path: string; title: string } | { ok: false; error: string }
> {
  if (isMock) return { ok: false, error: 'Demo mode — sharing a view works once signed in to your company.' }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  if (!me.features.includes('map')) return { ok: false, error: 'Your role has no map to share.' }
  if (await previewing()) return { ok: false, error: 'Leave “View as” first — nothing is shared from a preview.' }
  const view = cleanSharedView(input?.view)
  if (!view) return { ok: false, error: 'This screen could not be captured — move the map a little and try again.' }
  const title = cleanTitle(input?.title) ?? 'Map view'
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  if ((await dailyCount(svc, me.companyId, 'view')) >= VIEW_LINKS_PER_DAY) {
    return { ok: false, error: 'That is a lot of shared views for one day — the ceiling resets tomorrow.' }
  }
  // A division in the snapshot has to be one of THIS company's (sec-check:
  // a crafted id would have set every opener's filter to nothing).
  if (view.division && view.division !== 'none') {
    const { data: div } = await svc.from('divisions').select('id').eq('id', view.division).eq('company_id', me.companyId).maybeSingle()
    if (!div) delete view.division
  }
  const id = mintLinkId()
  const { error } = await svc.from('share_links').insert({
    id,
    company_id: me.companyId,
    created_by: me.userId,
    kind: 'view',
    title,
    payload: view,
    expires_at: new Date(Date.now() + VIEW_LINK_DAYS * 86_400_000).toISOString(),
  })
  if (error) return { ok: false, error: error.message.includes('relation') ? 'Sharing is still deploying — try again in a minute.' : 'Could not save the view.' }
  // The in-app path goes through /x too: signed out, it carries the view
  // through /login as ?next=; signed in, it lands straight on /map?v=.
  return { ok: true, id, url: shortLinkUrl(BRAND_DOMAIN, id), path: `/x/${id}`, title }
}

export interface Teammate {
  id: string
  name: string
  role: string
  /** Has the app on a phone that can receive a push. */
  phone: boolean
}

/** Everyone else in the company, for the "send to" list. Names and roles
 *  only — the same picture the Team page shows — and whether a push can
 *  reach them, so the sender is never told "Sent" about a phone that does
 *  not exist. */
export async function listTeammatesAction(): Promise<Teammate[]> {
  if (isMock) {
    return [
      { id: 'm4', name: 'Office admin (demo)', role: 'admin', phone: true },
      { id: 'm2', name: 'Foreman (demo)', role: 'foreman', phone: true },
      { id: 'm3', name: 'Crew member (demo)', role: 'associate', phone: false },
    ]
  }
  const me = await caller()
  if (!me || !me.features.includes('map')) return []
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const svc = createServiceClient()
    const [{ data: people }, { data: phones }] = await Promise.all([
      svc.from('profiles').select('id, name, role').eq('company_id', me.companyId).limit(300),
      svc.from('device_tokens').select('user_id').eq('company_id', me.companyId).limit(2000),
    ])
    const withPhone = new Set((phones ?? []).map((r) => r.user_id as string | null).filter(Boolean))
    return ((people ?? []) as { id: string; name: string | null; role: string | null }[])
      .filter((p) => p.id !== me.userId)
      .map((p) => ({
        id: p.id,
        name: (p.name ?? '').trim() || 'Teammate',
        // The Master shows as Admin everywhere else; here too.
        role: p.id === me.companyId ? 'admin' : normalizeRole(p.role, 'associate'),
        phone: withPhone.has(p.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/**
 * Push a view link to teammates inside the app. Strictly THEIR phones — a
 * person-to-person note never falls back to the whole company — only to
 * people on this company's roster, through their own `shares` switch (107),
 * and capped per link and per sender per day (114).
 */
export async function sendViewLinkAction(id: string, userIds: string[], note: string | null): Promise<
  { ok: true; sent: string[]; noPhone: string[] } | { ok: false; error: string }
> {
  if (isMock) return { ok: true, sent: ['Foreman (demo)'], noPhone: [] }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  if (!me.features.includes('map')) return { ok: false, error: 'Your role has no map to share.' }
  if (await previewing()) return { ok: false, error: 'Leave “View as” first.' }
  if (!LINK_ID_RE.test(id)) return { ok: false, error: 'That link is not ours.' }
  const ids = Array.from(new Set((userIds ?? []).filter((u) => typeof u === 'string' && /^[0-9a-f-]{36}$/i.test(u)))).slice(0, MAX_RECIPIENTS)
  if (!ids.length) return { ok: false, error: 'Pick at least one teammate.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const [{ data: link }, { data: people }, { data: sender }, perLink, perSender] = await Promise.all([
    svc.from('share_links').select('id, title, kind, company_id').eq('id', id).eq('company_id', me.companyId).eq('kind', 'view').maybeSingle(),
    svc.from('profiles').select('id, name').eq('company_id', me.companyId).in('id', ids),
    svc.from('profiles').select('name').eq('id', me.userId).maybeSingle(),
    svc.from('share_link_sends').select('id', { count: 'exact', head: true }).eq('link_id', id),
    svc.from('share_link_sends').select('id', { count: 'exact', head: true }).eq('sender', me.userId).gte('created_at', dayAgo),
  ])
  if (!link) return { ok: false, error: 'That view link is not yours to send.' }
  const roster = (people ?? []) as { id: string; name: string | null }[]
  if (!roster.length) return { ok: false, error: 'None of those people are on your team.' }
  if ((perLink.count ?? 0) + roster.length > SENDS_PER_LINK) {
    return { ok: false, error: `This link has gone to as many people as it can (${SENDS_PER_LINK}) — share a fresh one.` }
  }
  if ((perSender.count ?? 0) + roster.length > SENDS_PER_SENDER_DAY) {
    return { ok: false, error: `That is ${SENDS_PER_SENDER_DAY} sends today — the daily ceiling. Copy the link instead.` }
  }

  const { sendPushToUser } = await import('@/lib/push')
  const from = cleanTitle(sender?.name, 40) ?? 'A teammate'
  const title = cleanTitle(link.title, 80) ?? 'Map view'
  const extra = cleanTitle(note, 140)
  const sent: string[] = []
  const noPhone: string[] = []
  const rows: { link_id: string; company_id: string; sender: string; recipient: string; delivered: boolean }[] = []
  for (const p of roster) {
    const name = (p.name ?? '').trim() || 'Teammate'
    const n = await sendPushToUser(me.companyId, p.id, {
      title: `${from} shared a map view`,
      body: extra ? `${title} — ${extra}` : title,
      url: `/x/${id}`,
    }, { strict: true, kind: 'shares' })
    if (n > 0) sent.push(name)
    else noPhone.push(name)
    rows.push({ link_id: id, company_id: me.companyId, sender: me.userId, recipient: p.id, delivered: n > 0 })
  }
  // The record is what the caps count from; a failed insert must not hide
  // the sends that already went out, so it is logged and the answer stands.
  const { error: logErr } = await svc.from('share_link_sends').insert(rows)
  if (logErr) console.warn('share_link_sends insert failed', logErr.message)
  return { ok: true, sent, noPhone }
}
