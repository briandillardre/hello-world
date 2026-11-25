import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getCostBook } from '@/lib/db/estimate'
import { getInvoices, getInvoiceSites } from '@/lib/db/invoices'
import { InvoicesView } from '@/components/estimate/InvoicesView'

export const metadata = { title: 'Supplier invoices — HammerTrack' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Supplier invoices (migration 165): read off the PDF or photo, filed into the cost book's prices and the job's cost, with what's owed. */
export default async function Page() {
  const perms = await requireFeature('plans')
  if (!perms.canViewCosts) notFound()
  const [{ invoices }, book, sites] = await Promise.all([getInvoices(), getCostBook(rankOf(perms) >= RANK.admin), getInvoiceSites()])
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock
  return (
    <InvoicesView invoices={invoices} materials={book.materials} sources={book.sources} sites={sites}
      canEdit={canEdit} canManage={canEdit && rankOf(perms) >= RANK.manager} demo={isMock} />
  )
}
