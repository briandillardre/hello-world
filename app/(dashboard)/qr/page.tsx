import { getCurrentCompanyId } from '@/lib/db/company'
import { getQrAssets } from '@/lib/db/fieldops'
import { PrintButton } from '@/components/field/PrintButton'

export const dynamic = 'force-dynamic'

/**
 * Printable QR sticker sheet — one card per machine. Print on adhesive label
 * stock (or laminate paper stickers), stick at the operator's eye line.
 */
export default async function QrSheetPage() {
  const companyId = await getCurrentCompanyId()
  const assets = (await getQrAssets(companyId)).filter((a) => a.qr_slug)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 mb-4 print:hidden">
        <div>
          <h1 className="font-display font-bold text-xl text-ink">QR stickers</h1>
          <p className="text-[12.5px] text-faint">
            Print, laminate, stick on the machine (door jamb / ROPS post). Scanning opens the
            one-tap check-in: greased, fueled, radiator, air filter.
          </p>
        </div>
        <PrintButton />
      </div>

      {assets.length === 0 ? (
        <div className="rounded-xl border border-navy-700 bg-navy-950 p-8 text-center">
          <p className="text-sm text-muted">
            No equipment or vehicles with QR codes yet. Run migration{' '}
            <span className="font-mono text-teal">015_field_ops.sql</span> — it assigns a code to every asset automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 print:grid-cols-3">
          {assets.map((a) => (
            <div key={a.id} className="rounded-xl border border-navy-700 bg-white p-4 text-center print:break-inside-avoid">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/qr/${a.qr_slug}`} alt={`QR for ${a.name}`} className="w-full aspect-square" />
              <p className="mt-2 font-display font-bold text-[13px] text-[#001523] leading-tight">{a.name}</p>
              <p className="font-mono text-[9px] text-[#6f88a0] uppercase tracking-[0.1em]">Scan to log service</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
