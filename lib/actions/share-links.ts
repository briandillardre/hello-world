'use server'

import { getRealPermissions, getMyPermissions } from '@/lib/permissions-server'
import { normalizeRole } from '@/lib/permissions'
import { BRAND_DOMAIN } from '@/lib/brand'
import {
  cleanSharedView, cleanTitle, mintLinkId, shortLinkUrl, viewLinkPath,
  FILE_LINK_DAYS, VIEW_LINK_DAYS, LINK_ID_RE,
} from '@/lib/share-links'

/**
 * Share links (migration 113) — the server half. Every write here is on the
 * service client AFTER the caller has been resolved, so the table needs no
 * write policies; every read that matters to a person runs through RLS.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

type ExportKind = 'gif' | 'png' | 'pdf'
const EXPORT_MIME: Record<ExportKind, string> = { gif: 'image/gif', png: 'image/png', pdf: 'application/pdf' }
const MAX_EXPORT_BYTES = 25 * 1024 * 1024
/** A company's ceiling on export links per day (sec-check shape from 101:
 *  signed upload URLs are storage anyone signed in can fill). */
const EXPORTS_PER_DAY = 100
const VIEW_LINKS_PER_DAY = 200
const MAX_RECIPIENTS = 25

async function caller(): Promise<{ userId: string; companyId: string; features: string[] } | null> {
  const p = await getRealPermissions()
  if (!p.userId || !p.companyId) return null
  return { userId: p.userId, companyId: p.companyId, features: p.features }
}

async function dailyCount(svc: import('@supabase/supabase-js').SupabaseClient, companyId: string, kind: 'view' | 'file'): Promise<number> {
  const { count } = await svc.from('share_links').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('kind', kind)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  return count ?? 0
}

// ── Files: GIF / PNG / PDF exports ────────────────────────────────────────

export async function mintExportUploadAction(kind: string, size: number): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  if (!me.features.includes('map')) return { ok: false, error: 'Your role has no map export.' }
  if (!(kind in EXPORT_MIME)) return { ok: false, error: 'Not a file we export.' }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_EXPORT_BYTES) return { ok: false, error: 'That file is too big to link (25 MB max).' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  if ((await dailyCount(svc, me.companyId, 'file')) >= EXPORTS_PER_DAY) {
    return { ok: false, error: `That is ${EXPORTS_PER_DAY} export links today for the company — the daily ceiling. Tomorrow resets it.` }
  }
  // The link id doubles as the object name, so finalize can tie them without
  // trusting anything the client says beyond the path shape.
  const id = mintLinkId()
  const path = `${me.companyId}/exports/${id}.${kind}`
  const { data, error } = await svc.storage.from('exports').createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, path: data.path, token: data.token }
}

export async function finalizeExportAction(path: string, filename: string, title: string | null): Promise<
  { ok: true; id: string; url: string; fileUrl: string; expiresAt: string } | { ok: false; error: string }
> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  const m = new RegExp(`^${me.companyId}/exports/([23456789abcdefghjkmnpqrstuvwxyz]{12})\\.(gif|png|pdf)$`).exec(path)
  if (!m) return { ok: false, error: 'Bad upload path' }
  const id = m[1]
  const ext = m[2] as ExportKind

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  // The object must really be there, be the type it claims, and fit.
  const slash = path.lastIndexOf('/')
  const { data: objects } = await svc.storage.from('exports').list(path.slice(0, slash), { search: path.slice(slash + 1) })
  const obj = (objects ?? []).find((o) => o.name === path.slice(slash + 1))
  if (!obj) return { ok: false, error: 'Upload didn’t finish — try again.' }
  const meta = (obj.metadata as { size?: number; mimetype?: string } | null) ?? {}
  const uploadedType = String(meta.mimetype ?? '').split(';')[0].trim().toLowerCase()
  if ((meta.size ?? 0) > MAX_EXPORT_BYTES || uploadedType !== EXPORT_MIME[ext]) {
    await svc.storage.from('exports').remove([path])
    return { ok: false, error: uploadedType !== EXPORT_MIME[ext] ? 'That upload wasn’t the file it claimed to be.' : 'That file is too big to link (25 MB max).' }
  }

  // The name the download lands under: letters, digits, dot, dash, and the
  // right extension — never whatever the client typed.
  const safeName = (String(filename ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'hammertrack-export')
  const finalName = safeName.toLowerCase().endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`
  const expiresAt = new Date(Date.now() + FILE_LINK_DAYS * 86_400_000).toISOString()
  const { error: insErr } = await svc.from('share_links').insert({
    id,
    company_id: me.companyId,
    created_by: me.userId,
    kind: 'file',
    title: cleanTitle(title),
    payload: { path, filename: finalName, mime: EXPORT_MIME[ext], bytes: meta.size ?? null },
    expires_at: expiresAt,
  })
  if (insErr) {
    await svc.storage.from('exports').remove([path])
    return { ok: false, error: insErr.message.includes('relation') ? 'Links are still deploying — try again in a minute.' : 'Could not save the link.' }
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
  if ((await getMyPermissions()).viewingAs) return { ok: false, error: 'Leave “View as” first — nothing is shared from a preview.' }
  const view = cleanSharedView(input?.view)
  if (!view) return { ok: false, error: 'This screen could not be captured — move the map a little and try again.' }
  const title = cleanTitle(input?.title) ?? 'Map view'
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  if ((await dailyCount(svc, me.companyId, 'view')) >= VIEW_LINKS_PER_DAY) {
    return { ok: false, error: 'That is a lot of shared views for one day — the ceiling resets tomorrow.' }
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
  return { ok: true, id, url: shortLinkUrl(BRAND_DOMAIN, id), path: viewLinkPath(id), title }
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
 * person-to-person note never falls back to the whole company — and only to
 * people on this company's roster.
 */
export async function sendViewLinkAction(id: string, userIds: string[], note: string | null): Promise<
  { ok: true; sent: string[]; noPhone: string[] } | { ok: false; error: string }
> {
  if (isMock) return { ok: true, sent: ['Foreman (demo)'], noPhone: [] }
  const me = await caller()
  if (!me) return { ok: false, error: 'Sign in first.' }
  if ((await getMyPermissions()).viewingAs) return { ok: false, error: 'Leave “View as” first.' }
  if (!LINK_ID_RE.test(id)) return { ok: false, error: 'That link is not ours.' }
  const ids = Array.from(new Set((userIds ?? []).filter((u) => typeof u === 'string' && /^[0-9a-f-]{36}$/i.test(u)))).slice(0, MAX_RECIPIENTS)
  if (!ids.length) return { ok: false, error: 'Pick at least one teammate.' }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const [{ data: link }, { data: people }, { data: sender }] = await Promise.all([
    svc.from('share_links').select('id, title, kind, company_id').eq('id', id).eq('company_id', me.companyId).eq('kind', 'view').maybeSingle(),
    svc.from('profiles').select('id, name').eq('company_id', me.companyId).in('id', ids),
    svc.from('profiles').select('name').eq('id', me.userId).maybeSingle(),
  ])
  if (!link) return { ok: false, error: 'That view link is not yours to send.' }
  const roster = (people ?? []) as { id: string; name: string | null }[]
  if (!roster.length) return { ok: false, error: 'None of those people are on your team.' }

  const { sendPushToUser } = await import('@/lib/push')
  const from = cleanTitle(sender?.name, 40) ?? 'A teammate'
  const title = cleanTitle(link.title, 80) ?? 'Map view'
  const extra = cleanTitle(note, 140)
  const sent: string[] = []
  const noPhone: string[] = []
  for (const p of roster) {
    const name = (p.name ?? '').trim() || 'Teammate'
    const n = await sendPushToUser(me.companyId, p.id, {
      title: `${from} shared a map view`,
      body: extra ? `${title} — ${extra}` : title,
      url: viewLinkPath(id),
    }, { strict: true })
    if (n > 0) sent.push(name)
    else noPhone.push(name)
  }
  return { ok: true, sent, noPhone }
}
