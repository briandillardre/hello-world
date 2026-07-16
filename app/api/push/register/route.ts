import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Register a native-push device token for the signed-in user's company. Called
 * by the Capacitor app when it gets its FCM/APNs token. Auth = the user's own
 * session (RLS scopes the write to their company). Upsert on token so a
 * re-register just refreshes last_seen.
 */
export async function POST(req: NextRequest) {
  const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
  if (isMock) return NextResponse.json({ ok: true, mode: 'demo' })

  let body: { token?: string; platform?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const token = (body.token ?? '').trim()
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 422 })
  const platform = ['ios', 'android', 'web'].includes(body.platform ?? '') ? body.platform : null

  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).maybeSingle()
    const companyId = profile?.company_id ?? user.id

    const { error } = await supabase.from('device_tokens').upsert(
      { company_id: companyId, user_id: user.id, platform, token, last_seen: new Date().toISOString() },
      { onConflict: 'token' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
