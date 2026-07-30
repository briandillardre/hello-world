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

/**
 * Company preferences + the caller's role, for the map's weather panel.
 * weatherPlace null = follow the fleet. isAdmin gates the "save default" star.
 */
export async function getCompanyPrefs(): Promise<{ weatherPlace: string | null; weatherCoords: { lat: number; lng: number } | null; isAdmin: boolean }> {
  if (isMock) return { weatherPlace: null, weatherCoords: null, isAdmin: false }

  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { weatherPlace: null, weatherCoords: null, isAdmin: false }

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .single()
    const companyId = profile?.company_id ?? user.id

    const { data: company } = await supabase
      .from('companies')
      .select('weather_place')
      .eq('id', companyId)
      .single()

    // Newer saves are JSON {name, lat, lng} — exact point, no re-geocode.
    // Older saves are the bare place name (coords unknown).
    let weatherPlace: string | null = company?.weather_place ?? null
    let weatherCoords: { lat: number; lng: number } | null = null
    if (weatherPlace?.startsWith('{')) {
      try {
        const parsed = JSON.parse(weatherPlace)
        if (typeof parsed?.name === 'string') weatherPlace = parsed.name
        if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') {
          weatherCoords = { lat: parsed.lat, lng: parsed.lng }
        }
      } catch { /* not JSON after all — treat as a plain name */ }
    }

    return {
      weatherPlace,
      weatherCoords,
      isAdmin: profile?.role === 'admin' || user.id === companyId,
    }
  } catch {
    return { weatherPlace: null, weatherCoords: null, isAdmin: false }
  }
}

/**
 * Full company settings for the Settings page: name, plan, working hours, and
 * whether the caller may edit. Demo mode returns the mock company (read-only).
 */
export async function getCompanySettings(): Promise<{
  name: string; plan: string; work_start: string; work_end: string; work_days: number[];
  alert_phone: string; alert_email: string;
  sms_consent_phone: string | null; sms_consent_at: string | null;
  isAdmin: boolean
}> {
  const fallback = {
    name: MOCK_COMPANY.name, plan: MOCK_COMPANY.plan,
    work_start: MOCK_COMPANY.work_start, work_end: MOCK_COMPANY.work_end,
    work_days: MOCK_COMPANY.work_days, alert_phone: '', alert_email: '',
    sms_consent_phone: null, sms_consent_at: null, isAdmin: false,
  }
  if (isMock) return fallback
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fallback
    const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
    const companyId = profile?.company_id ?? user.id
    // select('*') — naming a column that a pending migration hasn't added yet
    // (alert_phone/alert_email, migration 009) errors the WHOLE query, and the
    // page then demo-fallbacked for a signed-in admin. Star-select degrades to
    // undefined fields instead.
    const { data: c } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single()
    if (!c) return fallback
    return {
      name: c.name ?? 'HammerTrack',
      plan: c.plan ?? 'starter',
      work_start: c.work_start ?? '07:00',
      work_end: c.work_end ?? '17:00',
      work_days: c.work_days ?? [1, 2, 3, 4, 5, 6],
      alert_phone: c.alert_phone ?? '',
      alert_email: c.alert_email ?? '',
      // undefined until migration 041 lands — star-select tolerates that.
      sms_consent_phone: (c.sms_consent_phone as string | null) ?? null,
      sms_consent_at: (c.sms_consent_at as string | null) ?? null,
      isAdmin: profile?.role === 'admin' || user.id === companyId,
    }
  } catch {
    return fallback
  }
}

/** The caller's role in their company, for gating edit actions. Demo = viewer
 *  (read-only); a logged-out or errored lookup defaults to viewer. */
export async function getMyRole(): Promise<'admin' | 'manager' | 'foreman' | 'viewer'> {
  if (isMock) return 'admin' // demo is a full-featured showcase (nothing persists)
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'viewer'
    const { data } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
    if (data?.role === 'admin' || user.id === (data?.company_id ?? user.id)) return 'admin'
    return (data?.role as 'admin' | 'manager' | 'foreman' | 'viewer') ?? 'viewer'
  } catch { return 'viewer' }
}

/**
 * The current user's saved map views ({views, defaultId}) from their profile.
 * Null in demo mode, when logged out, or before migration 012 — the client
 * falls back to device-local saves.
 */
export async function getMyMapViews(): Promise<{ views: unknown[]; defaultId: string | null } | null> {
  if (isMock) return null
  try {
    const { createClient } = await import('../supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('profiles')
      .select('map_views')
      .eq('id', user.id)
      .single()
    const mv = data?.map_views
    if (mv && Array.isArray(mv.views)) return { views: mv.views, defaultId: mv.defaultId ?? null }
    return null
  } catch {
    return null
  }
}
