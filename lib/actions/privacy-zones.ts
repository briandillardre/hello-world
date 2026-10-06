'use server'

import { revalidatePath } from 'next/cache'
import { isPrivacyKind } from '@/lib/location-policy'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/**
 * Mark a zone private, or not (migration 132). Inside a privacy zone no
 * worker-phone point is kept — the shift recorder's, the tag listener's, Go
 * Live's — and tags heard there sit at the zone's centre. Company trucks and
 * machines are untouched. Admins and the owner only; the column itself is
 * write-locked to the service role (132's trigger), so this is the one door.
 * Only a Boundary or Vendor zone may be private: sites and yards are where
 * crews work, and their time cards are checked against the phones there.
 */
export async function setPrivacyZoneAction(zoneId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Not available in the demo.' }
  try {
    const { getMyPermissions, getRealPermissions } = await import('@/lib/permissions-server')
    const { rankOf, RANK } = await import('@/lib/permissions')
    const [mine, real] = await Promise.all([getMyPermissions(), getRealPermissions()])
    if (mine.viewingAs) return { ok: false, error: 'Read-only while viewing the app as someone else.' }
    if (!real.userId || !real.companyId) return { ok: false, error: 'Sign in again.' }
    if (rankOf(real) < RANK.admin || !real.canEdit) return { ok: false, error: 'Only Admins and the owner can mark a privacy zone.' }
    if (!isUuid(zoneId)) return { ok: false, error: 'Zone not found.' }

    // The caller's own read: their company, and their own personal zones only.
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const { data: zone } = await createClient().from('geofences').select('id, company_id, kind').eq('id', zoneId).maybeSingle()
    if (!zone || zone.company_id !== real.companyId) return { ok: false, error: 'Zone not found.' }
    if (on && !isPrivacyKind(zone.kind as string | null)) {
      return { ok: false, error: 'Only a Boundary or Vendor zone can be a privacy zone — sites and yards are where crews work, and time cards check phones against them. Draw the private place as its own Boundary zone.' }
    }
    const { error } = await createServiceClient().from('geofences')
      .update({ privacy_zone: !!on }).eq('id', zoneId).eq('company_id', real.companyId)
    if (error) return { ok: false, error: 'Could not save — try again.' }
    const { forgetPrivacyZones } = await import('@/lib/location-privacy')
    forgetPrivacyZones(real.companyId)
    revalidatePath(`/zones/${zoneId}`)
    revalidatePath('/zones')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save — try again.' }
  }
}
