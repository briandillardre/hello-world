import { requireBetaTool } from '@/lib/beta/server'
import { EspanolView } from '@/components/beta/EspanolView'

export const metadata = { title: 'HammerTrack — Español' }
export const dynamic = 'force-dynamic'

export default async function EspanolPage() {
  const { demo } = await requireBetaTool('espanol')
  return <EspanolView demo={demo} />
}
