// Brain Ball — parent account + cloud sync for kid profiles.
//
// Uses the site's existing Supabase auth (Google OAuth + email/password).
// When Supabase isn't configured (demo mode) everything stays in
// localStorage and the account card explains what will light up later.

import type { KidProfile } from './types'

// computed locally (not imported from lib/supabase) so the Supabase client
// stays out of the bundle until someone actually signs in
export const cloudEnabled =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://your-project.supabase.co'

type SupabaseClient = ReturnType<typeof import('@/lib/supabase').createClient>
let client: SupabaseClient | null = null

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!cloudEnabled) return null
  if (!client) {
    const { createClient } = await import('@/lib/supabase')
    client = createClient()
  }
  return client
}

export interface ParentSession {
  email: string
  userId: string
}

export async function getParentSession(): Promise<ParentSession | null> {
  const supabase = await getSupabase()
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  return u ? { email: u.email ?? '', userId: u.id } : null
}

export async function signInWithGoogle(): Promise<string | null> {
  const supabase = await getSupabase()
  if (!supabase) return 'Cloud accounts are not connected yet.'
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/play` },
  })
  return error ? error.message : null
}

export async function signInWithEmail(email: string, password: string, create: boolean): Promise<string | null> {
  const supabase = await getSupabase()
  if (!supabase) return 'Cloud accounts are not connected yet.'
  const { error } = create
    ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/play` } })
    : await supabase.auth.signInWithPassword({ email, password })
  return error ? error.message : null
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase()
  await supabase?.auth.signOut()
}

// ------------------------------------------------------------------ profiles

export async function fetchCloudProfiles(): Promise<KidProfile[] | null> {
  const supabase = await getSupabase()
  if (!supabase) return null
  const session = await getParentSession()
  if (!session) return null
  const { data, error } = await supabase.from('brainball_profiles').select('payload').eq('user_id', session.userId).maybeSingle()
  if (error || !data?.payload?.profiles) return null
  return data.payload.profiles as KidProfile[]
}

export async function pushCloudProfiles(profiles: KidProfile[]): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const session = await getParentSession()
  if (!session) return false
  const { error } = await supabase
    .from('brainball_profiles')
    .upsert({ user_id: session.userId, payload: { profiles }, updated_at: new Date().toISOString() })
  return !error
}

/**
 * Merge local + cloud per kid: whichever copy has answered more questions
 * wins (history length is the best proxy for "more play recorded"); kids
 * that exist on only one side are kept.
 */
export function mergeProfiles(local: KidProfile[], cloud: KidProfile[]): KidProfile[] {
  const byId = new Map<string, KidProfile>()
  for (const p of cloud) byId.set(p.id, p)
  for (const p of local) {
    const c = byId.get(p.id)
    if (!c || p.history.length >= c.history.length) byId.set(p.id, p)
  }
  return Array.from(byId.values())
}
