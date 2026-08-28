'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp, Loader2, Plus, Table2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ASSET_ICONS, ICON_GROUPS, TYPE_DEFAULT_ICON } from '@/lib/asset-icons'
import {
  IMPORT_COLUMNS, MAX_IMPORT_ROWS, inferFromName, parseDelimited, resolveSheet, rowsFromGrid, templateCsv,
  type ColDef, type ColKey, type ImportRow, type RowVerdict,
} from '@/lib/bulk-import'
import { bulkCreateAssetsAction } from '@/lib/actions/assets'
import type { AssetType } from '@/lib/types'

/**
 * Bulk load, spreadsheet style (Brian, Aug 28: "need a bulk load option —
 * spreadsheet style. I can then edit the assets later").
 *
 * Paste the block straight out of Excel/Sheets — headers are matched by name
 * so column ORDER doesn't have to match ours — fix whatever's flagged red,
 * import. Type and map icon are inferred from the name so a bare list of
 * machines still lands correctly typed. Names, rates and photos get refined
 * later on each asset's page; this door only has to get the fleet IN.
 */

interface GridRow {
  key: number
  cells: ImportRow
  /** Server-side failure from the last import attempt. */
  err?: string | null
}

interface Props {
  /** Existing fleet, for duplicate detection (name warns, tracker blocks). */
  existingNames: string[]
  existingTrackers: string[]
  canViewCosts: boolean
  isDemo: boolean
}

const BLANK_ROWS = 6
let nextKey = 1
const blankRow = (): GridRow => ({ key: nextKey++, cells: {} })

const TYPE_OPTIONS: AssetType[] = ['vehicle', 'equipment', 'personnel', 'tool']

