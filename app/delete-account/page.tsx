import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'

// Google Play requires a public account-deletion page (Data safety →
// "Delete account URL"). Steps must be prominent and say what's deleted.
export const metadata: Metadata = {
  title: 'HammerTrack — Delete your account',
  description: 'How to delete your HammerTrack account and all associated data.',
}

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-ink font-sans px-6 py-14">
      <div className="max-w-xl mx-auto space-y-8">
        <Logo size={30} href="/" />
        <h1 className="font-display font-black text-3xl">Delete your HammerTrack account</h1>

        <section className="space-y-3">
          <h2 className="font-display font-bold text-lg">In the app (fastest)</h2>
          <p className="text-muted">
            Open HammerTrack → <span className="text-ink font-medium">Settings</span> →{' '}
            <span className="text-ink font-medium">Delete my account</span>. That files the deletion
            request immediately — no call, no email required.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display font-bold text-lg">By email</h2>
          <p className="text-muted">
            Email <a href="mailto:support@hammertrack.ai?subject=Delete%20my%20account" className="text-amber font-semibold hover:underline">support@hammertrack.ai</a>{' '}
            from the address on your account with the subject &ldquo;Delete my account.&rdquo;
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display font-bold text-lg">What gets deleted</h2>
          <p className="text-muted">
            Your login, profile, and personal data — name, email, location history from your device,
            photos you uploaded, and push-notification tokens — are permanently deleted within{' '}
            <span className="text-ink font-medium">30 days</span> of the request.
          </p>
          <p className="text-muted">
            What may be kept: records your <em>company</em> owns (job-site logs, time entries, and
            equipment history created for your employer&rsquo;s account) are business records of that
            company and are retained under its control, minus your personal identifiers. Invoices and
            billing records are kept where the law requires it.
          </p>
        </section>

        <p className="text-sm text-faint">
          Questions? <a href="mailto:support@hammertrack.ai" className="text-amber hover:underline">support@hammertrack.ai</a> ·{' '}
          <Link href="/privacy" className="text-amber hover:underline">Privacy policy</Link>
        </p>
      </div>
    </div>
  )
}
