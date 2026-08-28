import type { AssetType } from './types'
import { ASSET_ICONS, TYPE_DEFAULT_ICON } from './asset-icons'

/**
 * Bulk asset load — the spreadsheet door (Brian, Aug 28: "need a bulk load
 * option, spreadsheet style. I can then edit the assets later").
 *
 * Scan-to-map covers boxes you're holding; this covers the fleet that already
 * exists on someone's insurance schedule, equipment list, or the old system's
 * export. Paste the block straight out of Excel/Sheets, fix what's flagged,
 * import. Names and rates get refined later on the asset page.
 *
 * Everything here is PURE so the grid and the server action enforce the exact
 * same rules — a client that skips validation must not be able to write a row
 * the grid would have rejected.
 */

export type ColKey =
  | 'name' | 'type' | 'icon' | 'tracker' | 'category' | 'serial'
  | 'year' | 'make' | 'model' | 'license'
  | 'hourly_rate' | 'mileage_rate' | 'daily_cost' | 'purchase_price' | 'purchase_value'

export interface ColDef {
  key: ColKey
  label: string
  hint: string
  kind: 'text' | 'number' | 'type' | 'icon'
  /** Cost columns hide entirely from roles without canViewCosts. */
  money?: boolean
  /** Shown in the default (essentials) view; the rest live behind the toggle. */
  essential?: boolean
  width: number
  /** Normalized header spellings that map onto this column. */
  aliases: string[]
}

/** Column order = the template's column order = the paste order when a block
 *  arrives with no recognizable header row. */
export const IMPORT_COLUMNS: ColDef[] = [
  { key: 'name', label: 'Name', hint: 'required', kind: 'text', essential: true, width: 200,
    aliases: ['name', 'assetname', 'asset', 'description', 'unit', 'unitname', 'equipment', 'vehicle', 'item'] },
  { key: 'type', label: 'Type', hint: 'vehicle · equipment · personnel · tool', kind: 'type', essential: true, width: 140,
    aliases: ['type', 'assettype', 'kind', 'class', 'classification'] },
  { key: 'icon', label: 'Map icon', hint: 'auto from the name', kind: 'icon', essential: true, width: 156,
    aliases: ['icon', 'mapicon', 'symbol', 'glyph'] },
  { key: 'tracker', label: 'Tracker / IMEI', hint: '15-digit IMEI or a tag ID', kind: 'text', essential: true, width: 158,
    aliases: ['tracker', 'trackerid', 'imei', 'device', 'deviceid', 'gpsid', 'tag', 'tagid', 'beacon', 'serialimei'] },
  { key: 'category', label: 'Category', hint: 'your grouping', kind: 'text', essential: true, width: 130,
    aliases: ['category', 'group', 'division', 'department', 'fleet', 'costcode'] },
  { key: 'serial', label: 'Serial / VIN', hint: '', kind: 'text', essential: true, width: 160,
    aliases: ['serial', 'serialnumber', 'sn', 'vin', 'vinnumber', 'pin', 'serialvin'] },
  { key: 'year', label: 'Year', hint: '', kind: 'text', width: 74, aliases: ['year', 'modelyear', 'yr'] },
  { key: 'make', label: 'Make', hint: '', kind: 'text', width: 118, aliases: ['make', 'manufacturer', 'brand', 'oem'] },
  { key: 'model', label: 'Model', hint: '', kind: 'text', width: 130, aliases: ['model', 'modelnumber', 'modelno'] },
  // No bare 'unit' here — it's an alias of `name` too, and last-wins in the
  // alias map handed a `Unit | Make | Model | Year` sheet (an ordinary
  // equipment list) no name column at all (ship-check).
  { key: 'license', label: 'License', hint: 'plate / unit #', kind: 'text', width: 118,
    aliases: ['license', 'licenseplate', 'plate', 'tagnumber', 'unitnumber', 'unitno'] },
  { key: 'hourly_rate', label: 'Operating $/hr', hint: 'fuel + wear', kind: 'number', money: true, width: 126,
    aliases: ['hourlyrate', 'operatinghr', 'operatingrate', 'hourly', 'perhour', 'ratehr', 'hourlycost'] },
  { key: 'mileage_rate', label: '$/mile', hint: '', kind: 'number', money: true, width: 96,
    aliases: ['mileagerate', 'mile', 'permile', 'ratemile', 'mileagecost'] },
  { key: 'daily_cost', label: 'Ownership $/day', hint: 'payment, insurance, depreciation', kind: 'number', money: true, width: 140,
    aliases: ['dailycost', 'ownershipday', 'ownership', 'daily', 'perday', 'rateday', 'dailyrate'] },
  { key: 'purchase_price', label: 'Purchase $', hint: 'what you paid', kind: 'number', money: true, width: 120,
    aliases: ['purchaseprice', 'purchase', 'cost', 'paid', 'acquisitioncost', 'purchasecost'] },
  { key: 'purchase_value', label: 'Replacement $', hint: 'what it costs today', kind: 'number', money: true, width: 132,
    aliases: ['purchasevalue', 'replacement', 'replacementcost', 'value', 'currentvalue', 'insuredvalue', 'replacementvalue'] },
]

