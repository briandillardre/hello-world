/**
 * Machine files (migration 149) — read under the caller's own RLS: the
 * company's, a personal zone's only for its owner, nothing for a prospect.
 */
import type { BuiltFrom, MachineKind } from '@/lib/machine/status'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface MachineFile {
  id: string
  name: string
  kind: MachineKind
  filename: string
  sizeBytes: number
  builtBy: string | null
  builtOn: string | null
  builtFrom: BuiltFrom[]
  source: 'upload' | 'hammertrack'
  takeoffId: string | null
  grid: string | null
  note: string | null
  createdAt: string
}

export const MACHINE_COLS = 'id, name, kind, filename, size_bytes, built_by, built_on, built_from, source, takeoff_id, grid, note, created_at'

export function machineFromRow(r: Record<string, unknown>): MachineFile {
  return {
    id: String(r.id), name: String(r.name), kind: String(r.kind) as MachineKind, filename: String(r.filename),
    sizeBytes: Number(r.size_bytes) || 0, builtBy: r.built_by ? String(r.built_by) : null, builtOn: r.built_on ? String(r.built_on) : null,
    builtFrom: Array.isArray(r.built_from) ? (r.built_from as BuiltFrom[]).filter((b) => b && typeof b.sheetId === 'string' && typeof b.versionId === 'string') : [],
    source: r.source === 'hammertrack' ? 'hammertrack' : 'upload', takeoffId: r.takeoff_id ? String(r.takeoff_id) : null,
    grid: r.grid ? String(r.grid) : null, note: r.note ? String(r.note) : null, createdAt: String(r.created_at),
  }
}

export async function getMachineFiles(zoneId: string): Promise<MachineFile[]> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(zoneId)) return []
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const { data, error } = await createClient().from('machine_files').select(MACHINE_COLS).eq('geofence_id', zoneId)
      .order('created_at', { ascending: false }).limit(300)
    if (error || !data) return []
    return (data as Record<string, unknown>[]).map(machineFromRow)
  } catch {
    return []
  }
}
