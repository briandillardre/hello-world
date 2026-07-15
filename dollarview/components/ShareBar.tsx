'use client'

import { useState } from 'react'
import { Check, Code2, Link2, Share2 } from 'lucide-react'

export function ShareBar({ title, embedPath }: { title: string; embedPath?: string }) {
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null)

  const flash = (kind: 'link' | 'embed') => {
    setCopied(kind)
    setTimeout(() => setCopied(null), 2000)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    flash('link')
  }

  const copyEmbed = async () => {
    if (!embedPath) return
    const url = new URL(embedPath, window.location.origin)
    url.search = window.location.search
    const snippet = `<iframe src="${url.toString()}" width="100%" height="640" style="border:1px solid #e1e0d9;border-radius:12px" title="${title}"></iframe>`
    await navigator.clipboard.writeText(snippet)
    flash('embed')
  }

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url: window.location.href })
      } catch {
        // user dismissed the sheet — nothing to do
      }
    } else {
      await copyLink()
    }
  }

  const btn =
    'inline-flex items-center gap-1.5 rounded-lg border border-grid bg-surface px-3 py-1.5 text-sm text-ink2 hover:border-baseline hover:text-ink'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={copyLink} className={btn}>
        {copied === 'link' ? <Check className="h-4 w-4 text-gooddark" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {copied === 'link' ? 'Copied' : 'Copy link'}
      </button>
      <button type="button" onClick={nativeShare} className={btn}>
        <Share2 className="h-4 w-4" aria-hidden />
        Share
      </button>
      {embedPath && (
        <button type="button" onClick={copyEmbed} className={btn}>
          {copied === 'embed' ? <Check className="h-4 w-4 text-gooddark" aria-hidden /> : <Code2 className="h-4 w-4" aria-hidden />}
          {copied === 'embed' ? 'Copied' : 'Embed'}
        </button>
      )}
    </div>
  )
}
