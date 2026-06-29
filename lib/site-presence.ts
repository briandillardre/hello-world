/**
 * Live site presence — who/what is inside a geofence right now, plus the cost
 * accruing there today. Powers the tap-a-zone popover on the map.
 */
import type { AssetWithLocation, AssetType, Geofence } from './types'
import type { TimeRange } from './trails'
import { pointInPolygon } from './alerts-engine'
import { PROJECTS, periodCost, presenceCost, moneyFull, RANGE_COST_LABEL } from './projects'

export interface SitePresence {
  total: number
  byType: Record<AssetType, number>
  insideIds: string[]
}

export function geofencePresence(g: Geofence, assets: AssetWithLocation[]): SitePresence {
  const ring = g.geometry.coordinates[0] as [number, number][]
  const byType: Record<AssetType, number> = { vehicle: 0, equipment: 0, personnel: 0, tool: 0 }
  const insideIds: string[] = []
  for (const a of assets) {
    if (!a.location) continue
    if (pointInPolygon([a.location.lng, a.location.lat], ring)) {
      byType[a.type]++
      insideIds.push(a.id)
    }
  }
  return { total: insideIds.length, byType, insideIds }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function statRow(emoji: string, label: string, n: number): string {
  return `<div style="display:flex;align-items:center;gap:6px;font-family:monospace;font-size:11px;color:#9fb6cc">
      <span>${emoji}</span><span style="flex:1">${label}</span>
      <span style="color:#e8f0f7;font-weight:700">${n}</span></div>`
}

/** Themed popover for a tapped job-site zone (rendered via maplibre setHTML).
 *  Cost reflects the same range + scrub position as the timeline. */
export function presencePopupHTML(g: Geofence, p: SitePresence, range: TimeRange = 'live', t = 1): string {
  // Named projects use their own rates; any other zone gets a live estimate from
  // the assets currently inside it (so drawn zones still show a cost).
  const project = PROJECTS.find((pr) => pr.geofenceId === g.id)
  const cost = project ? periodCost(project, range, t) : presenceCost(p.byType, range, t)
  const estimated = !project
  const costLabel = `${estimated ? 'Est. cost' : 'Cost'} · ${RANGE_COST_LABEL[range]}`

  const costBlock = cost.total > 0
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #14506f">
        <div style="font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#6f88a0">${esc(costLabel)}</div>
        <div style="font-family:Archivo,sans-serif;font-weight:900;font-size:20px;color:#ff9e16">${esc(moneyFull(cost.total))}</div>
        <div style="font-family:monospace;font-size:10px;color:#6f88a0">${esc(moneyFull(cost.labor))} labor + ${esc(moneyFull(cost.equip))} equipment</div>
      </div>`
    : `<div style="margin-top:8px;font-family:monospace;font-size:10px;color:#6f88a0">No assets on site</div>`

  return `<div style="width:205px;background:#001a2e;color:#e8f0f7;border-radius:12px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #14506f">
      <span style="width:9px;height:9px;border-radius:50%;background:${g.color};display:inline-block"></span>
      <span style="font-family:Archivo,sans-serif;font-weight:800;font-size:13px;color:#e8f0f7">${esc(g.name)}</span>
    </div>
    <div style="padding:9px 12px">
      <div style="font-family:Archivo,sans-serif;font-weight:900;font-size:22px;color:#e8f0f7;line-height:1">${p.total}<span style="font-size:11px;font-weight:600;color:#9fb6cc"> on site</span></div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
        ${statRow('👷', 'Crew', p.byType.personnel)}
        ${statRow('🏗️', 'Equipment', p.byType.equipment)}
        ${statRow('🚛', 'Vehicles', p.byType.vehicle)}
        ${statRow('🔧', 'Tools', p.byType.tool)}
      </div>
      ${costBlock}
    </div>
  </div>`
}
