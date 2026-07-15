import { describe, expect, it } from 'vitest'
import { riverbend } from '@/data/entities/riverbend'
import { buildBudgetTree, findNode, layoutTreemap, pathTo, totalBudget, yoyByDepartment } from '../budget'
import { projectHealth } from '../projects'

describe('buildBudgetTree', () => {
  const tree = buildBudgetTree(riverbend, 2026)

  it('rolls divisions and lines up into department and fund totals', () => {
    const general = findNode(tree, 'general')!
    const police = findNode(tree, 'general.police')!
    expect(police.amount).toBe(24_600_000)
    expect(general.amount).toBe(83_200_000)
    expect(tree.amount).toBe(totalBudget(riverbend, 2026))
  })

  it('nests divisions under departments with inherited color slots', () => {
    const patrol = findNode(tree, 'general.police.police-patrol')!
    expect(patrol.kind).toBe('division')
    expect(patrol.colorSlot).toBe(1)
    expect(patrol.amount).toBe(14_200_000)
  })

  it('builds breadcrumb paths', () => {
    const path = pathTo(tree, 'general.police.police-patrol')
    expect(path.map((n) => n.name)).toEqual(['All funds', 'General Fund', 'Police', 'Patrol'])
  })
})

describe('layoutTreemap', () => {
  it('tiles children to fill the box, preserving total area proportions', () => {
    const tree = buildBudgetTree(riverbend, 2026)
    const tiles = layoutTreemap(findNode(tree, 'general')!, 800, 500)
    expect(tiles.length).toBe(7) // 7 general-fund departments
    for (const t of tiles) {
      expect(t.width).toBeGreaterThan(0)
      expect(t.height).toBeGreaterThan(0)
      expect(t.x + t.width).toBeLessThanOrEqual(800.01)
      expect(t.y + t.height).toBeLessThanOrEqual(500.01)
    }
    // Largest department gets the largest tile.
    const largest = tiles.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b))
    expect(largest.node.name).toBe('Police')
  })
})

describe('yoyByDepartment', () => {
  it('computes deltas against the prior year', () => {
    const yoy = yoyByDepartment(riverbend, 2026, 2025)
    const police = yoy.find((d) => d.departmentId === 'police')!
    expect(police.current).toBe(24_600_000)
    expect(police.prior).toBe(23_100_000)
    expect(police.delta).toBe(1_500_000)
    expect(police.deltaPct).toBeCloseTo(0.0649, 3)
  })
})

describe('projectHealth (derived, today = 2026-07-15)', () => {
  const bySlug = new Map(riverbend.projects.map((p) => [p.slug, p]))

  it('derives every health state from the demo pack', () => {
    expect(projectHealth(bySlug.get('fire-station-4-replacement')!)).toBe('on_track')
    expect(projectHealth(bySlug.get('cedar-creek-greenway-phase-2')!)).toBe('at_risk') // 75% spent vs 50% built
    expect(projectHealth(bySlug.get('main-street-streetscape')!)).toBe('over_budget') // 101.6% spent
    expect(projectHealth(bySlug.get('elm-5th-signal-modernization')!)).toBe('delayed') // past May 2026 deadline
    expect(projectHealth(bySlug.get('westside-community-center')!)).toBe('complete')
  })
})
