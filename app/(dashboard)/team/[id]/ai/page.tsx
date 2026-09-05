import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { getMemberConversations } from '@/lib/db/ai-convos'
import { ROLE_LABEL } from '@/lib/permissions'
import { requireFeature } from '@/lib/permissions-server'

export const metadata = { title: 'HammerTrack — AI conversations' }
export const dynamic = 'force-dynamic'

/**
 * A teammate's Ask AI history — readable only DOWN the ladder (the reader
 * enforces rank; this page 404s otherwise). The Master reads everyone's.
 */
export default async function MemberAiPage({ params }: { params: { id: string } }) {
  const perms = await requireFeature('team')
  if (perms.viewingAs) notFound()
  const res = await getMemberConversations(params.id)
  if (!res.ok || !res.member) notFound()
  const { member, messages } = res

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <Link href="/team" className="inline-flex items-center gap-1.5 text-[13px] text-teal min-h-11"><ArrowLeft className="h-4 w-4" /> Team</Link>
      <div>
        <h1 className="font-display text-xl font-bold text-ink flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber" /> {member.name}&apos;s AI conversations
        </h1>
        <p className="text-[13px] text-muted mt-1">{ROLE_LABEL[member.role]} · last {messages.length} messages · visible to you because you are above them on the ladder.</p>
      </div>
      {messages.length === 0 ? (
        <p className="text-[13px] text-faint rounded-xl border border-dashed border-navy-700 p-4">No conversations yet.</p>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug whitespace-pre-line ' + (m.role === 'user' ? 'bg-amber/15 border border-amber/30 text-ink rounded-br-sm' : 'bg-navy-900 border border-navy-800 text-muted rounded-bl-sm')}>
                {m.content}
                <p className="mt-1 text-[10px] text-faint">{new Date(m.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