export const COLUMN_KEYS: ColKey[] = IMPORT_COLUMNS.map((c) => c.key)
export type ImportRow = Partial<Record<ColKey, string>>

/** Hard ceiling per import. Deliberately generous for a fleet list but small
 *  enough that the whole batch stays well inside a server-action body. */
export const MAX_IMPORT_ROWS = 500

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Excel/Sheets paste (tab-separated) and CSV in one parser, including quoted
 * fields with embedded delimiters, newlines, and doubled quotes. A quote only
 * opens a field at its start, so `5" pipe` in the middle of a cell survives.
 */
export function parseDelimited(raw: string): string[][] {
  const text = raw.replace(/\r\n?/g, '\n')
  if (!text.trim()) return []

  // Sniff the delimiter on the first line, ignoring anything inside quotes —
  // using the SAME "a quote only opens at field start" rule as the parser
  // below. Toggling on every quote let an inch mark (`5" pipe rack`) hide
  // the rest of the line's tabs, so a TSV fell back to comma and every row
  // collapsed into a single cell (ship-check).
  let tabs = 0, commas = 0, semis = 0, q = false, atFieldStart = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') q = false; continue }
    if (c === '"' && atFieldStart) { q = true; atFieldStart = false; continue }
    if (c === '\n') break
    if (c === '\t') { tabs++; atFieldStart = true }
    else if (c === ',') { commas++; atFieldStart = true }
    else if (c === ';') { semis++; atFieldStart = true }
    else atFieldStart = false
  }
  const delim = tabs > 0 ? '\t' : semis > commas ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"' && field === '') inQuotes = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  row.push(field)
  rows.push(row)

  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop()
  return rows.map((r) => r.map((c) => c.trim()))
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Map a candidate header row onto columns. Returns one entry per cell (the
 * column it feeds, or null for "ignore this column"), or null when the row
 * doesn't read as a header at all — then the caller falls back to positional
 * order and treats every row as data.
 */
export function matchHeaderRow(cells: string[]): (ColKey | null)[] | null {
  const byAlias = new Map<string, ColKey>()
  for (const col of IMPORT_COLUMNS) {
    byAlias.set(norm(col.label), col.key)
    byAlias.set(col.key, col.key)
    for (const a of col.aliases) byAlias.set(a, col.key)
  }
  const mapped = cells.map((c) => {
    const n = norm(c)
    if (!n) return null
    return byAlias.get(n) ?? null
  })
  const filled = cells.filter((c) => c.trim()).length
  const hits = mapped.filter(Boolean).length
  // Two independent hits AND most of the filled cells recognized — a data row
  // whose first cell happens to say "Excavator" must not eat itself as a header.
  if (hits < 2 || hits < Math.ceil(filled * 0.6)) return null
  // Never let one column win twice (a sheet with two "Unit" columns).
  const seen = new Set<ColKey>()
  return mapped.map((k) => (k && !seen.has(k) ? (seen.add(k), k) : null))
}

