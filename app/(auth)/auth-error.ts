/** Translate raw auth/network errors into human, brand-safe messages.
 *  Raw Supabase strings ("Auth session missing!", "Failed to fetch") must
 *  never reach the red alert box — the raw error goes to the console instead. */
export const EXPIRED_LINK_MESSAGE =
  'This reset link is invalid or has expired — request a new one below.'

export function mapAuthError(err: unknown): string {
  const raw =
    typeof err === 'string' ? err :
    err instanceof Error ? err.message :
    (err as { message?: string } | null | undefined)?.message ?? String(err)

  console.error('auth error:', err)

  if (/failed to fetch|network ?error|load failed|fetch failed|networkerror/i.test(raw)) {
    return "Can't reach HammerTrack — check your connection and try again."
  }
  if (/invalid login credentials/i.test(raw)) {
    return 'Wrong email or password.'
  }
  if (/auth session missing/i.test(raw)) {
    return EXPIRED_LINK_MESSAGE
  }
  if (/already registered|already been registered/i.test(raw)) {
    return 'That email already has an account — sign in instead.'
  }
  return 'Something went wrong — try again.'
}
