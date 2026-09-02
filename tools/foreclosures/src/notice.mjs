// Pull the fields an investor cares about out of a SC "Notice of Sale" / "Master's Sale" ad.

const WAIVED = [
  /no (?:personal or )?deficiency judgment (?:is |being |has been )?(?:demanded|sought|requested)/i,
  /deficiency judgment (?:is |has been |was |being )?(?:hereby )?waived/i,
  /(?:plaintiff|mortgagee)[^.]{0,80}(?:waive[sd]?|has waived|does not (?:seek|demand|request)|will not (?:seek|demand))[^.]{0,40}deficiency/i,
  /waiver of (?:any |the |its )?(?:right to a )?deficiency/i, /deficiency waived/i,
  /bidding will not remain open|sale (?:is|shall be|will be) final/i,
]
const DEMANDED = [
  /(?<!no (?:personal or )?)deficiency judgment (?:is |being |has been )?(?:demanded|requested|sought|preserved)/i,
  /deficiency (?:is |being )?(?:demanded|preserved)/i,
  /bid(?:ding)? (?:will|shall) (?:remain|be kept|stay) open (?:for )?(?:thirty|30)/i, /(?<!not )remain open (?:for )?(?:a period of )?(?:thirty|30)/i,
  /(?<!not )(?:be )?open for (?:a period of )?thirty/i,
]
const NOT_A_SIGNAL = /may waive any of its rights|may waive[^.]{0,40}deficiency|reserves the right to waive/i

/** Returns { status: 'waived'|'demanded'|'conflicting'|'unknown', quotes: [...] } */
export function deficiencyStatus(text) {
  const sentences = String(text).replace(/\s+/g, ' ').split(/(?<=[.;])\s+(?=[A-Z"])/)
  const quotes = [], votes = { waived: 0, demanded: 0 }
  for (const s of sentences) {
    if (!/deficien|remain open|open for thirty|sale (?:is|shall be|will be) final/i.test(s) || NOT_A_SIGNAL.test(s)) continue
    const w = WAIVED.some(re => re.test(s)), d = DEMANDED.some(re => re.test(s))
    if (w && !d) { votes.waived++; quotes.push('W: ' + s.trim().slice(0, 220)) }
    else if (d && !w) { votes.demanded++; quotes.push('D: ' + s.trim().slice(0, 220)) }
    else if (w && d) { quotes.push('?: ' + s.trim().slice(0, 220)) }
  }
  const status = votes.waived && votes.demanded ? 'conflicting' : votes.waived ? 'waived' : votes.demanded ? 'demanded' : 'unknown'
  return { status, quotes }
}
export const detectDeficiency = (text) => deficiencyStatus(text).status

const ADDR = /(\d{1,6}(?:-[A-Z0-9]+)?\s+[A-Za-z0-9 .'#-]{3,60}?,?\s*[A-Za-z .]{3,30},?\s*(?:SC|South Carolina)\s*\d{5}(?:-\d{4})?)/
const BAD_ADDR = /court ?house|judicial center|magnolia street|county courthouse/i

export function parseNotice(text) {
  const t = String(text).replace(/\r/g, '')
  const flat = t.replace(/\s+/g, ' ')
  const pick = (re, src = flat) => (src.match(re) || [])[1]?.trim() || ''
  const caption = pick(/in the case of:?\s+(.+?),?\s+(?:I,?\s+)?(?:the (?:undersigned|Master)|as Master)/i)
  let plaintiff = '', defendant = ''
  if (caption) { const m = caption.match(/^(.+?)\s+(?:vs?\.?|v\.|versus|against)\s+(.+)$/i); if (m) { plaintiff = m[1].trim(); defendant = m[2].trim() } }
  let address = pick(/Property Address\s*:?\s*(\d[^\n]*?\b(?:SC|South Carolina)\b\s*\d{5})/i)
  if (!address) address = pick(new RegExp(ADDR.source + '\\s*(?:TMS|Tax Map|TM ?#)', 'i'))
  if (!address) address = [...flat.matchAll(new RegExp(ADDR.source, 'g'))].map(m => m[1]).find(a => !BAD_ADDR.test(a)) || ''
  const def = deficiencyStatus(flat)
  return {
    saleDate: pick(/will sell on ([A-Za-z]+,? [A-Za-z]+ \d{1,2},? \d{4})/i),
    plaintiff, defendant, caption,
    tms: pick(/(?:TMS|Tax Map|TM)\s*(?:#|No\.?|Number)?\s*:?\s*#?\s*([0-9][0-9A-Za-z.\-]{6,})/i),
    address: address.replace(/\s+/g, ' ').trim(),
    legalDescription: (t.match(/ALL THAT (?:CERTAIN )?[\s\S]{0,1600}?(?=\n\s*(?:THIS BEING|BEING THE SAME|DERIVATION|TMS|Property Address|TERMS OF SALE)|$)/i) || [])[0]?.replace(/\s+/g, ' ').trim() || '',
    derivation: pick(/((?:THIS BEING|BEING) THE SAME (?:PROPERTY|LOT|PARCEL)[^]{0,600}?(?:South Carolina|SC)\.)/i),
    deficiency: def.status, deficiencyQuotes: def.quotes,
    reopenDate: pick(/(?:re-?open(?:ed)?|bidding will (?:re)?open)[^.]{0,60}?on ([A-Za-z]+,? [A-Za-z]+ \d{1,2},? \d{4})/i),
    bidInterestRate: pick(/(?:interest|note rate)[^.]{0,60}?(?:rate of|of) ([\d.]+\s*%)/i),
    depositPct: pick(/(five|ten|5|10)\s*(?:per ?cent|%)[^.]{0,40}(?:of (?:the |said |their )?bid)/i),
    subjectTo: pick(/(sold subject to [^.]{0,300}\.)/i),
    seniorLien: pick(/(subject to (?:a |the )?(?:prior|first|senior|existing) mortgage[^.]{0,200}\.)/i),
    usaRedemption: /United States of America[^.]{0,120}(?:right of redemption|redeem)/i.test(flat),
  }
}
