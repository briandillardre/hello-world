import { NextRequest, NextResponse } from 'next/server'
import { lookupAircraft, identFromTrace } from '@/lib/aircraft-source'
import { asHex, normalizeReg } from '@/lib/aircraft-log'
import { findAirport } from '@/lib/airports'
import { guard, isMock } from '../_guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

/**
 * One search box, three kinds of answer (Brian, Sep 12, sending FR24's box:
 * "Flight number, airport, route or reg").
 *
 *   N628TS / a835af  → an aircraft. adsbdb answers both directions, because a
 *                      person should not have to know which they are holding;
 *                      an airframe it has never heard of still answers off
 *                      its own trace file.
 *   KGMU / GMU       → an airfield, handed back so the page can open its board.
 *   GMU-CLT          → a route between two fields.
 *
 * Aircraft is tried FIRST: a registration can look like an airport code
 * (N92 is both a tail number and a New Jersey field), and someone typing into
 * a flight log means the aeroplane.
 */
export async function GET(req: NextRequest) {
  const blocked = await guard(req, 'ac-search', 30)
  if (blocked) return blocked

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 3 || q.length > 12) {
    return NextResponse.json({ error: 'Type a tail number, an airfield or a route — N628TS, KGMU, GMU-CLT.' }, { status: 400 })
  }

  // A route: two field codes with anything sane between them.
  const route = /^([A-Z0-9]{3,4})\s*(?:-|–|—|>|to|\s)\s*([A-Z0-9]{3,4})$/i.exec(q)
  if (route) {
    const from = findAirport(route[1])
    const to = findAirport(route[2])
    if (from && to) return NextResponse.json({ kind: 'route', from, to })
  }

  if (isMock) {
    const demoField = findAirport(q)
    if (demoField && !/^N[0-9]/i.test(q)) return NextResponse.json({ kind: 'airport', field: demoField })
    return NextResponse.json({
      kind: 'aircraft',
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
      // Not an aeroplane — is it a place? Checked second so a tail number
      // that happens to spell an airport code still finds the aircraft.
      const field = findAirport(q)
      if (field) return NextResponse.json({ kind: 'airport', field })
      return NextResponse.json({
        aircraft: null,
        note: `Nothing found for ${normalizeReg(q)} — try a tail number, an airfield code, or a route like GMU-CLT.`,
      })
    }
    return NextResponse.json({ kind: 'aircraft', aircraft: ident })
  } catch {
    return NextResponse.json({ error: 'The aircraft registry did not answer. Try again.' }, { status: 503 })
  }
}
