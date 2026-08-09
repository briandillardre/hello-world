'use server'

/**
 * Account deletion request — the in-app entry point Apple requires
 * (guideline 5.1.1(v)) and the privacy policy promises ("deletion within
 * 30 days"). Files the request, alerts support, and the client signs the
 * user out. Completion runs against the request queue.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function requestAccountDeletionAction(): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode has no accounts to delete.' }
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }
    const { getCurrentCompanyId } = await import('@/lib/db/company')
    const companyId = await getCurrentCompanyId()

    const svc = createServiceClient()
    const { error } = await svc.from('account_deletion_requests').insert({
      company_id: companyId,
      user_id: user.id,
      email: user.email ?? '',
    })
    if (error) return { ok: false, error: 'Could not file the request — email support@hammertrack.ai instead.' }

    // Alert support so the 30-day clock is honored (best-effort).
    try {
      const key = process.env.RESEND_API_KEY
      if (key) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM ?? 'HammerTrack <team@hammertrack.ai>',
            to: 'support@hammertrack.ai',
            subject: `Account deletion requested: ${user.email}`,
            text: `User ${user.email} (${user.id}) requested account deletion. Complete within 30 days per the privacy policy.`,
          }),
          signal: AbortSignal.timeout(8000),
        })
      }
    } catch { /* the request row is the source of truth */ }

    return { ok: true }
  } catch {
    return { ok: false, error: 'Something went wrong — email support@hammertrack.ai.' }
  }
}
