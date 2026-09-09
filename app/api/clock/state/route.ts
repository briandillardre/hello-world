import { NextResponse } from 'next/server'
import { getMyClockState } from '@/lib/db/fieldops'

export const dynamic = 'force-dynamic'

/**
 * Am I clocked in? The shell-level shift tracker asks this on load, every
 * minute, and whenever the clock card fires `ht:clock` — while the answer is
 * yes the phone's location is recorded for the shift (Brian, Sep 9:
 * "mandatory tracking thru app while clocked in"). Session-scoped: it only
 * ever answers about the caller.
 */
export async function GET() {
  try {
    const { openEntry, available, userId } = await getMyClockState()
    if (!available || !openEntry) return NextResponse.json({ open: false, entry: null, uid: userId })
    return NextResponse.json({
      open: true,
      uid: userId,
      entry: {
        id: openEntry.id,
        since: openEntry.clock_in_at,
        category: openEntry.category,
        zoneId: openEntry.project_geofence_id,
      },
    })
  } catch {
    return NextResponse.json({ open: false, entry: null })
  }
}
