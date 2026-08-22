'use server'

import { revalidatePath } from 'next/cache'
import { generateApiKey } from '@/lib/utils'

/**
 * Rotate the company's tracker/ingest API key. Admin-only. The old key stops
 * authenticating the moment the row updates — direct-API integrations must be
 * repointed at the new key (shipped HammerTrack trackers ride the flespi
 * pipeline and never use this key, so they're unaffected).
 *
 * The full key is never returned from this action and never logged — the
 * Settings card re-reads it server-side (admin-gated) after revalidation.
 */

// Demo mode — no Supabase behind this action; fail shaped, never throw a 500.
const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Resolve caller → { userId, companyId, isAdmin } using the anon client. */
async function ctx() {
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  const companyId = me?.company_id ?? user.id
  const isAdmin = me?.role === 'admin' || user.id === companyId
  return { userId: user.id, companyId, isAdmin }
}

export async function rotateApiKeyAction(): Promise<
  { ok: true; masked: string } | { ok: false; error: string }
> {
  if (isMock) return { ok: false, error: 'Demo mode — sign up to get a rotatable key.' }
  const c = await ctx()
  if (!c) return { ok: false, error: 'Not signed in.' }
  if (!c.isAdmin) return { ok: false, error: 'Only company admins can rotate the API key.' }

  const key = generateApiKey()
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { error } = await createServiceClient()
      .from('companies')
      .update({ api_key: key })
      .eq('id', c.companyId)
    if (error) return { ok: false, error: 'Could not rotate the key. Try again.' }
    revalidatePath('/settings')
    return { ok: true, masked: `${key.slice(0, 3)}…${key.slice(-4)}` }
  } catch {
    return { ok: false, error: 'Could not rotate the key. Try again.' }
  }
}
