import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { BRAND_NAME, BRAND_EMAIL_SUPPORT } from '@/lib/brand'

export const metadata: Metadata = {
  title: `${BRAND_NAME} — SMS Alerts Program`,
  description: 'How HammerTrack SMS alerts work: what we send, how you opt in, and how to stop.',
}

const UPDATED = 'July 30, 2026'

/**
 * Public SMS program disclosure.
 *
 * Carriers require an opt-in that a reviewer can actually SEE. Ours happens on
 * the Settings page behind a login, which a Toll-Free Verification reviewer
 * can't reach — "the consent is in the app" is one of the most common TFV
 * rejection reasons. This page is the public, linkable description of the
 * program: who sends, what's sent, how consent is captured, and how to stop.
 * Referenced from the TFV submission and linked in the footer.
 */
export default function SmsPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-ink">
      <SiteNav />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <h1 className="font-display font-black text-[2rem]">SMS Alerts Program</h1>
        <p className="font-mono text-[12px] text-faint mt-1">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[14.5px] leading-relaxed text-muted [&_h2]:font-display [&_h2]:font-bold [&_h2]:text-[17px] [&_h2]:text-ink">
          <section>
            <h2>What this program is</h2>
            <p className="mt-2">
              {BRAND_NAME} is equipment-tracking software for construction companies. Account
              owners can choose to receive <strong className="text-ink">security and equipment
              alerts by text message</strong> — for example, when a tracked vehicle or machine
              moves outside the company&apos;s working hours, or leaves a job site unexpectedly.
            </p>
            <p className="mt-2">
              This is a notification program for existing customers about their own equipment. It
              is not marketing, and we never text people who aren&apos;t {BRAND_NAME} account
              holders.
            </p>
          </section>

          <section>
            <h2>How you opt in</h2>
            <p className="mt-2">
              Text alerts are <strong className="text-ink">off by default</strong>. To turn them
              on, a signed-in account administrator goes to{' '}
              <strong className="text-ink">Settings → Company → Alert phone</strong> and types in
              the mobile number that should receive alerts. Beside that field is this notice:
            </p>
            <blockquote className="mt-3 rounded-xl border border-navy-800 bg-navy-900 px-4 py-3 text-[13.5px] text-ink">
              By entering a mobile number you agree to receive equipment and security alert text
              messages from {BRAND_NAME} at that number. Message frequency varies by alert
              activity. Message and data rates may apply. Reply STOP to unsubscribe or HELP for
              help.
            </blockquote>
            <p className="mt-3">
              Saving that field is the opt-in. Clearing it turns text alerts off. No number is
              ever added by {BRAND_NAME}, imported from a list, or bought from a third party.
            </p>
          </section>

          <section>
            <h2>What we send</h2>
            <p className="mt-2">
              Only alerts the account has configured. Routine activity is logged in the app but
              never texted — texts are reserved for events that need a person to react.
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong className="text-ink">After-hours movement:</strong>{' '}
                <span className="font-mono text-[12.5px]">
                  HammerTrack: Chevy 1500 is moving outside work hours — possible theft
                </span>
              </li>
              <li>
                <strong className="text-ink">Left a job site:</strong>{' '}
                <span className="font-mono text-[12.5px]">
                  HammerTrack: CAT 336 Excavator left Riverfront Tower
                </span>
              </li>
            </ul>
            <p className="mt-3">
              <strong className="text-ink">Message frequency:</strong> varies with equipment
              activity. Most accounts receive no messages on a typical day.
            </p>
          </section>

          <section>
            <h2>How to stop</h2>
            <p className="mt-2">
              Reply <strong className="text-ink">STOP</strong> to any message and we stop texting
              that number immediately. Reply <strong className="text-ink">HELP</strong> for help,
              or email{' '}
              <a href={`mailto:${BRAND_EMAIL_SUPPORT}`} className="text-teal hover:underline">
                {BRAND_EMAIL_SUPPORT}
              </a>
              . You can also clear the Alert phone field in Settings at any time.
            </p>
            <p className="mt-2">
              Opting out of texts does not affect your account — alerts continue to appear in the
              app, and can still be delivered by push notification and email.
            </p>
          </section>

          <section>
            <h2>Costs</h2>
            <p className="mt-2">
              {BRAND_NAME} does not charge for text alerts.{' '}
              <strong className="text-ink">Message and data rates may apply</strong> from your
              mobile carrier. Carriers are not liable for delayed or undelivered messages.
            </p>
          </section>

          <section>
            <h2>Your data</h2>
            <p className="mt-2">
              Mobile numbers entered for alerts are used only to deliver those alerts. We do not
              sell, rent, or share them with third parties for marketing. Messages are sent
              through our telecom provider solely to carry them to your carrier. See our{' '}
              <a href="/privacy" className="text-teal hover:underline">Privacy Policy</a> and{' '}
              <a href="/terms" className="text-teal hover:underline">Terms of Service</a>.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