/** Turn a pasted/uploaded block into rows keyed by column. */
export function rowsFromGrid(grid: string[][]): { rows: ImportRow[]; headerUsed: boolean } {
  if (!grid.length) return { rows: [], headerUsed: false }
  const header = matchHeaderRow(grid[0])
  const body = header ? grid.slice(1) : grid
  // Width from the WIDEST row, not row 0 — a CSV whose first data row is
  // short was silently dropping every later row's extra cells (ship-check).
  const width = Math.max(...grid.map((r) => r.length))
  const keys: (ColKey | null)[] = header ?? COLUMN_KEYS.slice(0, width)
  const rows = body
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => {
      const row: ImportRow = {}
      cells.forEach((v, i) => {
        const k = keys[i]
        if (k && v.trim()) row[k] = v.trim()
      })
      return row
    })
  return { rows, headerUsed: !!header }
}

// ── Inference ──────────────────────────────────────────────────────────────

/** Name keyword → type + map icon. Most specific first: "dump truck" must beat
 *  the bare "truck", "mini excavator" must not land on "mixer". */
const NAME_HINTS: [RegExp, AssetType, string][] = [
  // Towed things first: "Dump Trailer" is a trailer, and a unit code like
  // "Trailer D2" must not read as a Cat dozer (ship-check).
  [/trailer|lowboy|goose.?neck|\bpup\b/i, 'equipment', 'trailer'],
  // Machines whose names contain tool words — these must beat the generic
  // tool rule at the bottom, or a $30k grinder becomes type 'tool' and loses
  // its own trail, hours and idle-$ (tools inherit a carrier's location).
  [/stump grinder|drill rig|hydraulic hammer|hammer attachment|breaker/i, 'equipment', 'excavator'],

  [/\bdump\b|\bdumptruck\b|tri.?axle/i, 'vehicle', 'dump-truck'],
  [/mixer|concrete truck|redi.?mix|ready.?mix/i, 'vehicle', 'mixer'],
  [/water truck|water tender/i, 'vehicle', 'water-truck'],
  [/day.?cab|road tractor|\bsleeper\b/i, 'vehicle', 'day-cab'],
  [/semi|tractor.?trailer|\b18.?wheeler\b/i, 'vehicle', 'semi'],
  [/flat.?bed|stake body|\brollback\b/i, 'vehicle', 'flatbed'],
  [/box truck|\bbox van\b|cube van/i, 'vehicle', 'box-truck'],
  [/service truck|mechanic truck|lube truck|fuel truck/i, 'vehicle', 'service-truck'],
  [/\bvan\b|transit|promaster|sprinter/i, 'vehicle', 'van'],
  [/pickup|\bf.?[123]50\b|silverado|sierra|\bram \d|tacoma|tundra|colorado|ranger|\btruck\b/i, 'vehicle', 'pickup'],

  [/mini.?ex|excavator|track.?hoe|\bex\d|zx\d|\bpc\d/i, 'equipment', 'excavator'],
  [/dozer|bulldozer|\bd\d[a-z]?\b|crawler tractor/i, 'equipment', 'dozer'],
  [/skid.?steer|\bctl\b|track loader|bobcat/i, 'equipment', 'skid-steer'],
  [/wheel loader|front.?end loader|\bloader\b/i, 'equipment', 'wheel-loader'],
  [/backhoe|\b[34]10[a-z]?\b|tractor loader backhoe|\btlb\b/i, 'equipment', 'backhoe'],
  [/motor.?grader|\bgrader\b/i, 'equipment', 'grader'],
  [/roller|compactor|\bsakai\b|packer|sheeps.?foot/i, 'equipment', 'roller'],
  [/telehandler|reach forklift|\bth\d|zoom.?boom/i, 'equipment', 'telehandler'],
  [/fork.?lift|\blift truck\b/i, 'equipment', 'forklift'],
  [/boom.?lift|man.?lift|scissor.?lift|\bjlg\b|\bgenie\b/i, 'equipment', 'boom-lift'],
  [/\bcrane\b|boom truck|\bpicker\b/i, 'equipment', 'crane'],
  [/\bmower\b|bush.?hog|brush cutter|zero.?turn/i, 'equipment', 'mower'],
  [/\butv\b|\batv\b|gator|ranger utv|mule/i, 'equipment', 'utv'],
  [/tractor/i, 'equipment', 'tractor'],
  [/trailer|lowboy|goose.?neck|\bpup\b/i, 'equipment', 'trailer'],
  [/generator|\bgenset\b|light tower|\bair compressor\b/i, 'equipment', 'generator'],

  [/\bsaw\b|drill|grinder|hammer|impact|\bkit\b|\blevel\b|laser|\btool\b|wrench|nailer|welder/i, 'tool', 'wrench'],
]

