import { NextRequest, NextResponse } from 'next/server'
import { ipRateLimited } from '@/lib/rate-limit'

/**
 * Shared gate for the flight-log routes.
 *
 * Every one of them spends somebody else's free API on our behalf, so none
 * is open to the world: signed in, rate limited, and the aircraft identifier
 * is shape-checked before it is ever interpolated into an upstream URL.
 */

export const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Returns a response to send back, or null when the caller may proceed. */
export async function guard(req: NextRequest, tag: string, limit = 40): Promise<NextResponse | null> {
  if (ipRateLimited(req, tag, limit)) {
    return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 })
  }
  if (isMock) return null
  const { createClient } = await import('@/lib/supabase-server')
  const { data } = await createClient().auth.getUser()
  if (!data?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return null
}

/** An icao24 hex or nothing — this string reaches adsb.lol's URL path. */
export const safeHex = (v: string | null): string | null => {
  const h = (v ?? '').trim().toLowerCase()
  return /^[0-9a-f]{6}$/.test(h) ? h : null
}
