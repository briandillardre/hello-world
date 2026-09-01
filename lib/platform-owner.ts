const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * True only for HammerTrack-the-company's own people. The operating model
 * (/model) is HammerTrack's forward P&L — a founder tool, not a customer
 * feature, so it never renders for customer companies or the public demo
 * (Brian, Aug 22: "not a DCG item").
 *
 * PLATFORM_OWNER_EMAILS (comma-separated, Vercel env) is the allow-list;
 * unset, it falls back to @hammertrack.ai addresses so the founder isn't
 * locked out before the var exists. Emails stay in env, never in the repo.
 */
export async function isPlatformOwner(): Promise<boolean> {
  if (isMock) return false
  try {
    const { createClient } = await import('./supabase-server')
    const { data: { user } } = await createClient().auth.getUser()
    const email = user?.email?.toLowerCase() ?? ''
    if (!email) return false

    // An UNVERIFIED address is just a string the user typed. GoTrue lets a
    // signed-in user change their own email, so without this check anyone
    // could claim an @hammertrack.ai address and walk into the founder-only
    // pages (sec-check, Aug 28). Confirmation is what makes the claim mean
    // something.
    if (!user?.email_confirmed_at) return false

    const listed = (process.env.PLATFORM_OWNER_EMAILS ?? '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (listed.length) return listed.includes(email)

    // Fallback while PLATFORM_OWNER_EMAILS is unset: the founder's own
    // address, exactly. Until Sep 1 any confirmed @hammertrack.ai mailbox
    // (the reviewer account included) could open /board and /model — the
    // production sweep walked straight in. Set PLATFORM_OWNER_EMAILS in
    // Vercel and this branch becomes dead code.
    return email === 'brian@hammertrack.ai'
  } catch {
    return false
  }
}