/**
 * Brand fallback — type only, no icon. Real fleet lists are full of names
 * like "Chevy 1500", "Peterbilt 567", "Link-Belt 130X2", "Takeuchi TB235":
 * unmistakable to a human, invisible to the keyword rules above, and each
 * one was a hard error the owner had to clear by hand (ship-check). Naming
 * the TYPE is enough to import; the icon falls back to the type default.
 */
const BRAND_HINTS: [RegExp, AssetType][] = [
  [/\b(chevy|chevrolet|silverado|ford|f-?\d{3}|gmc|sierra|ram|dodge|toyota|tundra|tacoma|nissan|titan|jeep)\b/i, 'vehicle'],
  [/\b(peterbilt|kenworth|freightliner|mack|international|western star)\b/i, 'vehicle'],
  [/\b(caterpillar|\bcat\b|komatsu|link.?belt|john deere|\bdeere\b|kubota|takeuchi|case\b|new holland|\bjcb\b|hitachi|doosan|hyundai|sany|volvo|bomag|wirtgen|sakai|dynapac|vermeer|ditch witch|manitou|wacker)\b/i, 'equipment'],
]

/** Best-guess type + icon for a bare name. Returns nulls when nothing is
 *  confident — a blank type on import is an error the owner fixes, never a
 *  silent "vehicle". */
export function inferFromName(name: string): { type: AssetType | null; icon: string | null } {
  const n = name.trim()
  if (!n) return { type: null, icon: null }
  for (const [re, type, icon] of NAME_HINTS) {
    if (re.test(n)) return { type, icon }
  }
  for (const [re, type] of BRAND_HINTS) {
    if (re.test(n)) return { type, icon: null }
  }
  return { type: null, icon: null }
}

// ── Field coercion + validation ────────────────────────────────────────────

/** Longest a cell is ever allowed to be — applied at the door, before any
 *  regex sees it. Comfortably above every per-field limit below, so the
 *  friendly "too long" errors still fire for realistic input. Without it
 *  `^-?\d*\.?\d+$` backtracks quadratically on a long digit run with a
 *  non-matching tail: 160k characters pegged a CPU for 22 seconds, and one
 *  such cell would hold a server action open until it timed out (sec-check). */
const MAX_CELL = 256
/** No fleet has a machine costing more than this; the cap keeps an absurd
 *  figure (1e308 is finite and ≥ 0) out of the ledger, idle-$ rings, insight
 *  detectors and the owner memo. */
const MAX_MONEY = 1e9

