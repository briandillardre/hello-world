import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { BRAND_EMAIL_HELLO } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'HammerTrack — Privacy Policy',
  description: 'How HammerTrack collects, uses, and protects your data.',
}

const UPDATED = 'September 1, 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-ink">
      <SiteNav />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <h1 className="font-display font-black text-[2rem]">Privacy Policy</h1>
        <p className="font-mono text-[12px] text-faint mt-1">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[14.5px] leading-relaxed text-muted [&_h2]:font-display [&_h2]:font-bold [&_h2]:text-[17px] [&_h2]:text-ink">
          <section>
            <h2>What we collect</h2>
            <p className="mt-2">
              <strong className="text-ink">Account information:</strong> your name, email address,
              company name, and password (stored hashed — we never see it).
            </p>
            <p className="mt-2">
              <strong className="text-ink">Asset &amp; location data:</strong> GPS positions, speed,
              heading, battery level, and engine data reported by the trackers you install on your
              vehicles, equipment, and tools, plus the zones and asset records you
              create. This data exists so we can show it back to you — that&apos;s the product.
            </p>
            <p className="mt-2">
              <strong className="text-ink">Usage &amp; billing:</strong> basic product analytics and,
              if you subscribe, billing details processed by our payment provider (we don&apos;t
              store card numbers).
            </p>
          </section>

          <section>
            <h2>How we use it</h2>
            <p className="mt-2">
              To operate the service: showing your fleet on your map, sending the alerts you
              configure, generating your reports and invoices, and providing support. We also use
              aggregate, de-identified usage data to improve the product.
            </p>
          </section>

          <section>
            <h2>What we never do</h2>
            <p className="mt-2">
              We do not sell your data. We do not share your fleet&apos;s location data with
              advertisers, data brokers, or other customers. Your operational data is yours.
            </p>
          </section>

          <section>
            <h2>Who can see your data</h2>
            <p className="mt-2">
              Only users you add to your company account. Our infrastructure providers (hosting,
              database, SMS/email delivery, payments) process data on our behalf under their own
              security commitments. We may disclose data if legally required.
            </p>
          </section>

          <section>
            <h2>Tracking people</h2>
            <p className="mt-2">
              If you use personnel tracking, you are responsible for notifying your crew and
              complying with applicable employment and privacy laws in your jurisdiction.
              HammerTrack tracks during configured work hours as set by your account.
            </p>
          </section>

          <section>
            <h2>Mobile app permissions (iOS &amp; Android)</h2>
            <p className="mt-2">
              The HammerTrack app requests only the permissions a feature needs, and only when you
              use that feature:
            </p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>
                <strong className="text-ink">Location</strong> — to show your own phone as a live
                asset when you turn on the crew tracker (&ldquo;Go Live&rdquo;) and to power zone
                check-ins. See the location note below.
              </li>
              <li>
                <strong className="text-ink">Camera &amp; Photos</strong> — to take or attach asset,
                VIN/GVWR, and receipt photos.
              </li>
              <li>
                <strong className="text-ink">Notifications</strong> — to deliver theft and critical
                fleet alerts to your lock screen. We store only an anonymous per-device push token.
              </li>
            </ul>
            <p className="mt-2">
              Revoke any permission in your device settings at any time; the related feature simply
              stops working.
            </p>
          </section>

          <section>
            <h2>Location while Go Live is on</h2>
            <p className="mt-2">
              When — and only when — you turn on live crew tracking (&ldquo;Go Live&rdquo;), the app
              collects that device&apos;s location <strong className="text-ink">while the app is open
              and in use</strong>, so your fleet map stays live for your team during the working
              session. Background collection is not enabled in the current Android app — location
              sharing pauses when the app is closed. Tracking runs only while Go Live is on and
              stops the moment you turn it off or the session ends. This location is used solely to
              display your fleet on your company&apos;s map and to trigger the alerts you configure —
              it is never used for advertising and never sold or shared with third parties.
            </p>
          </section>

          <section>
            <h2>Retention &amp; deletion</h2>
            <p className="mt-2">
              Location history is retained while your account is active. You can export your data at
              any time. To delete your account and all associated data, use the in-app option or
              email us from your account address; we complete deletion within 30 days, except where
              the law requires longer retention.
            </p>
          </section>

          <section>
            <h2>Security</h2>
            <p className="mt-2">
              Data is encrypted in transit (TLS) and at rest. Tracker ingestion endpoints are
              authenticated with per-account secrets. Access to production systems is restricted.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p className="mt-2">
              Questions or data requests:{' '}
              <a href={`mailto:${BRAND_EMAIL_HELLO}`} className="text-amber hover:underline">
                {BRAND_EMAIL_HELLO}
              </a>
              .
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
