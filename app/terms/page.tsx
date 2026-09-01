import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { BRAND_EMAIL_HELLO } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'HammerTrack — Terms of Service',
  description: 'The terms that govern your use of HammerTrack.',
}

const UPDATED = 'September 1, 2026'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-ink">
      <SiteNav />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <h1 className="font-display font-black text-[2rem]">Terms of Service</h1>
        <p className="font-mono text-[12px] text-faint mt-1">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[14.5px] leading-relaxed text-muted [&_h2]:font-display [&_h2]:font-bold [&_h2]:text-[17px] [&_h2]:text-ink">
          <section>
            <h2>The service</h2>
            <p className="mt-2">
              HammerTrack provides asset-tracking software: a live map, alerts, reports, and
              integrations fed by GPS and Bluetooth tracking hardware installed on your assets.
              By creating an account you agree to these terms on behalf of your company.
            </p>
          </section>

          <section>
            <h2>Subscriptions &amp; cancellation</h2>
            <p className="mt-2">
              Plans are billed per tracked machine and tag, per month, plus the platform fee on
              Operate and Run — month-to-month. There are no long-term
              contracts and no setup fees. You can cancel anytime from your account; service runs
              through the end of the paid period. Pilot/trial periods are free and require no
              credit card.
            </p>
          </section>

          <section>
            <h2>Hardware</h2>
            <p className="mt-2">
              Trackers you purchase are yours. Loaner trackers provided for a free pilot remain
              ours and should be returned (or purchased) if you don&apos;t continue. You&apos;re
              responsible for installing hardware safely and in accordance with your vehicle and
              equipment manufacturers&apos; guidance.
            </p>
          </section>

          <section>
            <h2>Your data</h2>
            <p className="mt-2">
              You own your operational data. You grant us the limited rights needed to operate the
              service (store it, process it, show it to your users). See our{' '}
              <a href="/privacy" className="text-amber hover:underline">Privacy Policy</a> for
              details.
            </p>
          </section>

          <section>
            <h2>Acceptable use</h2>
            <p className="mt-2">
              Track assets and people you have the legal right to track. Personnel tracking
              requires appropriate notice to your employees under applicable law. Don&apos;t use
              the service to stalk, harass, or surveil anyone unlawfully — we will terminate
              accounts used that way.
            </p>
          </section>

          <section>
            <h2>Service limits &amp; disclaimers</h2>
            <p className="mt-2">
              GPS, cellular, and Bluetooth coverage are not perfect; positions can be delayed,
              imprecise, or unavailable. HammerTrack is a visibility tool — it is not a security
              system, a safety device, or a substitute for insurance, and we can&apos;t guarantee
              theft prevention or recovery. The service is provided &ldquo;as is&rdquo; to the
              fullest extent permitted by law; our total liability is limited to the fees you paid
              us in the twelve months before a claim.
            </p>
          </section>

          <section>
            <h2>Changes</h2>
            <p className="mt-2">
              We may update these terms as the product evolves; material changes will be announced
              in-app or by email. Continued use after changes means acceptance.
            </p>
          </section>

          <section>
            <h2>Governing law &amp; contact</h2>
            <p className="mt-2">
              These terms are governed by the laws of the State of South Carolina. Questions:{' '}
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
