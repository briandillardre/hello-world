import { FullPageLoading } from '@/components/ui/loading'

/**
 * Branded skeleton for every dashboard route transition — a shimmering layout
 * ghost instead of a blank flash while server components fetch. Composed from
 * the shared loading kit (components/ui/loading.tsx) so every route speaks
 * the same loading language.
 */
export default function DashboardLoading() {
  return <FullPageLoading />
}
