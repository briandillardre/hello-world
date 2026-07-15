'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import type { EntityDataPack } from '@/lib/types'
import { buildBudgetTree, findNode, pathTo, yoyByDepartment } from '@/lib/budget'
import { money, fyLabel } from '@/lib/format'
import { Treemap } from '@/components/charts/Treemap'
import { YoYBars } from '@/components/charts/YoYBars'

function BudgetExplorerInner({ pack }: { pack: EntityDataPack }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const years = [...pack.fiscalYears].sort((a, b) => b - a)
  const paramFy = Number(searchParams.get('fy'))
  const initialFy = years.includes(paramFy) ? paramFy : pack.entity.currentFiscalYear

  // Land on the general fund's department map — the story — not the flat fund view.
  const defaultPath = pack.funds.find((f) => f.kind === 'general')?.id ?? 'root'
  const [fy, setFy] = useState(initialFy)
  const [path, setPath] = useState(searchParams.get('path') ?? defaultPath)

  const tree = useMemo(() => buildBudgetTree(pack, fy), [pack, fy])
  const node = findNode(tree, path) ?? tree
  const crumbs = pathTo(tree, node.id)

  useEffect(() => {
    const params = new URLSearchParams()
    if (fy !== pack.entity.currentFiscalYear) params.set('fy', String(fy))
    if (node.id !== defaultPath) params.set('path', node.id)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [fy, node.id, pathname, router, pack.entity.currentFiscalYear, defaultPath])

  const priorFy = years.find((y) => y < fy)
  const yoy = priorFy ? yoyByDepartment(pack, fy, priorFy) : []

  return (
    <div>
      {/* FY switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-grid bg-surface p-1" role="tablist" aria-label="Fiscal year">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={y === fy}
              onClick={() => {
                setFy(y)
                setPath(defaultPath)
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                y === fy ? 'bg-ink text-white' : 'text-ink2 hover:text-ink'
              }`}
            >
              {fyLabel(y)}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink2">
          {node.name}: <strong className="tabular text-ink">{money(node.amount)}</strong>
        </p>
      </div>

      {/* Breadcrumbs */}
      <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm" aria-label="Budget drill-down path">
        {crumbs.map((crumb, i) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />}
            {i < crumbs.length - 1 ? (
              <button type="button" onClick={() => setPath(crumb.id)} className="text-brand hover:underline">
                {crumb.name}
              </button>
            ) : (
              <span className="font-medium">{crumb.name}</span>
            )}
          </span>
        ))}
      </nav>

      {node.blurb && <p className="mt-2 text-sm text-ink2">{node.blurb}</p>}

      {/* Treemap */}
      <div className="mt-4 rounded-xl border border-grid bg-surface p-2">
        {node.children?.length ? (
          <Treemap node={node} onDrill={setPath} />
        ) : (
          <p className="p-8 text-center text-sm text-muted">This is a single line item — nothing further to drill into.</p>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Tile size = share of {node.name === 'All funds' ? 'the total budget' : node.name}. Click a tile to drill in; hover for exact figures.
      </p>

      {/* YoY */}
      {priorFy && (node.id === 'root' || node.id === defaultPath) && yoy.length > 0 && (
        <div className="mt-8 rounded-xl border border-grid bg-surface p-5">
          <YoYBars deltas={yoy} fy={fy} priorFy={priorFy} />
        </div>
      )}
    </div>
  )
}

export function BudgetExplorer({ pack }: { pack: EntityDataPack }) {
  return (
    <Suspense>
      <BudgetExplorerInner pack={pack} />
    </Suspense>
  )
}
