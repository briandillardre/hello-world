/**
 * DCG job naming — ONE name for zone, project, costing, folder, and the
 * QuickBooks customer the crews pick in Workforce.
 *
 *   "26-088 Asphalt- HLC TR Driveway"   active job, code 26-088
 *   "Z26-088 Asphalt- HLC TR Driveway"  same job, completed (Z flip)
 *
 * The Z prefix does double duty: reads as done, and alphabetically sinks the
 * job to the bottom of every pick list the crews scroll. Pure functions —
 * shared by the zones UI, the complete action, and the QBO sync.
 */

export interface ParsedJob {
  /** True when the name carries the completed-Z prefix. */
  done: boolean
  /** "26-088" when the name follows the YY-NNN convention, else null. */
  code: string | null
  /** Name without the Z (what the job is called while active). */
  activeName: string
}

const JOB_RE = /^(Z)?(\d{2}-\d{3})\b\s*(.*)$/i
// Names without a code can still be completed — they get "Z " in front.
const BARE_Z_RE = /^Z\s+(.+)$/

export function parseJobName(name: string): ParsedJob {
  const trimmed = name.trim()
  const m = trimmed.match(JOB_RE)
  if (m) {
    return {
      done: !!m[1],
      code: m[2],
      activeName: `${m[2]}${m[3] ? ' ' + m[3] : ''}`,
    }
  }
  const z = trimmed.match(BARE_Z_RE)
  if (z) return { done: true, code: null, activeName: z[1] }
  return { done: false, code: null, activeName: trimmed }
}

/** Completed form of a name — idempotent ("Z26-088 …" stays as-is). */
export function toCompletedName(name: string): string {
  const p = parseJobName(name)
  if (p.done) return name.trim()
  return p.code ? `Z${p.activeName}` : `Z ${p.activeName}`
}

/** Active form of a name — strips the Z, idempotent. */
export function toActiveName(name: string): string {
  return parseJobName(name).activeName
}

/** Sort: active jobs first (newest code first), completed sink to the bottom
 *  (mirroring the alphabetical behavior the Z prefix buys in QuickBooks). */
export function compareJobs(a: string, b: string): number {
  const pa = parseJobName(a)
  const pb = parseJobName(b)
  if (pa.done !== pb.done) return pa.done ? 1 : -1
  if (pa.code && pb.code && pa.code !== pb.code) return pb.code.localeCompare(pa.code)
  if (!!pa.code !== !!pb.code) return pa.code ? -1 : 1
  return pa.activeName.localeCompare(pb.activeName)
}
