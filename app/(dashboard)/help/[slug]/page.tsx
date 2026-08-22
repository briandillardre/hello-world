import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { GUIDES, getGuide } from '../guides'

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const guide = getGuide(params.slug)
  return { title: guide ? `HammerTrack — ${guide.title}` : 'HammerTrack — Help' }
}

/** One guide page — short sections, bold action paths, contractor voice. */
export default function HelpGuidePage({ params }: { params: { slug: string } }) {
  const guide = getGuide(params.slug)
  if (!guide) notFound()
  const Icon = guide.icon
  // "Next guide" keeps the reader moving through setup in order.
  const idx = GUIDES.findIndex((g) => g.slug === guide.slug)
  const next = GUIDES[(idx + 1) % GUIDES.length]

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link
          href="/help"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-faint hover:text-ink transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All guides
        </Link>

        <div className="flex items-center gap-3 mb-5">
          <span className="grid place-items-center w-10 h-10 rounded-lg bg-amber/15 border border-amber/30 flex-none">
            <Icon className="h-5 w-5 text-amber" />
          </span>
          <div>
            <h1 className="font-display font-bold text-xl text-ink leading-tight">{guide.title}</h1>
            <p className="text-[12.5px] text-faint">{guide.tagline}</p>
          </div>
        </div>

        <div className="space-y-4">
          {guide.sections.map((s) => (
            <section key={s.heading} className="rounded-xl border border-navy-800 bg-navy-900 p-4">
              <h2 className="font-display font-bold text-[14px] text-ink mb-2">{s.heading}</h2>
              <div className="space-y-2.5">{s.body}</div>
            </section>
          ))}
        </div>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-[12.5px] text-muted">
            Stuck?{' '}
            <a href="mailto:support@hammertrack.ai" className="font-semibold text-teal hover:underline">
              support@hammertrack.ai
            </a>{' '}
            — a real person answers.
          </p>
          <Link
            href={`/help/${next.slug}`}
            className="text-[12.5px] font-semibold text-amber hover:underline flex-none"
          >
            Next: {next.title} →
          </Link>
        </div>
      </div>
    </div>
  )
}
