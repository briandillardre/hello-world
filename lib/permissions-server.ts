import { resolvePermissions, ROLE_DEFAULTS, type Permissions } from './permissions'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Server-side: the CALLER's resolved permissions. Demo = full admin
 *  (nothing persists); logged-out or error = viewer. */
export async function getMyPermissions(): Promise<Permissions> {
  if (isMock) return { role: 'admin', ...ROLE_DEFAULTS.admin }
  try {
    const { createClient } = await import('./supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { role: 'viewer', ...ROLE_DEFAULTS.viewer }
    // Migration-tolerant: if 011 isn't applied yet the override columns don't
    // exist and the wide select errors — fall back to role-only so nobody gets
    // silently locked out of features they had yesterday.
    const wide = await supabase
      .from('profiles')
      .select('company_id, role, can_view_costs, can_manage_billing, can_manage_team')
      .eq('id', user.id)
      .maybeSingle()
    const data = wide.error
      ? (await supabase.from('profiles').select('company_id, role').eq('id', user.id).maybeSingle()).data as typeof wide.data
      : wide.data
    // Company founder (profile.company_id === own id, or no profile yet) = owner.
    const isOwner = !data || user.id === (data.company_id ?? user.id)
    return resolvePermissions(data, isOwner)
  } catch {
    return { role: 'viewer', ...ROLE_DEFAULTS.viewer }
  }
}
