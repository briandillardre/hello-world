import { cleanSharedView, LINK_ID_RE, type SharedView } from '../share-links'

/**
 * Read a shared VIEW link for the map page (migration 113). Runs on the
 * caller's own client, so row-level security is the company check: a link
 * from another company simply does not exist here.
 */
export interface OpenedViewLink {
  id: string
  title: string | null
  view: SharedView
  /** Who shared it — their profile name, when it is readable. */
  from: string | null
}

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function getViewLink(id: string): Promise<OpenedViewLink | null> {
  if (isMock || !LINK_ID_RE.test(id)) return null
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: row, error } = await supabase
      .from('share_links')
      .select('id, title, payload, created_by, expires_at')
      .eq('id', id)
      .eq('kind', 'view')
      .maybeSingle()
    if (error || !row) return null
    const exp = row.expires_at ? Date.parse(row.expires_at as string) : NaN
    if (Number.isFinite(exp) && exp < Date.now()) return null
    // Re-validated on the way out: the row was written by our own action,
    // but the map applies this straight to its state, and a stored blob is
    // never trusted more than a fresh one.
    const view = cleanSharedView(row.payload)
    if (!view) return null
    let from: string | null = null
    if (row.created_by) {
      const { data: p } = await supabase.from('profiles').select('name').eq('id', row.created_by as string).maybeSingle()
      from = (p?.name as string | null)?.trim() || null
    }
    return { id: row.id as string, title: (row.title as string | null) ?? null, view, from }
  } catch {
    return null
  }
}
