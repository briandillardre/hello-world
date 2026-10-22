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
  pushUnlockedFor = null // a different account may come back — require a fresh pull
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/play` },
  })
  if (!error) return null
  // raw Supabase provider errors read as gibberish to a parent
  return /not enabled|unsupported provider/i.test(error.message)
    ? 'Google sign-in isn’t switched on yet — use your email and a password below instead.'
    : error.message
}

export async function signInWithEmail(email: string, password: string, create: boolean): Promise<string | null> {
  const supabase = await getSupabase()
  if (!supabase) return 'Cloud accounts are not connected yet.'
  pushUnlockedFor = null // switching accounts must re-earn the push lock
  const { error } = create
    ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/play` } })
    : await supabase.auth.signInWithPassword({ email, password })
  return error ? error.message : null
}

export async function signOut(): Promise<void> {
  pushUnlockedFor = null
  const supabase = await getSupabase()
  await supabase?.auth.signOut()
}

// ------------------------------------------------------------------ profiles

// Pushing is locked until the SAME signed-in user has had a successful cloud
// READ this session. Without this, a signed-in device with empty localStorage
// (new phone, post-OAuth redirect, transient fetch error) — or a push timer
// racing an account switch — would upsert the wrong profiles over a family's
// real backup.
let pushUnlockedFor: string | null = null

export interface CloudFetch {
  /** true only when the query succeeded (profiles may still be null = no row yet) */
  ok: boolean
  profiles: KidProfile[] | null
}

export async function fetchCloudProfiles(): Promise<CloudFetch> {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, profiles: null }
  const session = await getParentSession()
  if (!session) return { ok: false, profiles: null }
  const { data, error } = await supabase.from('brainball_profiles').select('payload').eq('user_id', session.userId).maybeSingle()
  if (error) return { ok: false, profiles: null }
  pushUnlockedFor = session.userId
  const profiles = (data?.payload as { profiles?: KidProfile[] } | null)?.profiles ?? null
  return { ok: true, profiles }
}

export async function pushCloudProfiles(profiles: KidProfile[]): Promise<boolean> {
  const supabase = await getSupabase()
  if (!supabase) return false
  const session = await getParentSession()
  if (!session || session.userId !== pushUnlockedFor) return false
  const { error } = await supabase
    .from('brainball_profiles')
    .upsert({ user_id: session.userId, payload: { profiles }, updated_at: new Date().toISOString() })
  return !error
}

/** pull → merge → push; returns the merged profiles, or null if signed out / fetch failed */
export async function syncWithCloud(local: KidProfile[]): Promise<KidProfile[] | null> {
  const res = await fetchCloudProfiles()
  if (!res.ok) return null
  const merged = res.profiles ? mergeProfiles(local, res.profiles) : local
  await pushCloudProfiles(merged)
  return merged
}

/**
 * "More play recorded" signal for merges. Total attempts is monotonic and
 * NOT capped (unlike history, which trims to 500 and made length comparisons
 * meaningless once both sides saturated); xp breaks ties.
 */
const playSignal = (p: KidProfile) => Object.values(p.skills).reduce((a, s) => a + s.attempts, 0) * 10000 + p.xp

/** merge local + cloud per kid: the copy with more recorded play wins (local on ties) */
export function mergeProfiles(local: KidProfile[], cloud: KidProfile[]): KidProfile[] {
  const byId = new Map<string, KidProfile>()
  for (const p of cloud) byId.set(p.id, p)
  for (const p of local) {
    const c = byId.get(p.id)
    if (!c || playSignal(p) >= playSignal(c)) byId.set(p.id, p)
  }
  return Array.from(byId.values())
}
