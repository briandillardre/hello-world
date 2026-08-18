import Link from 'next/link'
import { cookies } from 'next/headers'
import { getAssetByQrSlug } from '@/lib/db/fieldops'
import { DEFAULT_TZ } from '@/lib/dates'
import { CheckButtons } from '@/components/field/CheckButtons'
import { Logo } from '@/components/brand/Logo'

export const dynamic = 'force-dynamic'

/**
 * QR sticker landing page — what opens when a worker scans the sticker on a
 * machine. Deliberately bare: the machine's name and six giant buttons.
 * Requires a signed-in session (RLS returns nothing otherwise).
 */
export default async function TagPage({ params }: { params: { slug: string } }) {
  const { asset, checks } = await getAssetByQrSlug(params.slug)
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)

  return (
    <main className="min-h-dvh bg-navy-950 text-ink">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <Logo size={22} href="/map" />
          <Link href="/clock" className="text-[12px] font-semibold text-teal">Time clock →</Link>
        </div>

        {asset ? (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Machine check-in</p>
            <h1 className="font-display font-bold text-2xl text-ink mb-4">{asset.name}</h1>
            <CheckButtons assetId={asset.id} checks={checks} tz={tz} />
          </>
        ) : (
          <div className="rounded-xl border border-navy-700 bg-navy-950 p-6 text-center mt-8">
            <p className="text-sm text-muted mb-3">
              Sign in first, then scan the sticker again — the machine page needs to know who&apos;s logging the work.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent('/t/' + params.slug)}`}
              className="inline-block rounded-lg bg-amber text-[#1a1100] font-display font-bold px-5 py-2.5 hover:brightness-110 transition"
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
