'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BooksAnswers } from '@/lib/owner/dashboard'
import { saveBooksAnswersAction } from '@/lib/actions/finance'

const QS: { key: keyof BooksAnswers; q: string }[] = [
  { key: 'cpaReviewed', q: 'A CPA reviews or compiles the books each year' },
  { key: 'personalSeparate', q: 'Personal spending stays out of the company books' },
  { key: 'revenueFromInvoices', q: 'Revenue is booked from invoices / pay apps, not deposits' },
]

/** The three questions a buyer asks about the books — Yes / No / not sure; each answer moves the range. */
export function BooksQuestions({ books, canAnswer }: { books: BooksAnswers; canAnswer: boolean }) {
  const router = useRouter()
  const [a, setA] = useState<BooksAnswers>(books)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function set(key: keyof BooksAnswers, v: boolean | null) {
    const prev = a
    setA({ ...a, [key]: v }); setErr(null); setBusy(true)
    const r = await saveBooksAnswersAction({ [key]: v }).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setA(prev); setErr(r?.error ?? 'Couldn’t save — check your signal.'); return }
    router.refresh()
  }
  return (
    <div className="space-y-1.5 pt-1">
      {QS.map(({ key, q }) => (
        <div key={key} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span className="text-muted min-w-0">{q}</span>
          <span className="flex gap-1">
            {([['Yes', true], ['No', false], ['Not sure', null]] as const).map(([label, v]) => {
              const on = a[key] === v
              return (
                <button key={label} type="button" disabled={!canAnswer || busy} onClick={() => set(key, v)} aria-pressed={on}
                  className={'rounded-full border px-2.5 py-1 min-h-8 ' + (on ? 'border-teal/50 bg-teal/15 text-teal' : 'border-navy-700 text-muted') + (canAnswer ? '' : ' opacity-60')}>{label}</button>
              )
            })}
          </span>
        </div>
      ))}
      {err && <p className="text-[12px] text-red-300">{err}</p>}
    </div>
  )
}
