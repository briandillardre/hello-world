import Link from 'next/link'
import { FileStack, ChevronRight } from 'lucide-react'
import { getPlanRoom } from '@/lib/db/plans'
import { getRealPermissions } from '@/lib/permissions-server'
import { revLabel, setKindLabel } from '@/lib/plans/room'
import { ZonePlans } from '@/components/zones/ZonePlans'
import type { ZoneImage } from '@/lib/actions/imagery'

const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The site page's Plans card (migration 143): what the plan room holds, the
 * sheets revised most recently, and the way in. Before 143 is on the
 * database it falls back to the old Scaled plans list.
 */
export async function PlanRoomCard({ zoneId, legacy, canEdit, ring }: {
  zoneId: string
  legacy: ZoneImage[]
  canEdit: boolean
  ring: [number, number][] | null
}) {
  const real = await getRealPermissions()
  const room = await getPlanRoom(zoneId, real.userId)
  if (room.failed) {
    return (
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 mb-2"><FileStack className="h-3.5 w-3.5" /> Plans</h2>
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          Couldn’t load the plans just now — refresh the page, or <Link href={`/plans/${zoneId}`} className="text-teal underline">open the plan room</Link>.
        </p>
      </section>
    )
  }
  if (!room.available) {
    return <ZonePlans zoneId={zoneId} initial={legacy} canEdit={canEdit} ring={ring} />
  }
  const live = room.sheets.filter((s) => !s.voidedAt)
  const newCount = live.filter((s) => s.isNew).length
  const newest = room.sets[0] ?? null
  const recent = live
    .map((s) => ({ s, cur: s.versions.find((v) => v.id === s.currentId) ?? null }))
    .sort((a, b) => Number(b.s.isNew) - Number(a.s.isNew) || (b.cur?.createdAt ?? '').localeCompare(a.cur?.createdAt ?? ''))
    .slice(0, 4)

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 flex-1">
          <FileStack className="h-3.5 w-3.5" /> Plans
          {live.length > 0 && <span className="normal-case tracking-normal">· {live.length} sheet{live.length === 1 ? '' : 's'}</span>}
          {newCount > 0 && <span className="normal-case tracking-normal text-amber font-semibold">· {newCount} new to you</span>}
        </h2>
        <Link href={`/plans/${zoneId}`} className="rounded-lg bg-navy-800 border border-navy-700 text-muted hover:text-ink text-[11px] font-semibold px-2.5 py-1">
          {live.length ? 'Open plan room' : '+ Add a set'}
        </Link>
      </div>
      {live.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No plans yet. Add the bid set’s PDF — every page files under its sheet number, and each addendum lands on top as a new revision.
        </p>
      ) : (
        <Link href={`/plans/${zoneId}`} className="block rounded-xl border border-navy-800 bg-navy-900 hover:bg-navy-800/50">
          {newest && (
            <p className="px-3 pt-2.5 text-[11.5px] text-faint">
              Newest set: <span className="text-muted">{newest.name}</span> · {setKindLabel(newest.kind)} · {fmtDay(newest.issuedOn)}
            </p>
          )}
          <div className="divide-y divide-navy-800">
            {recent.map(({ s, cur }) => (
              <div key={s.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className={'h-2 w-2 rounded-full flex-none ' + (s.isNew ? 'bg-amber' : 'bg-transparent')} />
                <span className="font-mono text-[12.5px] font-bold text-ink w-16 truncate">{s.number}</span>
                <span className="text-[12px] text-muted flex-1 truncate">{s.title ?? ''}</span>
                <span className="text-[11px] text-faint whitespace-nowrap">{revLabel(cur?.rev)}{cur ? ` · ${fmtDay(cur.issuedOn)}` : ''}</span>
              </div>
            ))}
          </div>
          <p className="px-3 pb-2.5 pt-1 text-[11.5px] text-teal flex items-center gap-1">All sheets and sets <ChevronRight className="h-3.5 w-3.5" /></p>
        </Link>
      )}
    </section>
  )
}
