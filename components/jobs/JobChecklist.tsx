'use client'

/**
 * A job's checklist, section by section: tick it off (who and when stays on
 * it), jump to where the work is done in the app, leave a note, add an item
 * the job needs. The job's own copy — the company template is on /jobs.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { CHECK_WORDS, linkHref, LINK_WORDS, type CheckItem, type CheckStage } from '@/lib/jobs/job'
import { addItemAction, checkItemAction, noteItemAction, removeItemAction } from '@/lib/actions/jobs'
import type { Member } from '@/lib/db/jobs'

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function JobChecklist({ zoneId, items, sections, members, canEdit, billing }: {
  zoneId: string; items: CheckItem[]; sections: CheckStage[]; members: Member[]; canEdit: boolean; billing: boolean
}) {
  const router = useRouter()
  const [local, setLocal] = useState<Record<string, string | null>>({})
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState<CheckStage | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? null : null)

  async function toggle(it: CheckItem) {
    const done = !(local[it.id] !== undefined ? local[it.id] : it.doneAt)
    setLocal((l) => ({ ...l, [it.id]: done ? new Date().toISOString() : null }))
    const r = await checkItemAction(it.id, done).catch(() => null)
    if (!r?.ok) { setLocal((l) => { const n = { ...l }; delete n[it.id]; return n }); setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    router.refresh()
  }
  async function saveNote(id: string) {
    const r = await noteItemAction(id, note).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setNoteFor(null); router.refresh()
  }
  async function add(stage: CheckStage) {
    if (!text.trim()) return
    const r = await addItemAction(zoneId, stage, text).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t add it — try again.'); return }
    setText(''); setAdding(null); router.refresh()
  }
  async function remove(it: CheckItem) {
    if (!window.confirm(`Take “${it.text}” off this job’s checklist?`)) return
    const r = await removeItemAction(it.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t remove it — try again.'); return }
    router.refresh()
  }

  return (
    <div className="space-y-3 text-[12.5px]">
      {err && <p className="text-red-300">{err}</p>}
      {sections.map((st) => {
        const its = items.filter((i) => i.stage === st).sort((a, b) => a.sort - b.sort)
        const done = its.filter((i) => (local[i.id] !== undefined ? local[i.id] : i.doneAt)).length
        return (
          <div key={st} className="space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-faint font-semibold">{CHECK_WORDS[st]} · {done}/{its.length}</p>
            {its.map((it) => {
              const doneAt = local[it.id] !== undefined ? local[it.id] : it.doneAt
              const href = it.link ? linkHref(it.link, zoneId, { billing }) : null
              const by = nameOf(it.doneBy)
              return (
                <div key={it.id} className="rounded-lg border border-navy-800 bg-navy-950/40 px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <button type="button" disabled={!canEdit} onClick={() => void toggle(it)} aria-label={doneAt ? 'Mark not done' : 'Mark done'}
                      className={'mt-0.5 h-5 w-5 flex-none rounded border flex items-center justify-center ' + (doneAt ? 'bg-teal border-teal text-navy-950' : 'border-navy-600 text-transparent') + (canEdit ? '' : ' opacity-60')}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={doneAt ? 'text-muted line-through decoration-navy-600' : 'text-ink'}>
                        {it.text}{it.required && !doneAt && <span className="ml-1 text-amber text-[11px] font-semibold">must-do</span>}
                      </p>
                      <p className="text-[11.5px] text-faint flex items-center gap-2 flex-wrap">
                        {doneAt && <span>Done {when(doneAt)}{by ? ` · ${by}` : ''}</span>}
                        {href && it.link && (
                          href.startsWith('#') || href.includes('#')
                            ? <a href={href} className="inline-flex items-center gap-0.5 text-teal">{LINK_WORDS[it.link]} <ExternalLink className="h-3 w-3" /></a>
                            : <Link href={href} className="inline-flex items-center gap-0.5 text-teal">{LINK_WORDS[it.link]} <ExternalLink className="h-3 w-3" /></Link>
                        )}
                        {it.note && noteFor !== it.id && <span className="text-muted">“{it.note}”</span>}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-0.5 flex-none">
                        <button type="button" aria-label="Note" onClick={() => { setNoteFor(noteFor === it.id ? null : it.id); setNote(it.note ?? '') }} className="rounded p-1 text-faint hover:text-ink"><MessageSquare className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label="Remove" onClick={() => void remove(it)} className="rounded p-1 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )}
                  </div>
                  {noteFor === it.id && (
                    <div className="mt-1.5 flex items-center gap-1.5 pl-7">
                      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder="A note on this item" className="flex-1 rounded-lg border border-navy-700 bg-navy-950 px-2 py-1 text-ink outline-none" />
                      <button type="button" onClick={() => void saveNote(it.id)} className="rounded-lg bg-teal/20 px-2 py-1 text-teal">Save</button>
                    </div>
                  )}
                </div>
              )
            })}
            {canEdit && (adding === st ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} onKeyDown={(e) => { if (e.key === 'Enter') void add(st) }} placeholder="What needs doing" className="flex-1 rounded-lg border border-navy-700 bg-navy-950 px-2 py-1 text-ink outline-none" />
                <button type="button" onClick={() => void add(st)} className="rounded-lg bg-teal/20 px-2 py-1 text-teal">Add</button>
                <button type="button" onClick={() => { setAdding(null); setText('') }} className="rounded-lg px-2 py-1 text-faint">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setAdding(st); setText('') }} className="inline-flex items-center gap-1 text-teal"><Plus className="h-3.5 w-3.5" /> Add an item</button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
