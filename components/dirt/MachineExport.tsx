'use client'

/**
 * "Export for the machines" on the takeoff's Results step: the SAVED design
 * becomes a LandXML (finished grade + subgrade) and a DXF of the linework,
 * built on the device (lib/machine/export.ts in its own worker) and filed in
 * the site's Machine files with the plan revisions it was traced from — what
 * the dealer builds the machine's file from.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Cpu, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { defaultGrid, type Grid } from '@/lib/machine/grid'
import { startMachineUploadAction, finishMachineFileAction } from '@/lib/actions/machine'
import type { DirtDesign, GroundGrid } from '@/lib/dirt/takeoff'

interface Exported { landxml: string; dxf: string; crs: { epsg: number; name: string; unit: 'ft' | 'm' }; warnings: string[]; fgFaces: number; sgFaces: number }

const safeName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'design'

export function MachineExport({ takeoffId, name, zoneId, zoneRing, design, ground, dirty, canEdit, hasDesign }: {
  takeoffId: string; name: string; zoneId: string; zoneRing: [number, number][] | null
  design: DirtDesign; ground: GroundGrid | null; dirty: boolean; canEdit: boolean; hasDesign: boolean
}) {
  const centre = useMemo(() => {
    const pts = zoneRing?.length ? zoneRing : design.features.flatMap((f) => f.coords)
    if (!pts.length) return null
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] as [number, number]
  }, [zoneRing, design.features])
  const [grid, setGrid] = useState<Grid>(() => (centre ? defaultGrid(centre[0], centre[1]) : 'utm'))
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ warnings: string[]; grid: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const zoneNo = centre ? Math.floor((centre[0] + 180) / 6) + 1 : 17

  if (!canEdit || !zoneId) return null

  function build(): Promise<Exported> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('../../lib/dirt/worker.ts', import.meta.url))
      const stop = setTimeout(() => { w.terminate(); reject(new Error('The export took too long — try again on a computer.')) }, 180_000)
      w.onmessage = (e: MessageEvent<{ type: string; error?: string } & Partial<Exported>>) => {
        clearTimeout(stop)
        w.terminate()
        if (e.data.type === 'exported') resolve(e.data as Exported)
        else reject(new Error(e.data.error || 'The design couldn’t be exported.'))
      }
      w.onerror = () => { clearTimeout(stop); w.terminate(); reject(new Error('The design couldn’t be exported.')) }
      w.postMessage({ type: 'ground', ground })
      w.postMessage({ type: 'export', design, project: name, grid })
    })
  }

  async function upload(text: string, filename: string, kind: 'landxml' | 'dxf', grid: string) {
    const blob = new Blob([text], { type: kind === 'landxml' ? 'application/xml' : 'application/dxf' })
    const st = await startMachineUploadAction({ zoneId, filename, size: blob.size }).catch(() => null)
    if (!st?.ok) throw new Error(st && !st.ok ? st.error : 'Couldn’t start the upload — try again.')
    const { error } = await createClient().storage.from('machine').uploadToSignedUrl(st.path, st.token, blob, { contentType: 'application/octet-stream' })
    if (error) throw new Error('The file didn’t upload — try again.')
    const fin = await finishMachineFileAction({ zoneId, id: st.id, name: `${name} design`, filename, kind, takeoffId, grid, builtBy: 'HammerTrack dirt takeoff', builtOn: new Date().toISOString().slice(0, 10) }).catch(() => null)
    if (!fin?.ok) throw new Error(fin && !fin.ok ? fin.error : 'Couldn’t file it — try again.')
  }

  async function go() {
    setErr(null); setDone(null)
    try {
      setBusy('Building the surfaces…')
      const f = await build()
      const base = safeName(`${name} design`)
      const words = `${f.crs.name}, ${f.crs.unit === 'ft' ? 'feet' : 'metres'}`
      setBusy('Filing the LandXML…')
      await upload(f.landxml, `${base}.xml`, 'landxml', words)
      setBusy('Filing the DXF…')
      await upload(f.dxf, `${base}.dxf`, 'dxf', words)
      setDone({ warnings: f.warnings, grid: words })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The export didn’t finish — try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-navy-800 bg-navy-950 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 text-muted" />
        <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">For the machines</span>
        <Link href={`/plans/${zoneId}/machine`} className="text-amber">Machine files</Link>
      </div>
      <p className="text-muted">The saved design as a LandXML (finished grade and subgrade, the section edges as walls) and a DXF of the linework — what the dealer builds the machine&apos;s file from. Filed with the plan revisions it was traced from.</p>
      <label className="flex items-center gap-2">
        <span className="text-muted">Grid</span>
        <select value={grid} onChange={(e) => setGrid(e.target.value === 'sc' ? 'sc' : 'utm')} className="flex-1 rounded border border-navy-700 bg-navy-950 px-2 py-1 text-ink">
          <option value="sc">SC State Plane (NAD83, international ft)</option>
          <option value="utm">UTM zone {zoneNo}N (NAD83, metres)</option>
        </select>
      </label>
      <button onClick={go} disabled={!!busy || dirty || !hasDesign}
        className="w-full rounded-lg bg-amber px-3 py-2 font-semibold text-navy-950 disabled:opacity-50">
        {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}</span> : 'Export LandXML + DXF'}
      </button>
      {dirty && <p className="text-amber">Save first — the files are made from the saved design.</p>}
      {!dirty && !hasDesign && <p className="text-faint">Trace the proposed grades first.</p>}
      {err && <p className="text-red-300">{err}</p>}
      {done && (
        <div className="space-y-1 text-teal-300">
          <p>Filed in <Link href={`/plans/${zoneId}/machine`} className="underline">Machine files</Link> — {done.grid}.</p>
          {done.warnings.map((w) => <p key={w} className="text-amber">• {w}</p>)}
        </div>
      )}
    </div>
  )
}
