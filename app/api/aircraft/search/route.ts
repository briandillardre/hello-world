import { NextRequest, NextResponse } from 'next/server'
import { lookupAircraft, identFromTrace } from '@/lib/aircraft-source'
import { asHex, normalizeReg } from '@/lib/aircraft-log'
import { guard, isMock } from '../_guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

/**
 * Tail number → airframe. `?q=N628TS` or `?q=a835af`, because a person
 * should not have to know which of those they are holding.
 *
 * adsbdb answers both directions; an airframe it has never heard of (a fresh
 * registration, a lot of military) still gets an answer if it has been
 * transmitting, read straight off its own trace file.
 */
export async function GET(req: NextRequest) {
  const blocked = await guard(req, 'ac-search', 30)
  if (blocked) return blocked

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 3 || q.length > 12) {
    return NextResponse.json({ error: 'Type a tail number, like N628TS.' }, { status: 400 })
  }

  if (isMock) {
    return NextResponse.json({
      aircraft: { hex: 'a835af', reg: 'N628TS', typeCode: 'GLF6', desc: 'Demo aircraft', owner: 'Demo data — not a real flight history', year: null, manufacturer: null },
    })
  }

  try {
    let ident = await lookupAircraft(q)
    // Typed a raw hex that adsbdb does not carry? Its own broadcasts will say.
    if (!ident) {
      const hex = asHex(q.toLowerCase())
      if (hex) ident = await identFromTrace(hex)
    }
    if (!ident) {
      return NextResponse.json({
        aircraft: null,
        note: `No aircraft registered as ${normalizeReg(q)}.`,
      })
    }
    return NextResponse.json({ aircraft: ident })
  } catch {
    return NextResponse.json({ error: 'The aircraft registry did not answer. Try again.' }, { status: 503 })
  }
}
