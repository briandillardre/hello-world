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
    // Deleting the COMPANY is an owner/admin act — a crew login must never
    // be able to file it (sec-check, Aug 22). Same role source as the rest
    // of the app; company founders (id === company_id) count as admins.
    const { data: profile } = await svc.from('profiles')
      .select('role, company_id').eq('id', user.id).maybeSingle()
    if (!(profile?.role === 'admin' || user.id === companyId)) {
      return { ok: false, error: 'Only a company admin can request account deletion.' }
    }

    // One open request per company — repeat calls must not spam the queue.
    const { data: open } = await svc.from('account_deletion_requests')
      .select('id').eq('company_id', companyId).is('completed_at', null).limit(1)
    if (open?.length) return { ok: true }

    const { error } = await svc.from('account_deletion_requests').insert({
      company_id: companyId,
      user_id: user.id,
      email: user.email ?? '',
    })
    if (error) return { ok: false, error: 'Could not file the request — email support@hammertrack.ai instead.' }

    // Alert support so the 30-day clock is honored (best-effort). Role +
    // company name included so the queue processor can sanity-check the
    // requester before erasing a company.
    try {
      const key = process.env.RESEND_API_KEY
      if (key) {
        const { data: co } = await svc.from('companies').select('name').eq('id', companyId).maybeSingle()
        const who = user.id === companyId ? 'owner' : (profile?.role ?? 'unknown role')
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM ?? 'HammerTrack <team@hammertrack.ai>',
            to: 'support@hammertrack.ai',
            subject: `Account deletion requested: ${user.email}`,
            text: `User ${user.email} (${user.id}, ${who}) requested deletion of company "${co?.name ?? companyId}" (${companyId}). Complete within 30 days per the privacy policy.`,
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
