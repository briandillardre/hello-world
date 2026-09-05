'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, X } from 'lucide-react'
import { exitViewAsAction } from '@/lib/actions/viewas'

/**
 * The strip an Admin sees while previewing the app as a teammate. Loud on
 * purpose: everything below it is that person's view, read-only, and the
 * Exit is the only way out (the cookie survives navigation).
 */
export function ViewAsBanner({ name, roleLabel }: { name: string; roleLabel: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="flex items-center gap-2 bg-amber text-[#1a1100] px-3 py-1.5 text-[12.5px] font-semibold">
      <Eye className="h-4 w-4 flex-none" />
      <span className="min-w-0 truncate">Viewing as <span className="font-bold">{name}</span> · {roleLabel} · read-only preview</span>
      <button
        onClick={() => start(async () => { await exitViewAsAction(); router.push('/team'); router.refresh() })}
        disabled={pending}
        className="ml-auto inline-flex items-center gap-1 rounded-md bg-[#1a1100]/15 hover:bg-[#1a1100]/25 px-2 py-1 min-h-8 disabled:opacity-60"
      >
        <X className="h-3.5 w-3.5" /> Exit
      </button>
    </div>
  )
}
