'use server'

/**
 * Persist the caller's bottom-bar order to their profile so it follows them
 * to any phone (Brian, Aug 22). Service-role write — profiles UPDATE is
 * revoked from authenticated (migration 068) — so the shape is validated
 * hard here and the row filter is always the caller's own id.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const HREF_RE = /^\/[a-z0-9-]{1,32}$/

export async function saveNavOrderAction(order: string[]): Promise<{ ok: boolean }> {
  if (isMock) return { ok: true }
  if (!Array.isArray(order) || order.length === 0 || order.length > 32) return { ok: false }
  const clean = Array.from(new Set(order.filter((h) => typeof h === 'string' && HREF_RE.test(h))))
  if (!clean.length) return { ok: false }
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    if (!user) return { ok: false }
    // Tolerates the column not existing yet (pre-070 deploys) — the nav
    // falls back to localStorage until the migration lands.
    const { error } = await createServiceClient()
      .from('profiles').update({ nav_order: clean }).eq('id', user.id)
    return { ok: !error }
  } catch {
    return { ok: false }
  }
}
