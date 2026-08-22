import Link from 'next/link'
import { ChevronRight, LifeBuoy } from 'lucide-react'
import { GUIDES } from './guides'

export const metadata = { title: 'HammerTrack — Help' }

/**
 * Help home — a scannable grid of the six guides that answer the questions
 * founders otherwise text at 6 AM. No search box: six cards is scannable,
 * a search box over six cards is furniture.
 */
export default function HelpPage() {
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="font-display font-bold text-xl text-ink">Help</h1>
          <p className="text-[12.5px] text-faint">
            Short guides, no fluff. Everything here is how the app actually works.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GUIDES.map(({ slug, title, tagline, icon: Icon }) => (
            <Link
              key={slug}
              href={`/help/${slug}`}
              className="group rounded-xl border border-navy-800 bg-navy-900 p-4 hover:border-amber/40 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="grid place-items-center w-9 h-9 rounded-lg bg-amber/15 border border-amber/30 flex-none">
                  <Icon className="h-[18px] w-[18px] text-amber" />
                </span>
                <div className="min-w-0">
                  <p className="font-display font-bold text-[15px] text-ink flex items-center gap-1">
                    {title}
                    <ChevronRight className="h-4 w-4 text-faint group-hover:text-amber group-hover:translate-x-0.5 transition-all flex-none" />
                  </p>
                  <p className="text-[12.5px] text-muted leading-snug mt-0.5">{tagline}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Support footer — the escape hatch when a guide doesn't cut it. */}
        <div className="mt-6 rounded-xl border border-navy-800 bg-navy-950 p-4 flex items-center gap-3">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-teal/15 border border-teal/40 flex-none">
            <LifeBuoy className="h-[18px] w-[18px] text-teal" />
          </span>
          <p className="text-[13px] text-muted leading-snug">
            Stuck?{' '}
            <a href="mailto:support@hammertrack.ai" className="font-semibold text-teal hover:underline">
              support@hammertrack.ai
            </a>{' '}
            — a real person answers.
          </p>
        </div>
      </div>
    </div>
  )
}
