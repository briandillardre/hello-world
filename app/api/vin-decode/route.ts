import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * VIN → specs via NHTSA vPIC — the U.S. government's free decoder (no key,
 * no rate cap that matters at our scale, maintained by the feds). Feeds the
 * asset form's "Decode VIN" button so a truck's year/make/model/engine fill
 * themselves instead of being typed.
 */
export async function GET(req: NextRequest) {
  const vin = (req.nextUrl.searchParams.get('vin') ?? '').trim().toUpperCase()
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) {
    return NextResponse.json({ error: 'That does not look like a VIN.' }, { status: 400 })
  }
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
      { next: { revalidate: 86400 } }
    )
    if (!res.ok) return NextResponse.json({ error: 'Decoder unavailable.' }, { status: 502 })
    const j = await res.json()
    const r = j?.Results?.[0] ?? {}
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() && v !== 'Not Applicable' ? v.trim() : null)

    const year = pick(r.ModelYear)
    const make = pick(r.Make)
    const model = pick(r.Model)
    if (!make && !model) return NextResponse.json({ error: 'VIN not found in the NHTSA database.' }, { status: 404 })

    // Keys become the asset's metadata rows (auto-rendered on the detail page).
    const specs: Record<string, string> = {}
    if (year) specs.year = year
    if (make) specs.make = make.replace(/\b\w+/g, (w: string) => w[0] + w.slice(1).toLowerCase())
    if (model) specs.model = model
    const trim = pick(r.Trim) ?? pick(r.Series)
    if (trim) specs.trim = trim
    if (pick(r.DriveType)) specs.drive = (r.DriveType as string).split('/')[0].trim()
    const disp = pick(r.DisplacementL)
    const cyl = pick(r.EngineCylinders)
    if (disp || cyl) specs.engine = [disp ? `${Number(disp).toFixed(1)}L` : null, cyl ? `${cyl}-cyl` : null].filter(Boolean).join(' ')
    if (pick(r.EngineHP)) specs.horsepower = `${r.EngineHP} hp`
    if (pick(r.FuelTypePrimary)) specs.fuel = r.FuelTypePrimary
    if (pick(r.GVWR)) specs.gvwr = (r.GVWR as string).split('(')[0].trim()
    if (pick(r.BodyClass)) specs.body = r.BodyClass

    const suggestedName = [year, specs.make, model].filter(Boolean).join(' ')
    return NextResponse.json(
      { specs, suggestedName },
      { headers: { 'Cache-Control': 'public, max-age=86400' } }
    )
  } catch {
    return NextResponse.json({ error: 'Decoder unavailable.' }, { status: 502 })
  }
}
