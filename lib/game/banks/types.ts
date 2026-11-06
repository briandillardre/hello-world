// Brain Ball — fact-bank format shared by every knowledge skill.
//
// A kid fact sits in one of five tiers (difficulty bands); an adult fact in
// one of three. `a` is the right answer, `m` the two distractors, `why` the
// kid-worded explanation the miss review reads aloud, `pic` an optional
// emoji shown big under the prompt. `q` is ALSO what the voice reads, so it
// must sound right out loud (no "___" blanks — end with "…" instead).

export interface KidFact {
  /** 1 ≈ age 4 · 2 ≈ age 5 · 3 ≈ age 6–7 · 4 ≈ age 8–9 · 5 = frontier */
  t: 1 | 2 | 3 | 4 | 5
  q: string
  a: string
  m: [string, string]
  why: string
  pic?: string
}

export interface AdultFact {
  tier: 1 | 2 | 3
  q: string
  a: string
  m: [string, string]
  why: string
}
