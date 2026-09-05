/**
 * "Where is it" labels — the pure half, safe in the browser. The server half
 * (lib/reverse-geocode.ts) fills the parts from our zones' polygons or a
 * reverse geocoder; this file only names cells and words the answer.
 *
 * Brian, Sep 4 2026 (assets list): "first in geofence sites or zones, then if
 * they are not there default to a close address, if that is not available let
 * me know what city they are in and State."
 *
 *   at Creekside Phase 2                — inside one of the company's zones
 *   near 304 N Church St, Greenville    — street-level fix from the geocoder
 *   in Greenville, SC                   — city + state when no street is known
 */

export interface PlaceParts {
  street: string | null
  city: string | null
  state: string | null
}

/** ~100 m cell: parked GPS jitter (±10 m) stays in one cell, so a lot that
 *  trucks return to is geocoded once. Same rounding on both ends of the API. */
export const placeKey = (lat: number, lng: number): string => `${lat.toFixed(3)},${lng.toFixed(3)}`

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
}

/** "South Carolina" → "SC" for US points (already-short codes pass through);
 *  other countries keep the region name as given. */
export function abbrState(state: string | null | undefined, countryCode?: string | null): string | null {
  if (!state) return null
  const s = String(state).trim()
  if (!s) return null
  const us = !countryCode || /^us$/i.test(countryCode)
  if (us) {
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
    const hit = US_STATES[s.toLowerCase()]
    if (hit) return hit
  }
  return s
}

/** Common OSM street-type words, shortened the way a mailing label does —
 *  a phone row has ~34 characters. */
const STREET_ABBR: [RegExp, string][] = [
  [/\bStreet\b/g, 'St'], [/\bAvenue\b/g, 'Ave'], [/\bBoulevard\b/g, 'Blvd'], [/\bRoad\b/g, 'Rd'], [/\bDrive\b/g, 'Dr'],
  [/\bHighway\b/g, 'Hwy'], [/\bParkway\b/g, 'Pkwy'], [/\bLane\b/g, 'Ln'], [/\bCourt\b/g, 'Ct'], [/\bCircle\b/g, 'Cir'],
  [/\bPlace\b/g, 'Pl'], [/\bTerrace\b/g, 'Ter'], [/\bTrail\b/g, 'Trl'], [/\bTurnpike\b/g, 'Tpke'], [/\bExpressway\b/g, 'Expy'],
  [/\bNorth\b/g, 'N'], [/\bSouth\b/g, 'S'], [/\bEast\b/g, 'E'], [/\bWest\b/g, 'W'],
]
export function shortStreet(street: string): string {
  let s = street
  for (const [re, to] of STREET_ABBR) s = s.replace(re, to)
  return s
}

/** The sentence fragment the list shows, or null when nothing is known. */
export function formatPlace(p: PlaceParts | null | undefined): string | null {
  if (!p) return null
  const street = p.street ? shortStreet(p.street) : null
  if (street && p.city) return `near ${street}, ${p.city}`
  if (street) return `near ${street}`
  if (p.city && p.state) return `in ${p.city}, ${p.state}`
  if (p.city) return `in ${p.city}`
  if (p.state) return `in ${p.state}`
  return null
}
