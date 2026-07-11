'use server'

/**
 * Per-user profile preferences. Map views persist to profiles.map_views
 * (migration 012) so a user's saved views follow them across devices. The
 * client also keeps a localStorage copy, so a failed write (column missing,
 * offline) degrades to device-local instead of losing the save.
 */
export async function saveMapViewsAction(state: { views: unknown[]; defaultId: string | null }): Promise<boolean> {
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  // Bound the payload — a view snapshot is tiny; 20 is plenty of saves.
  const views = Array.isArray(state.views) ? state.views.slice(0, 20) : []
  const payload = { views, defaultId: state.defaultId ?? null }

  const service = createServiceClient()
  const { error } = await service.from('profiles').update({ map_views: payload }).eq('id', user.id)
  if (error) {
    // Most likely cause: migration 012 (map_views column) not applied yet.
    console.error('map views save failed', error)
    return false
  }
  return true
}
