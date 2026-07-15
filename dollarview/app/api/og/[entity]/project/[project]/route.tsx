import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { getPack } from '@/data/registry'
import { HEALTH_LABEL, projectHealth, spentPct } from '@/lib/projects'
import { money } from '@/lib/format'
import { STATUS } from '@/lib/palette'

export const runtime = 'edge'

const HEALTH_COLOR: Record<string, string> = {
  on_track: STATUS.good,
  at_risk: '#8a5a00',
  delayed: '#9a3d12',
  over_budget: STATUS.critical,
  complete: '#52514e',
}

export function GET(_request: NextRequest, { params }: { params: { entity: string; project: string } }) {
  const pack = getPack(params.entity)
  const project = pack?.projects.find((p) => p.slug === params.project)
  if (!pack || !project) return new Response('Not found', { status: 404 })

  const health = projectHealth(project)
  const pct = spentPct(project)
  const over = pct > 100

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#fcfcfb',
          padding: 56,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              fontWeight: 700,
              color: HEALTH_COLOR[health],
              border: `3px solid ${HEALTH_COLOR[health]}`,
              borderRadius: 999,
              padding: '8px 24px',
            }}
          >
            {HEALTH_LABEL[health].toUpperCase()}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#2a78d6' }}>DollarView</div>
        </div>

        <div style={{ fontSize: 56, fontWeight: 700, color: '#0b0b0b', marginTop: 40, lineHeight: 1.15 }}>{project.name}</div>
        <div style={{ fontSize: 28, color: '#52514e', marginTop: 16 }}>
          {`${money(project.spentToDate)} spent of ${money(project.budget)} · ${project.percentComplete}% built`}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44 }}>
          <div style={{ display: 'flex', height: 34, width: 1080, backgroundColor: '#e1e0d9', borderRadius: 17 }}>
            <div
              style={{
                height: 34,
                width: Math.min(100, pct) * 10.8,
                backgroundColor: over ? STATUS.critical : '#2a78d6',
                borderRadius: 17,
              }}
            />
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: over ? STATUS.critical : '#0b0b0b', marginTop: 14 }}>
            {`${pct.toFixed(0)}% of budget spent${over ? ` — ${money(project.spentToDate - project.budget)} over` : ''}`}
          </div>
        </div>

        <div style={{ marginTop: 'auto', fontSize: 20, color: '#898781' }}>
          {`${pack.entity.name}${pack.entity.isDemo ? ' · fictional demo data' : ''} · every project, every dollar · DollarView`}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
