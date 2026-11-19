/**
 * The gate every Beta page runs: the Beta view level, then the tool's own
 * rule (lib/beta/tools.ts). A tool the login can't open 404s — the same rule
 * as every other page: what isn't yours doesn't exist.
 */
import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { toolByKey, type ToolKey } from './tools'

export const isMockMode = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Is this the platform owner's own company (the founder)? */
export async function isFounder(companyId: string): Promise<boolean> {
  if (isMockMode) return false
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { isPlatformOwnerCompany } = await import('@/lib/digest-delivery')
    return await isPlatformOwnerCompany(createServiceClient(), companyId)
  } catch {
    return false
  }
}

export async function requireBetaTool(key: ToolKey) {
  const perms = await requireFeature('beta')
  const companyId = await getCurrentCompanyId()
  const founder = key === 'activation' ? perms.isMaster && !perms.viewingAs && await isFounder(companyId) : false
  if (!toolByKey(key).canOpen(perms, founder)) notFound()
  // a preview writes nothing (every action refuses it too)
  const canWrite = !perms.viewingAs && !isMockMode
  return { perms, companyId, canWrite, demo: isMockMode }
}
