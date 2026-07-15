import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'
import type { EntityDataPack } from './types'

export interface BudgetNode {
  id: string // stable path id, e.g. 'general.police.patrol'
  name: string
  kind: 'root' | 'fund' | 'department' | 'division' | 'line'
  colorSlot?: number // top-level department slot; children inherit
  depth: number
  amount: number
  blurb?: string
  children?: BudgetNode[]
}

/** Build the fund → department → division → line tree for one fiscal year. */
export function buildBudgetTree(pack: EntityDataPack, fiscalYear: number): BudgetNode {
  const deptsByFund = new Map<string, typeof pack.departments>()
  for (const d of pack.departments.filter((d) => !d.parentId)) {
    const list = deptsByFund.get(d.fundId) ?? []
    list.push(d)
    deptsByFund.set(d.fundId, list)
  }
  const childrenOf = (parentId: string) => pack.departments.filter((d) => d.parentId === parentId)
  const linesFor = (departmentId: string) =>
    pack.budgetLines.filter((l) => l.fiscalYear === fiscalYear && l.departmentId === departmentId)

  const deptNode = (
    d: (typeof pack.departments)[number],
    path: string,
    kind: 'department' | 'division',
    slot: number,
  ): BudgetNode | null => {
    const divisions = childrenOf(d.id)
      .map((div) => deptNode(div, `${path}.${div.id}`, 'division', slot))
      .filter((n): n is BudgetNode => n !== null)
    const lines: BudgetNode[] = linesFor(d.id).map((l) => ({
      id: `${path}.${l.id}`,
      name: l.label,
      kind: 'line',
      colorSlot: slot,
      depth: 0,
      amount: l.amount,
    }))
    const children = [...divisions, ...lines]
    if (children.length === 0) return null
    return {
      id: path,
      name: d.name,
      kind,
      colorSlot: slot,
      depth: 0,
      amount: children.reduce((s, c) => s + c.amount, 0),
      blurb: d.blurb,
      children,
    }
  }

  const fundNodes: BudgetNode[] = []
  for (const fund of pack.funds) {
    const depts = (deptsByFund.get(fund.id) ?? [])
      .map((d) => deptNode(d, `${fund.id}.${d.id}`, 'department', d.colorSlot))
      .filter((n): n is BudgetNode => n !== null)
    if (depts.length === 0) continue
    fundNodes.push({
      id: fund.id,
      name: fund.name,
      kind: 'fund',
      depth: 0,
      amount: depts.reduce((s, d) => s + d.amount, 0),
      blurb: fund.description,
      children: depts,
    })
  }

  return {
    id: 'root',
    name: 'All funds',
    kind: 'root',
    depth: 0,
    amount: fundNodes.reduce((s, f) => s + f.amount, 0),
    children: fundNodes,
  }
}

export function findNode(root: BudgetNode, id: string): BudgetNode | null {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const hit = findNode(child, id)
    if (hit) return hit
  }
  return null
}

/** Breadcrumb path from root to the node with `id`. */
export function pathTo(root: BudgetNode, id: string): BudgetNode[] {
  if (root.id === id) return [root]
  for (const child of root.children ?? []) {
    const sub = pathTo(child, id)
    if (sub.length > 0) return [root, ...sub]
  }
  return []
}

export interface TreemapTile {
  node: BudgetNode
  x: number
  y: number
  width: number
  height: number
}

/**
 * Lay out the DIRECT children of `node` as treemap tiles in a w×h box.
 * Pure math (no DOM) — the same function drives the interactive explorer
 * and the edge-rendered OG images.
 */
export function layoutTreemap(node: BudgetNode, width: number, height: number): TreemapTile[] {
  if (!node.children || node.children.length === 0) return []
  const shallow: BudgetNode = { ...node, children: node.children.map((c) => ({ ...c, children: undefined })) }
  const root = hierarchy<BudgetNode>(shallow)
    .sum((d) => (d.children ? 0 : d.amount))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const layout = treemap<BudgetNode>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2) // the 2px surface gap between adjacent fills
  const laid = layout(root) as HierarchyRectangularNode<BudgetNode>
  return (laid.children ?? []).map((leaf) => {
    const original = node.children!.find((c) => c.id === leaf.data.id)!
    return {
      node: original,
      x: leaf.x0,
      y: leaf.y0,
      width: leaf.x1 - leaf.x0,
      height: leaf.y1 - leaf.y0,
    }
  })
}

export interface YoYDelta {
  departmentId: string
  name: string
  colorSlot: number
  current: number
  prior: number
  delta: number
  deltaPct: number | null // null when prior is 0
}

/** Year-over-year change per top-level department (all funds). */
export function yoyByDepartment(pack: EntityDataPack, fy: number, priorFy: number): YoYDelta[] {
  const parentOf = new Map(pack.departments.map((d) => [d.id, d.parentId]))
  const topLevel = (id: string): string => {
    const parent = parentOf.get(id)
    return parent ? topLevel(parent) : id
  }
  const sums = new Map<string, { current: number; prior: number }>()
  for (const line of pack.budgetLines) {
    if (line.fiscalYear !== fy && line.fiscalYear !== priorFy) continue
    const top = topLevel(line.departmentId)
    const entry = sums.get(top) ?? { current: 0, prior: 0 }
    if (line.fiscalYear === fy) entry.current += line.amount
    else entry.prior += line.amount
    sums.set(top, entry)
  }
  return pack.departments
    .filter((d) => !d.parentId && sums.has(d.id))
    .map((d) => {
      const { current, prior } = sums.get(d.id)!
      return {
        departmentId: d.id,
        name: d.name,
        colorSlot: d.colorSlot,
        current,
        prior,
        delta: current - prior,
        deltaPct: prior > 0 ? (current - prior) / prior : null,
      }
    })
    .sort((a, b) => b.current - a.current)
}

export function totalBudget(pack: EntityDataPack, fy: number): number {
  return pack.budgetLines.filter((l) => l.fiscalYear === fy).reduce((s, l) => s + l.amount, 0)
}
