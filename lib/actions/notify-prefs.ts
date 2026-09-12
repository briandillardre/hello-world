'use server'

import { revalidatePath } from 'next/cache'
import { verifyNotifyToken } from '@/lib/notify-token'
import { cleanDigestPrefs, resolveDigestPrefs, silenceAll, onlyQuieter, type DigestPrefs } from '@/lib/weekly-digest'

/**
 * Saving from the emailed / texted link — no session, no login.
 *
 * The token is the whole authorization (lib/notify-token.ts) and it names
 * exactly one company. Everything here is pinned to that id: the caller can
 * never pass a company, only a token we signed. What it can touch is one
 * column, digest_prefs, and the shape is sanitized by the same function the
 * signed-in Settings page uses, so an unsubscribe can't write a prefs blob
 * the app would choke on later.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

async function write(companyId: string, prefs: DigestPrefs): Promise<{ ok: boolean; error?: string }> {
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { error } = await createServiceClient()
    .from('companies').update({ digest_prefs: cleanDigestPrefs(prefs) }).eq('id', companyId)
  if (error) {
    console.error('notify prefs save failed', error.message)
    return { ok: false, error: 'Could not save that. Try again in a minute.' }
  }
  return { ok: true }
}

export async function saveNotifyPrefsByTokenAction(
  token: string,
  prefs: DigestPrefs,
): Promise<{ ok: boolean; error?: string; prefs?: DigestPrefs; clamped?: boolean }> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const p = verifyNotifyToken(token)
  if (!p) return { ok: false, error: 'This link has expired. Open Settings → Notifications in the app instead.' }
  // This link can only turn things DOWN — see onlyQuieter(). Turning a
  // summary back on is a signed-in action.
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data } = await createServiceClient().from('companies').select('digest_prefs').eq('id', p.companyId).maybeSingle()
  const wanted = resolveDigestPrefs(prefs)
  const applied = cleanDigestPrefs(onlyQuieter(resolveDigestPrefs(data?.digest_prefs), wanted))
  const res = await write(p.companyId, applied)
  if (!res.ok) return res
  revalidatePath(`/n/${token}`)
  // Hand back what was ACTUALLY stored so the page can never sit there
  // showing a switch the server refused (ship-check's "UI claims a state the
  // server doesn't have", applied to the clamp).
  return { ok: true, prefs: applied, clamped: JSON.stringify(applied) !== JSON.stringify(cleanDigestPrefs(wanted)) }
}

/** The big button: every recurring summary off, in one tap, from a text.
 *  Returns the resulting prefs so the page can re-render without a reload. */
export async function silenceAllByTokenAction(token: string): Promise<{ ok: boolean; error?: string; prefs?: DigestPrefs }> {
  if (isMock) return { ok: false, error: 'Demo mode — nothing is saved.' }
  const p = verifyNotifyToken(token)
  if (!p) return { ok: false, error: 'This link has expired. Open Settings → Notifications in the app instead.' }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data } = await db.from('companies').select('digest_prefs').eq('id', p.companyId).maybeSingle()
  const next = silenceAll(resolveDigestPrefs(data?.digest_prefs))
  const res = await write(p.companyId, next)
  if (!res.ok) return res
  revalidatePath(`/n/${token}`)
  return { ok: true, prefs: next }
}
