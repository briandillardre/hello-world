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
}
