import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getSiteTakeoff, siteTakeoffAddonActive } from '@/lib/db/site-takeoff'
import { getGeofence } from '@/lib/db/zones'
import { computeSite, money, qtyLabel } from '@/lib/site-takeoff/measure'
import { UNIT_LABEL } from '@/lib/site-takeoff/items'
import { checkSiteDesign } from '@/lib/site-takeoff/schema'
import PrintButton from '@/components/site-takeoff/PrintButton'

export const dynamic = 'force-dynamic'

/** The printable quantity sheet of the last SAVED site takeoff. */
export default async function SiteTakeoffPrintPage({ params }: { params: { id: string } }) {
  const perms = await requireFeature('zones')
  if (isProspect(perms)) notFound()
  const companyId = await getCurrentCompanyId()
  if (!(await siteTakeoffAddonActive(companyId))) notFound()
  const t = await getSiteTakeoff(params.id)
  if (!t) notFound()
  const zone = t.zoneId ? await getGeofence(t.zoneId) : null
  const chk = checkSiteDesign(t.design)
  const r = t.results ?? (chk.ok ? computeSite(chk.design) : null)
  const rows = r?.items.filter(i => i.marks > 0) ?? []
  const when = new Date(t.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  return (
    <div className="min-h-screen bg-white px-4 py-6 text-black ht-page-inset print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{t.name}</h1>
            <p className="text-sm text-gray-600">{zone?.name ?? 'Site'} · saved {when}</p>
          </div>
          <PrintButton />
        </div>
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1.5 pr-2">Line item</th>
              <th className="py-1.5 pr-2">Quantity</th>
              <th className="py-1.5 pr-2 text-right">Unit price</th>
              <th className="py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="py-3 text-gray-600">Nothing measured yet.</td></tr>}
            {rows.map(i => (
              <tr key={i.id} className="border-b border-gray-300 align-top">
                <td className="py-1.5 pr-2 font-medium">{i.name}</td>
                <td className="py-1.5 pr-2">{qtyLabel(i)}</td>
                <td className="py-1.5 pr-2 text-right">{i.price != null ? `${money(i.price)} / ${UNIT_LABEL[i.priceUnit]}` : '—'}</td>
                <td className="py-1.5 text-right">{i.total != null ? money(i.total) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td className="py-2" colSpan={3}>Total</td>
              <td className="py-2 text-right">{money(r?.total ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-xs text-gray-600">Measured on the ground from the site picture (UTM, scale-corrected). Quantities found with the assist were checked by the estimator before saving.</p>
      </div>
    </div>
  )
}