/** "$1,250.50" / "1 250,50" → 1250.5 · blank → null · junk → undefined. */
export function parseMoney(raw: string | undefined): number | null | undefined {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (s.length > 32) return undefined // exported — never trust the caller to have capped it
  const cleaned = s.replace(/[$\s,]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return undefined
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return undefined
  return n
}

/**
 * Dedupe key for a tracker id. IMEIs are digits and compare as-is; everything
 * else folds to lower case, because the tool lookup that consumes these
 * resolves with `.ilike` — importing `abc123` alongside an existing `ABC123`
 * would otherwise pass every check here and then bind that tag's sightings to
 * an arbitrary one of the two assets (sec-check).
 */
export function trackerKey(t: string): string {
  return /^\d+$/.test(t) ? t : t.toLowerCase()
}

/** Prefixes the platform issues itself — a customer-supplied tracker must
 *  never shadow a showroom simulator or a phone tracker. */
const RESERVED_TRACKER_PREFIXES = ['sim-', 'phone-']

/** Standard IMEI Luhn check (double every second digit from the right). */
export function luhnOk(s: string): boolean {
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    let d = s.charCodeAt(s.length - 1 - i) - 48
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

/** Pull exactly-15 digits out of a scanned/typed code (bounded so a 19-digit
 *  ICCID can't donate its first 15). */
export function extractImei(raw: string): string | null {
  return (String(raw).match(/(?:^|\D)(\d{15})(?!\d)/) ?? [])[1] ?? null
}

const TYPE_WORDS: Record<string, AssetType> = {
  vehicle: 'vehicle', truck: 'vehicle', car: 'vehicle', van: 'vehicle', auto: 'vehicle', fleet: 'vehicle',
  equipment: 'equipment', machine: 'equipment', machinery: 'equipment', heavy: 'equipment', iron: 'equipment', attachment: 'equipment',
  personnel: 'personnel', person: 'personnel', people: 'personnel', employee: 'personnel', crew: 'personnel', staff: 'personnel', operator: 'personnel', driver: 'personnel',
  tool: 'tool', tools: 'tool', tag: 'tool', smalltool: 'tool',
}

/**
 * A Type column's value → our four types. Exact word first, then the same
 * name inference the Name column gets: a real equipment list's Type column
 * reads "Dump Truck / Excavator / Skid Steer", and exact-match-only turned
 * every one of those rows red while the identical string in the Name column
 * inferred perfectly (ship-check).
 */
export function parseType(raw: string | undefined): AssetType | null {
  const n = norm(raw ?? '')
  if (!n) return null
  // hasOwn, not a bare lookup: 'constructor' is an inherited member and
  // returned a function, which then serialized out of the insert payload.
  if (Object.hasOwn(TYPE_WORDS, n)) return TYPE_WORDS[n]
  const byName = inferFromName(String(raw)).type
  if (byName) return byName
  // Last pass: any single type word inside the phrase — "Heavy Equipment",
  // "Small Tools", "Field Personnel".
  for (const word of String(raw).toLowerCase().split(/[^a-z]+/)) {
    if (word && Object.hasOwn(TYPE_WORDS, word)) return TYPE_WORDS[word]
  }
  return null
}

export interface ResolvedRow {
  name: string
  type: AssetType
  icon: string | null
  tracker: string | null
  category: string | null
  serial: string | null
  metadata: Record<string, string>
  hourly_rate: number | null
  mileage_rate: number | null
  daily_cost: number | null
  purchase_price: number | null
  purchase_value: number | null
}

export interface RowIssue {
  /** Column the problem belongs to, or null for a whole-row problem. */
  col: ColKey | null
  /** 'error' blocks the row; 'warn' imports but is worth a look. */
  level: 'error' | 'warn'
  text: string
}

export interface RowVerdict {
  resolved: ResolvedRow | null
  issues: RowIssue[]
  /** True when the row is entirely blank — skipped silently, never an error. */
  empty: boolean
}

export interface ExistingIndex {
  /** Lower-cased existing asset names. */
  names: Set<string>
  /** Existing tracker ids (as stored). */
  trackers: Set<string>
}

/**
 * Validate + coerce ONE row. `seen` accumulates names/trackers already claimed
 * earlier in the SAME batch so a sheet that lists a truck twice is caught
 * before Postgres has to.
 */
export function resolveRow(
  row: ImportRow,
  opts: { existing?: ExistingIndex; seen?: ExistingIndex; allowMoney?: boolean } = {}
): RowVerdict {
  const issues: RowIssue[] = []
  // Every cell is bounded HERE, once, before any regex or length check runs
  // downstream — see MAX_CELL.
  // String(): the action takes this array straight off the wire, so a
  // non-string cell used to throw "trim is not a function" and surface as a
  // bare "Import failed" (ship-check).
  const val = (k: ColKey) => String(row[k] ?? '').trim().slice(0, MAX_CELL)
  const empty = COLUMN_KEYS.every((k) => !val(k))
  if (empty) return { resolved: null, issues: [], empty: true }

  // ── name
  const name = val('name')
  if (!name) issues.push({ col: 'name', level: 'error', text: 'Name is required' })
  else if (name.length > 120) issues.push({ col: 'name', level: 'error', text: 'Name is too long (120 max)' })
  const lower = name.toLowerCase()
  if (name) {
    if (opts.seen?.names.has(lower)) issues.push({ col: 'name', level: 'error', text: 'Listed twice in this sheet' })
    else if (opts.existing?.names.has(lower)) issues.push({ col: 'name', level: 'warn', text: 'You already have an asset with this name' })
  }

  // ── type (explicit wins; else inferred from the name)
  const typed = parseType(val('type'))
  if (val('type') && !typed) {
    issues.push({ col: 'type', level: 'error', text: `"${val('type')}" isn't a type — use vehicle, equipment, personnel, or tool` })
  }
  const inferred = inferFromName(name)
  const type = typed ?? inferred.type
  if (!type) issues.push({ col: 'type', level: 'error', text: 'Type needed — nothing in the name says what this is' })

  // ── icon (explicit wins; unknown key falls back rather than blocking)
  let icon: string | null = null
  const iconRaw = val('icon')
  if (iconRaw) {
    const k = norm(iconRaw).replace(/\s+/g, '-')
    const direct = Object.hasOwn(ASSET_ICONS, iconRaw) ? iconRaw
      : Object.keys(ASSET_ICONS).find((key) => norm(key) === k) ?? null
    if (direct) icon = direct
    else issues.push({ col: 'icon', level: 'warn', text: `No icon called "${iconRaw}" — using the ${type ?? 'type'} default` })
  }
  // Only store an inferred icon when it differs from what the type would pick
  // anyway, so `metadata.icon` stays meaningful rather than noise.
  if (!icon && inferred.icon && type && inferred.icon !== TYPE_DEFAULT_ICON[type]) icon = inferred.icon

  // ── tracker: 15-digit IMEI (Luhn) or a non-numeric tag id
  let tracker: string | null = null
  const trackerRaw = val('tracker')
  if (trackerRaw) {
    const digits = trackerRaw.replace(/\s|-/g, '')
    // Excel formats a 15-digit number in a General column as 8.68996E+14.
    // That isn't all-digits, so it used to sail through as "a BLE tag id":
    // asset created green, ingest never matches the bare IMEI, truck never
    // appears on the map (ship-check). Name it instead of accepting it.
    if (/^\d[.,]?\d*[eE][+-]?\d+$/.test(digits)) {
      issues.push({ col: 'tracker', level: 'error', text: `Excel turned this into "${trackerRaw}" — format that column as Text and re-copy the IMEI` })
    } else if (!/^\d+$/.test(digits) && extractImei(trackerRaw)) {
      // "IMEI: 868996068802222" / "868996068802222 (T1-a)" — pull the real
      // 15-digit run out rather than storing the label around it.
      const found = extractImei(trackerRaw)!
      if (!luhnOk(found)) {
        issues.push({ col: 'tracker', level: 'error', text: 'Fails the IMEI checksum — check the digits on the box label' })
      } else tracker = found
    } else if (/^\d+$/.test(digits)) {
      if (digits.length !== 15) {
        issues.push({ col: 'tracker', level: 'error', text: `IMEIs are 15 digits — this is ${digits.length}` })
      } else if (!luhnOk(digits)) {
        issues.push({ col: 'tracker', level: 'error', text: 'Fails the IMEI checksum — check the digits on the box label' })
      } else tracker = digits
    } else if (trackerRaw.length > 128) {
      issues.push({ col: 'tracker', level: 'error', text: 'Tracker/tag id is too long' })
    } else if (RESERVED_TRACKER_PREFIXES.some((p) => trackerRaw.toLowerCase().startsWith(p))) {
      issues.push({ col: 'tracker', level: 'error', text: `"${trackerRaw.slice(0, 24)}" starts with a reserved prefix — pick a different id` })
    } else tracker = trackerRaw
    if (tracker) {
      const key = trackerKey(tracker)
      if (opts.seen?.trackers.has(key)) issues.push({ col: 'tracker', level: 'error', text: 'Same tracker listed twice in this sheet' })
      else if (opts.existing?.trackers.has(key)) issues.push({ col: 'tracker', level: 'error', text: 'Already on one of your assets' })
    }
  }

  // ── specs → metadata
  const metadata: Record<string, string> = {}
  const year = val('year')
  if (year) {
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getFullYear() + 2) {
      issues.push({ col: 'year', level: 'error', text: 'Year should be a 4-digit year' })
    } else metadata.year = year
  }
  for (const k of ['make', 'model', 'license'] as const) {
    const v = val(k)
    if (v) metadata[k] = v.slice(0, 80)
  }
  if (icon) metadata.icon = icon

  // ── money
  const money: Record<string, number | null> = {}
  for (const col of IMPORT_COLUMNS.filter((c) => c.money)) {
    const raw = val(col.key)
    if (raw && opts.allowMoney === false) continue // role can't set costs — drop, don't fail
    const n = parseMoney(raw)
    if (n === undefined) issues.push({ col: col.key, level: 'error', text: `"${raw}" isn't a number` })
    else money[col.key] = n
  }

  const blocked = issues.some((i) => i.level === 'error')
  if (blocked || !type) return { resolved: null, issues, empty: false }

  return {
    empty: false,
    issues,
    resolved: {
      name,
      type,
      icon,
      tracker,
      // Capped like every sibling field — these two reach an unbounded TEXT
      // column that /assets and the map payload both select('*') (sec-check).
      category: val('category').slice(0, 80) || null,
      serial: val('serial').slice(0, 80) || null,
      metadata,
      hourly_rate: money.hourly_rate ?? null,
      mileage_rate: money.mileage_rate ?? null,
      daily_cost: money.daily_cost ?? null,
      purchase_price: money.purchase_price ?? null,
      purchase_value: money.purchase_value ?? null,
    },
  }
}

/** Resolve a whole sheet, threading the batch-duplicate index through it. */
export function resolveSheet(
  rows: ImportRow[],
  opts: { existing?: ExistingIndex; allowMoney?: boolean } = {}
): RowVerdict[] {
  const seen: ExistingIndex = { names: new Set(), trackers: new Set() }
  return rows.map((row) => {
    const verdict = resolveRow(row, { ...opts, seen })
    if (verdict.resolved) {
      seen.names.add(verdict.resolved.name.toLowerCase())
      if (verdict.resolved.tracker) seen.trackers.add(trackerKey(verdict.resolved.tracker))
    }
    return verdict
  })
}

/** The download template: header row + two worked examples. */
export function templateCsv(includeMoney = true): string {
  const cols = IMPORT_COLUMNS.filter((c) => includeMoney || !c.money)
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const sample: Record<ColKey, string>[] = [
    {
      name: '2019 Ram 3500 Dump', type: 'vehicle', icon: 'dump-truck', tracker: '', category: 'Trucks',
      serial: '', year: '2019', make: 'Ram', model: '3500', license: 'SC-1234',
      hourly_rate: '38', mileage_rate: '0.68', daily_cost: '45', purchase_price: '62000', purchase_value: '48000',
    },
    {
      name: 'Takeuchi TB235 Mini-Ex', type: 'equipment', icon: 'excavator', tracker: '', category: 'Dirt',
      serial: '', year: '2021', make: 'Takeuchi', model: 'TB235', license: '',
      hourly_rate: '52', mileage_rate: '', daily_cost: '60', purchase_price: '58000', purchase_value: '52000',
    },
  ]
  const lines = [cols.map((c) => esc(c.label)).join(',')]
  for (const s of sample) lines.push(cols.map((c) => esc(s[c.key] ?? '')).join(','))
  return lines.join('\n') + '\n'
}
