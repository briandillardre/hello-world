import { MOCK_COMPANY } from '../mock-data'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Resolve the company id for the current request.
 *
 * Demo mode: the single mock company. Real mode: the logged-in user's company,
 * read from their profile (registration sets companies.id = profiles.company_id
 * = auth.users.id). Falls back to the mock id when there's no session so server
 * pages render an empty (RLS-protected) shell instead of throwing.
 */
export async function getCurrentCompanyId(): Promise<string> {
  if (isMock) return MOCK_COMPANY.id

  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return MOCK_COMPANY.id

    const { data } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single()

    return data?.company_id ?? user.id
  } catch {
    return MOCK_COMPANY.id
  }
}

/**
 * Current company id + display name + the signed-in user's name, for the
 * sidebar header. Demo mode shows the "HammerTrack Demo" label; real mode shows
 * the logged-in company and user.
 */
export async function getCurrentCompany(): Promise<{ id: string; name: string; userName: string | null }> {
  if (isMock) return { id: MOCK_COMPANY.id, name: 'HammerTrack Demo', userName: null }

  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { id: MOCK_COMPANY.id, name: 'HammerTrack Demo', userName: null }

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, name')
      .eq('id', user.id)
      .single()
    const companyId = profile?.company_id ?? user.id

    const { data: company } = await supabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()

    return {
      id: companyId,
      name: company?.name ?? 'HammerTrack',
      userName: profile?.name || user.email || null,
    }
  } catch {
    return { id: MOCK_COMPANY.id, name: 'HammerTrack', userName: null }
  }
}
