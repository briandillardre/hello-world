import Link from 'next/link'
import { Map, Wifi, Calculator } from 'lucide-react'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { getCompanySettings } from '@/lib/db/company'
import { CompanySettings } from '@/components/settings/CompanySettings'
import { ApiKeyReveal } from '@/components/settings/ApiKeyCard'
import { WeeklyDigests } from '@/components/settings/WeeklyDigests'
import { resolveDigestPrefs } from '@/lib/weekly-digest'
import { DailyLogBuilder } from '@/components/settings/DailyLogBuilder'
import { resolveLogForm } from '@/lib/log-form'
import { MapPrefs } from '@/components/settings/MapPrefs'
import { TestAlertButton } from '@/components/settings/TestAlertButton'
import { isQboConfigured } from '@/lib/qbo'
import { BillingCard } from '@/components/settings/BillingCard'
import { DeleteAccountCard } from '@/components/settings/DeleteAccountCard'
import { billingConfigured, isActiveStatus, statusLabel } from '@/lib/stripe'
import { getMyPermissions } from '@/lib/permissions-server'

export const metadata = { title: 'HammerTrack — Settings' }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export default async function SettingsPage({ searchParams }: { searchParams?: { billing?: string } }) {
  const [co, perms] = await Promise.all([getCompanySettings(), getMyPermissions()])
  // Checkout lands back here. The webhook is what actually records the
  // subscription (may lag the redirect by a few seconds) — so this banner
  // confirms the ACTION, and the card below catches up on refresh.
  const billingReturn = searchParams?.billing
  return (
    <div className="h-full overflow-auto pb-36 md:pb-24">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <h1 className="text-xl font-bold text-ink">Settings</h1>
      </div>

      <div className="p-4 space-y-4 max-w-xl">
        {/* Company info — editable. Anchor target for /welcome's alert-phone step. */}
        <div id="company" className="scroll-mt-20">
        <CompanySettings
          name={co.name} plan={co.plan}
          work_start={co.work_start} work_end={co.work_end} work_days={co.work_days}
          alert_phone={co.alert_phone} alert_email={co.alert_email}
          sms_consent_phone={co.sms_consent_phone} sms_consent_at={co.sms_consent_at}
          logo_url={co.logo_url}
          logo_bg={co.logo_bg}
          editable={co.isAdmin}
        />
        </div>

        {/* Weekly summaries — Friday wrap-up + Sunday week-ahead (Brian, Aug 1) */}
        <WeeklyDigests initial={resolveDigestPrefs(co.digest_prefs)} editable={co.isAdmin} />

        {/* Daily log builder — the crew's clock-out form, admin-composed (Aug 9) */}
        <DailyLogBuilder initial={resolveLogForm(co.log_form)} editable={co.isAdmin} />

        {billingReturn === 'success' && (
          <p className="rounded-xl border border-teal/40 bg-teal/10 px-4 py-3 text-[13px] text-teal leading-snug">
            ✅ Subscription started — welcome to the Founding 25. If the card below still says
            &quot;No subscription,&quot; give it a few seconds and refresh; Stripe confirms in the background.
          </p>
        )}
        {billingReturn === 'canceled' && (
          <p className="rounded-xl border border-navy-700 bg-navy-900 px-4 py-3 text-[13px] text-muted leading-snug">
            Checkout was canceled — nothing was charged. Subscribe below whenever you&apos;re ready.
          </p>
        )}

        {/* Subscription state + the two buttons that matter */}
        <BillingCard
          configured={billingConfigured()}
          canManage={perms.canManageBilling}
          plan={co.plan}
          status={co.subscription_status}
          statusText={statusLabel(co.subscription_status, co.cancel_at_period_end)}
          active={isActiveStatus(co.subscription_status)}
          periodEnd={co.current_period_end}
          hasCustomer={!!co.stripe_customer_id}
        />

        {/* Prove the alert pipeline any time — not at 2 AM */}
        {co.isAdmin && (
          <section className="bg-navy-900 rounded-xl border border-navy-800 p-4">
            <h2 className="font-semibold text-sm text-muted mb-1">Alert delivery test</h2>
            <p className="text-xs text-faint mb-3">
              Fires a clearly-labeled test through the real pipeline — SMS to the alert phone above,
              so you know theft alerts reach you before you need them to.
            </p>
            <TestAlertButton />
          </section>
        )}

        {/* Map preferences (moved here from the map's layers panel) */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Map className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">Map opens to</h2>
          </div>
          <MapPrefs />
        </section>

        {/* Trackers — one card, minimum words (Brian, Aug 22: "only the
            minimum"). The API key + endpoint recipes live behind an
            admin-only Advanced fold; crew never sees developer surface. */}
        <section id="integration" className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden scroll-mt-20">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">Trackers</h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-muted leading-relaxed">
              Your HammerTrack trackers arrive pre-configured — add the asset with the tracker ID
              printed on its kit, plug it in, and it&apos;s on your map on first report.
            </p>
            {(isMock || (co.isAdmin && co.api_key)) && (
              <details className="group border border-navy-800 rounded-lg">
                <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-muted hover:text-ink transition-colors">
                  Advanced: API access (admins)
                </summary>
                <div className="p-3 pt-1 space-y-4">
                  <p className="text-xs text-muted">
                    Push data from your own hardware with your company API key in the{' '}
                    <code className="font-mono text-amber">x-api-key</code> header — only assets in
                    your company match. Create the asset (with its tracker ID) before the first POST.
                    Rotating the key instantly disables the old one.
                  </p>
                  {isMock
                    ? <ApiKeyReveal apiKey={MOCK_COMPANY.api_key} demo />
                    : <ApiKeyReveal apiKey={co.api_key!} demo={false} />}
                  <IntegrationCard
                    title="OBD2 (Vehicles)"
                    description="Any OBD2 dongle that can POST JSON over HTTP."
                    endpoint="POST /api/ingest/obd2"
                    payload='{ "tracker_id": "obd-001", "lat": 34.85, "lng": -82.40, "speed": 45, "engine_on": true }'
                  />
                  <IntegrationCard
                    title="GPS Equipment Trackers"
                    description="Most commercial GPS fleet trackers work — use the standard location endpoint."
                    endpoint="POST /api/ingest/location"
                    payload='{ "tracker_id": "gps-002", "lat": 34.85, "lng": -82.40, "battery": 85 }'
                  />
                  <IntegrationCard
                    title="Bluetooth Tools (BLE)"
                    description="BLE tags relayed by a phone or gateway."
                    endpoint="POST /api/ingest/location"
                    payload='{ "tracker_id": "bt-003", "lat": 34.85, "lng": -82.40, "accuracy": 15 }'
                  />
                </div>
              </details>
            )}
          </div>
        </section>

        {/* QuickBooks */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Calculator className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">QuickBooks Online</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted">
              Sync assets as fixed assets, push equipment-usage invoices per job site, and record
              service costs as expenses — automatically, once the QuickBooks connection is live.
            </p>
            <div className="flex gap-2">
              <Link href="/accounting" className="flex-1">
                <span className="block text-center text-sm font-medium bg-amber text-[#1a1100] rounded-lg py-2.5 hover:bg-amber-600 transition-colors">
                  Open Accounting
                </span>
              </Link>
              {isQboConfigured ? (
                <a href="/api/qbo/connect" className="flex-1">
                  <span className="block text-center text-sm font-medium border border-navy-800 text-muted rounded-lg py-2.5 hover:bg-navy-800 transition-colors">
                    Connect QuickBooks
                  </span>
                </a>
              ) : (
                <span className="flex-1 block text-center text-sm font-medium border border-navy-800 text-faint rounded-lg py-2.5">
                  QuickBooks sync — coming
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Account deletion — in-app entry point (Apple 5.1.1(v)) */}
        <DeleteAccountCard />
      </div>
    </div>
  )
}

function IntegrationCard({ title, description, endpoint, payload }: {
  title: string; description: string; endpoint: string; payload: string
}) {
  return (
    <div className="border border-navy-800 rounded-lg p-3 space-y-2">
      <p className="font-semibold text-sm text-muted">{title}</p>
      <p className="text-xs text-muted">{description}</p>
      <div className="bg-navy-950 rounded-md p-2 space-y-1">
        <p className="text-xs font-mono text-amber">{endpoint}</p>
        <p className="text-xs font-mono text-faint break-all">{payload}</p>
      </div>
    </div>
  )
}
