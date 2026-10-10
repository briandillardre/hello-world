/**
 * Stockpile change over time — pure. The same pile measured on a later
 * survey is a new row with the same name; this groups them (name, case and
 * spacing ignored) and says how much the newest differs from the one before.
 */
export interface PileLike { id: string; name: string; measuredOn: string; results: { cy: number } }

export interface PileHistory<T extends PileLike> {
  name: string
  latest: T
  /** Newest first. */
  all: T[]
  changeCy: number | null
  prevOn: string | null
}

export function pileHistory<T extends PileLike>(piles: T[]): PileHistory<T>[] {
  const groups = new Map<string, T[]>()
  for (const p of piles) {
    const key = p.name.trim().toLowerCase().replace(/\s+/g, ' ')
    const g = groups.get(key)
    if (g) g.push(p)
    else groups.set(key, [p])
  }
  const out: PileHistory<T>[] = []
  for (const g of Array.from(groups.values())) {
    g.sort((a, b) => b.measuredOn.localeCompare(a.measuredOn))
    const [latest, prev] = g
    out.push({
      name: latest.name,
      latest,
      all: g,
      changeCy: prev ? latest.results.cy - prev.results.cy : null,
      prevOn: prev ? prev.measuredOn : null,
    })
  }
  return out.sort((a, b) => b.latest.measuredOn.localeCompare(a.latest.measuredOn) || a.name.localeCompare(b.name))
}