export function BulkImport({ existingNames, existingTrackers, canViewCosts, isDemo }: Props) {
  const [rows, setRows] = useState<GridRow[]>(() => Array.from({ length: BLANK_ROWS }, blankRow))
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [imported, setImported] = useState<{ id?: string; name: string }[]>([])
  const gridRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const columns = useMemo(
    () => IMPORT_COLUMNS.filter((c) => (canViewCosts || !c.money) && (showAll || c.essential)),
    [canViewCosts, showAll]
  )
  const hiddenWithData = useMemo(() => {
    const shown = new Set(columns.map((c) => c.key))
    return IMPORT_COLUMNS.some((c) => !shown.has(c.key) && rows.some((r) => (r.cells[c.key] ?? '').trim()))
  }, [columns, rows])

  const existing = useMemo(() => ({
    names: new Set(existingNames.map((n) => n.toLowerCase())),
    trackers: new Set(existingTrackers),
  }), [existingNames, existingTrackers])

  const verdicts = useMemo(
    () => resolveSheet(rows.map((r) => r.cells), { existing, allowMoney: canViewCosts }),
    [rows, existing, canViewCosts]
  )

  const ready = verdicts.filter((v) => v.resolved).length
  const broken = verdicts.filter((v) => !v.empty && !v.resolved).length
  const warned = verdicts.filter((v) => v.resolved && v.issues.length).length

  // ── editing ───────────────────────────────────────────────────────────────
  const setCell = useCallback((rowIdx: number, key: ColKey, value: string) => {
    setRows((prev) => {
      const next = prev.slice()
      next[rowIdx] = { ...next[rowIdx], cells: { ...next[rowIdx].cells, [key]: value }, err: null }
      return next
    })
  }, [])

  const addRows = (n = 1) => setRows((prev) => [...prev, ...Array.from({ length: n }, blankRow)])
  const removeRow = useCallback((rowIdx: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== rowIdx) : [blankRow()]))
  }, [])

  /** Write a parsed block into the grid at (r0,c0), growing rows as needed. */
  const applyBlock = (grid: string[][], r0: number, c0: number) => {
    const keys = columns.map((c) => c.key)
    setRows((prev) => {
      const next = prev.slice()
      grid.forEach((line, dr) => {
        const r = r0 + dr
        while (next.length <= r) next.push(blankRow())
        const cells = { ...next[r].cells }
        line.forEach((v, dc) => {
          const key = keys[c0 + dc]
          if (key) cells[key] = v.trim()
        })
        next[r] = { ...next[r], cells, err: null }
      })
      return next.slice(0, MAX_IMPORT_ROWS)
    })
  }

  /** A whole sheet (paste box / CSV file): header-matched, replaces the grid. */
  const loadSheet = (text: string) => {
    const grid = parseDelimited(text)
    if (!grid.length) { setBanner('Nothing readable in that — copy the rows including the header line.'); return }
    const { rows: parsed, headerUsed } = rowsFromGrid(grid)
    if (!parsed.length) { setBanner('No data rows found under that header.'); return }
    const capped = parsed.slice(0, MAX_IMPORT_ROWS)
    setRows(capped.map((cells) => ({ key: nextKey++, cells })))
    // A sheet with cost/spec data must not land in hidden columns unseen.
    const shown = new Set(columns.map((c) => c.key))
    if (capped.some((c) => Object.keys(c).some((k) => !shown.has(k as ColKey)))) setShowAll(true)
    setBanner(
      `${capped.length} row${capped.length === 1 ? '' : 's'} loaded` +
      (headerUsed ? ' — matched your header names' : ' — no header found, columns read left-to-right') +
      (parsed.length > capped.length ? ` (first ${MAX_IMPORT_ROWS} of ${parsed.length})` : '')
    )
  }

  const onGridPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return // single value — let it paste normally
    const el = e.target as HTMLElement
    const r0 = Number(el.dataset?.r ?? -1)
    const c0 = Number(el.dataset?.c ?? -1)
    if (r0 < 0 || c0 < 0) return
    e.preventDefault()
    const grid = parseDelimited(text)
    // Pasting the whole sheet into the first cell is the natural gesture —
    // honor its header row instead of writing "Name" into a name field.
    if (r0 === 0 && c0 === 0 && grid.length > 1) { loadSheet(text); return }
    applyBlock(grid, r0, c0)
    setBanner(`Pasted ${grid.length} row${grid.length === 1 ? '' : 's'}`)
  }

  /** Spreadsheet keys: Enter/arrows walk rows, Enter on the last row grows it. */
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement
    const r = Number(el.dataset?.r ?? -1)
    const c = Number(el.dataset?.c ?? -1)
    if (r < 0 || c < 0) return
    const isSelect = el.tagName === 'SELECT'
    let dr = 0
    if (e.key === 'Enter') dr = e.shiftKey ? -1 : 1
    else if (e.key === 'ArrowDown' && !isSelect) dr = 1
    else if (e.key === 'ArrowUp' && !isSelect) dr = -1
    else return
    e.preventDefault()
    const target = r + dr
    if (target < 0) return
    if (target >= rows.length) { if (dr > 0) addRows(1); else return }
    // Wait a tick when a row was just appended so the input exists.
    requestAnimationFrame(() => {
      const nextEl = gridRef.current?.querySelector<HTMLElement>(`[data-r="${target}"][data-c="${c}"]`)
      nextEl?.focus()
      if (nextEl instanceof HTMLInputElement) nextEl.select()
    })
  }

  // ── import ────────────────────────────────────────────────────────────────
  const runImport = async () => {
    const send: { gridIdx: number; cells: ImportRow }[] = []
    rows.forEach((r, i) => { if (verdicts[i]?.resolved) send.push({ gridIdx: i, cells: r.cells }) })
    if (!send.length) return
    setBusy(true)
    setBanner(null)
    try {
      const res = await bulkCreateAssetsAction(send.map((s) => s.cells))
      if (!res.ok || !res.results) { setBanner(res.error ?? 'Import failed.'); return }
      const failedIdx = new Map<number, string>()
      const madeIt: { id?: string; name: string }[] = []
      res.results.forEach((r) => {
        const target = send[r.i]
        if (!target) return
        if (r.ok) { if (r.name) madeIt.push({ id: r.id, name: r.name }) }
        else failedIdx.set(target.gridIdx, r.error ?? 'Could not save')
      })
      setImported((prev) => [...prev, ...madeIt])
      // Imported rows leave the grid; anything still broken stays, with the
      // server's reason attached, so the loop is "fix what's left, import again".
      setRows((prev) => {
        const kept = prev
          .map((row, i) => ({ row, i }))
          // Keep what failed server-side, plus anything never sent (still
          // broken, or blank). Everything else made it and leaves the grid.
          .filter(({ i }) => failedIdx.has(i) || !verdicts[i]?.resolved)
          .map(({ row, i }) => ({ ...row, err: failedIdx.get(i) ?? null }))
        return kept.length ? kept : [blankRow()]
      })
      const failed = failedIdx.size
      setBanner(
        `${res.created ?? 0} asset${res.created === 1 ? '' : 's'} added` +
        (failed ? ` · ${failed} couldn't be saved — see the rows below` : ' — they show on the map at their first report')
      )
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv(canViewCosts)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hammertrack-assets-template.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setBanner('That file is over 2 MB — split it into a couple of imports.'); return }
    loadSheet(await file.text())
  }

  const gridIsEmpty = !rows.some((r) => Object.values(r.cells).some((v) => (v ?? '').trim()))

  return (
    <div className="p-4 max-w-[1400px] mx-auto space-y-4">
      {/* header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <Table2 className="h-5 w-5 text-amber" /> Bulk add assets
          </h1>
          <p className="text-[13px] text-muted mt-1 max-w-2xl">
            Paste your fleet straight out of Excel or Sheets — we match your column headings,
            and guess each machine&apos;s type and map icon from its name. Fix anything flagged,
            import, then fine-tune names and rates on each asset later.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /><span className="hidden sm:inline">Template</span>
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-4 w-4" /><span className="hidden sm:inline">Upload CSV</span>
          </Button>
          <input
            ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
          />
          <Button asChild size="sm" variant="ghost" className="gap-1.5">
            <Link href="/assets"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Assets</span></Link>
          </Button>
        </div>
      </div>

      {isDemo && (
        <p className="text-[12.5px] text-amber bg-amber/10 border border-amber/30 rounded-lg px-3 py-2">
          Demo mode — the grid works, but importing needs your real account.
        </p>
      )}

      {banner && (
        <p className="text-[12.5px] text-ink bg-navy-900 border border-navy-700 rounded-lg px-3 py-2">{banner}</p>
      )}

      {/* the paste door — big while the grid is empty, a hint line after */}
      {gridIsEmpty ? (
        <label className="block rounded-xl border-2 border-dashed border-navy-700 bg-navy-950/60 p-6 text-center cursor-text hover:border-amber/50 transition-colors">
          <Upload className="h-6 w-6 text-faint mx-auto mb-2" />
          <p className="text-[13.5px] text-ink font-medium">Paste your spreadsheet here</p>
          <p className="text-[12px] text-faint mt-1">
            Copy the rows in Excel/Sheets (include the header row) and press ⌘V / Ctrl+V.
            Or type straight into the grid below.
          </p>
          <textarea
            className="sr-only"
            aria-label="Paste spreadsheet rows"
            onPaste={(e) => { e.preventDefault(); loadSheet(e.clipboardData.getData('text')) }}
            onChange={() => { /* paste-only */ }}
            value=""
          />
        </label>
      ) : (
        <p className="text-[11.5px] text-faint">
          Paste more rows anywhere in the grid · Enter moves down · {rows.length} row{rows.length === 1 ? '' : 's'} in the sheet
        </p>
      )}

      {/* summary + import */}
      <div className="flex items-center gap-3 flex-wrap sticky top-0 z-20 bg-navy-950/95 backdrop-blur py-2">
        <span className="text-[13px] text-ink font-semibold">
          {ready} ready
          {broken > 0 && <span className="text-alert font-normal"> · {broken} need fixing</span>}
          {warned > 0 && <span className="text-amber font-normal"> · {warned} worth a look</span>}
        </span>
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-[12px] text-muted hover:text-ink underline underline-offset-2"
        >
          {showAll ? 'Show just the essentials' : `Show all columns${hiddenWithData ? ' •' : ''}`}
        </button>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => addRows(5)}>
          <Plus className="h-4 w-4" /> 5 rows
        </Button>
        <Button
          size="sm" className="ml-auto gap-1.5 min-w-[132px]"
          disabled={busy || ready === 0 || isDemo}
          onClick={() => void runImport()}
        >
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <>Import {ready > 0 ? ready : ''} asset{ready === 1 ? '' : 's'}</>}
        </Button>
      </div>

      {/* the grid */}
      <div
        ref={gridRef}
        onPaste={onGridPaste}
        onKeyDown={onGridKeyDown}
        className="overflow-x-auto rounded-xl border border-navy-800 bg-navy-950/40"
      >
        <table className="border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-navy-900 border-b border-r border-navy-800 px-2 py-2 w-[52px]" />
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ minWidth: col.width }}
                  className="bg-navy-900 border-b border-navy-800 px-2 py-2 text-left align-bottom"
                >
                  <div className="font-semibold text-ink">
                    {col.label}{col.key === 'name' && <span className="text-alert"> *</span>}
                  </div>
                  {col.hint && <div className="text-[10.5px] text-faint font-normal">{col.hint}</div>}
                </th>
              ))}
              <th className="bg-navy-900 border-b border-navy-800 w-[40px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <Row
                key={row.key}
                idx={i}
                row={row}
                columns={columns}
                verdict={verdicts[i]}
                onCell={setCell}
                onRemove={removeRow}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => addRows(1)}>
          <Plus className="h-4 w-4" /> Add row
        </Button>
        <span className="text-[11.5px] text-faint">Up to {MAX_IMPORT_ROWS} rows per import.</span>
      </div>

      {/* what's wrong, in words */}
      {broken > 0 && (
        <div className="rounded-xl border border-alert/30 bg-alert/5 p-3 space-y-1.5">
          <p className="text-[12.5px] font-semibold text-alert flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {broken} row{broken === 1 ? '' : 's'} can&apos;t import yet
          </p>
          {verdicts.map((v, i) => (!v.empty && !v.resolved ? (
            <p key={i} className="text-[12px] text-muted">
              <span className="font-mono text-faint">Row {i + 1}</span>{' '}
              {v.issues.filter((x) => x.level === 'error').map((x) => x.text).join(' · ')}
              {rows[i]?.err ? ` · ${rows[i].err}` : ''}
            </p>
          ) : null))}
        </div>
      )}

      {/* warnings import fine — but a hover tooltip is invisible on a phone,
          so the reason gets said out loud here too. */}
      {warned > 0 && (
        <div className="rounded-xl border border-amber/30 bg-amber/5 p-3 space-y-1.5">
          <p className="text-[12.5px] font-semibold text-amber flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {warned} row{warned === 1 ? '' : 's'} worth a look — these still import
          </p>
          {verdicts.map((v, i) => (v.resolved && v.issues.length ? (
            <p key={i} className="text-[12px] text-muted">
              <span className="font-mono text-faint">Row {i + 1}</span>{' '}
              {v.issues.map((x) => x.text).join(' · ')}
            </p>
          ) : null))}
        </div>
      )}

      {/* what landed */}
      {imported.length > 0 && (
        <div className="rounded-xl border border-teal/30 bg-teal/5 p-3">
          <p className="text-[12.5px] font-semibold text-teal flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="h-4 w-4" /> {imported.length} asset{imported.length === 1 ? '' : 's'} added
          </p>
          <div className="flex flex-wrap gap-1.5">
            {imported.map((a, i) => (
              a.id
                ? <Link key={i} href={`/assets/${a.id}`} className="text-[12px] rounded-md border border-navy-700 bg-navy-900 px-2 py-1 text-ink hover:border-amber/50">{a.name}</Link>
                : <span key={i} className="text-[12px] rounded-md border border-navy-700 bg-navy-900 px-2 py-1 text-muted">{a.name}</span>
            ))}
          </div>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href="/assets">Open the assets list</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

// ── one row (memoized: a 300-row sheet must not re-render everything per key)
const Row = memo(function Row({
  idx, row, columns, verdict, onCell, onRemove,
}: {
  idx: number
  row: GridRow
  columns: ColDef[]
  verdict: RowVerdict | undefined
  onCell: (rowIdx: number, key: ColKey, value: string) => void
  onRemove: (rowIdx: number) => void
}) {
  const issueFor = (key: ColKey) => verdict?.issues.find((x) => x.col === key)
  const name = (row.cells.name ?? '').trim()
  const inferred = inferFromName(name)
  const typeVal = (row.cells.type ?? '').trim()
  const effectiveType = (verdict?.resolved?.type ?? null)

  return (
    <tr className={verdict && !verdict.empty && !verdict.resolved ? 'bg-alert/[0.06]' : undefined}>
      <td className="sticky left-0 z-10 bg-navy-950 border-b border-r border-navy-800 px-2 py-1 text-center">
        <span className="font-mono text-[11px] text-faint">{idx + 1}</span>
      </td>
      {columns.map((col, c) => {
        const issue = issueFor(col.key)
        const ring = issue?.level === 'error' ? 'border-alert/70 bg-alert/10'
          : issue?.level === 'warn' ? 'border-amber/60 bg-amber/5'
            : 'border-navy-800'
        const common = `w-full bg-transparent border rounded px-1.5 py-1 text-ink outline-none focus:border-amber/60 ${ring}`
        return (
          <td key={col.key} className="border-b border-navy-800 px-1 py-0.5 align-top">
            {col.kind === 'type' ? (
              <select
                data-r={idx} data-c={c} value={typeVal} title={issue?.text}
                onChange={(e) => onCell(idx, 'type', e.target.value)}
                className={common + ' cursor-pointer'}
              >
                <option value="">{inferred.type ? `Auto — ${inferred.type}` : '— pick —'}</option>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : col.kind === 'icon' ? (
              <select
                data-r={idx} data-c={c} value={(row.cells.icon ?? '').trim()} title={issue?.text}
                onChange={(e) => onCell(idx, 'icon', e.target.value)}
                className={common + ' cursor-pointer'}
              >
                <option value="">
                  {`Auto — ${inferred.icon ?? (effectiveType ? TYPE_DEFAULT_ICON[effectiveType] : 'by type')}`}
                </option>
                {ICON_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {Object.entries(ASSET_ICONS).filter(([, d]) => d.group === g).map(([key, d]) => (
                      <option key={key} value={key}>{d.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input
                data-r={idx} data-c={c} value={row.cells[col.key] ?? ''} title={issue?.text}
                onChange={(e) => onCell(idx, col.key, e.target.value)}
                inputMode={col.kind === 'number' ? 'decimal' : undefined}
                // 16px on touch or iOS Safari zooms the whole grid on focus.
                className={common + ' text-[16px] md:text-[12.5px]'}
                placeholder={col.key === 'name' ? 'e.g. 2019 Ram 3500 Dump' : ''}
              />
            )}
          </td>
        )
      })}
      <td className="border-b border-navy-800 px-1 text-center align-top">
        <button
          onClick={() => onRemove(idx)}
          aria-label={`Remove row ${idx + 1}`}
          className="p-1 text-faint hover:text-alert"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
})
