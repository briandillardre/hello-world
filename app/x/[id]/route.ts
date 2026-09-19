import { NextRequest, NextResponse } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'
import { LINK_ID_RE, FILE_LINK_DAYS } from '@/lib/share-links'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * hammertrack.ai/x/<id> — the one short link shape for everything shared out
 * of the map (migration 113).
 *
 *   • a FILE link (GIF / PNG / PDF export) redirects to a fresh 10-minute
 *     signed URL that downloads the file. Public by link, dead after 30 days.
 *   • a VIEW link redirects into the app (/map?v=<id>); the dashboard's own
 *     login gate and the company RLS on share_links take it from there.
 *
 * No login here by design (a GIF is meant to reach a client or a claim), so
 * the id is the whole secret: 12 chars of a 31-letter alphabet, and every
 * miss costs one indexed read behind a per-IP limiter.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (ipRateLimited(req, 'xlink', 60)) return new NextResponse('Too many requests', { status: 429 })
  const id = params.id
  if (isMock || !LINK_ID_RE.test(id)) return gone()

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: row } = await svc.from('share_links')
    .select('kind, payload, expires_at, opens')
    .eq('id', id)
    .maybeSingle()
  if (!row) return gone()
  const exp = row.expires_at ? Date.parse(row.expires_at as string) : NaN
  if (Number.isFinite(exp) && exp < Date.now()) return gone()

  // Best-effort open counter — a lost increment is not worth a slow redirect.
  void svc.from('share_links').update({ opens: ((row.opens as number) ?? 0) + 1 }).eq('id', id).then(() => undefined, () => undefined)

  if (row.kind === 'view') {
    // Into the app. A signed-out teammate goes through /login with the view
    // as the return path (the login page honours a same-site ?next=), so the
    // link they were texted still lands on the screen it named.
    const path = `/map?v=${encodeURIComponent(id)}`
    let signedIn = false
    try {
      const { createClient } = await import('@/lib/supabase-server')
      signedIn = !!(await createClient().auth.getUser()).data.user
    } catch { /* treat as signed out */ }
    const to = signedIn ? path : `/login?next=${encodeURIComponent(path)}`
    return NextResponse.redirect(new URL(to, req.nextUrl.origin), 302)
  }

  const p = (row.payload ?? {}) as { path?: unknown; filename?: unknown }
  if (typeof p.path !== 'string' || !/^[0-9a-f-]{36}\/exports\/[a-z0-9]{12}\.(gif|png|pdf)$/i.test(p.path)) return gone()
  const filename = typeof p.filename === 'string' && p.filename ? p.filename : p.path.slice(p.path.lastIndexOf('/') + 1)
  const { data: signed, error } = await svc.storage.from('exports').createSignedUrl(p.path, 600, { download: filename })
  if (error || !signed?.signedUrl) return gone()
  return NextResponse.redirect(signed.signedUrl, 302)
}

function gone(): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link expired · HammerTrack</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1420;color:#e6edf3;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px}h1{font-size:19px;margin:0 0 8px}p{margin:0;color:#9fb0c0;max-width:34ch}</style></head>
<body><div><h1>This link has expired</h1><p>Shared files stay live for ${FILE_LINK_DAYS} days. Ask whoever sent it to share a fresh one.</p></div></body></html>`
  return new NextResponse(html, { status: 410, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
