'use client'

import { useState } from 'react'
import { FolderOpen, Check, ExternalLink, Pencil } from 'lucide-react'
import { saveAssetFolderAction } from '@/lib/actions/assets'
import { saveZoneFolderAction } from '@/lib/actions/geofences'

/**
 * Document-folder link for an asset or zone — a URL to the record's folder in
 * Dropbox / Drive / SharePoint / wherever. We don't touch the provider; it's a
 * shortcut so the plans, permits, and photos for this truck or job live one tap
 * away. Shows an "Open folder" button when set, an inline editor to change it.
 */
export function FolderLink({ kind, id, initial }: { kind: 'asset' | 'zone'; id: string; initial: string | null }) {
  const [url, setUrl] = useState(initial ?? '')
  const [editing, setEditing] = useState(!initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true); setError(null)
    const res = kind === 'asset' ? await saveAssetFolderAction(id, url) : await saveZoneFolderAction(id, url)
    setSaving(false)
    if (!res.ok) { setError(res.error ?? 'Could not save.'); return }
    setSaved(true); setEditing(false)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
        <FolderOpen className="h-3.5 w-3.5 text-amber" /> Document folder
      </h2>
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-3">
        {!editing && url ? (
          <div className="flex items-center gap-2">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex-1 inline-flex items-center gap-2 rounded-lg bg-amber/15 border border-amber/40 text-amber font-semibold text-[13px] px-3 py-2 hover:bg-amber/25 transition-colors min-w-0">
              <FolderOpen className="h-4 w-4 flex-none" /> <span className="truncate">Open folder</span> <ExternalLink className="h-3.5 w-3.5 flex-none ml-auto" />
            </a>
            <button onClick={() => setEditing(true)} className="rounded-lg border border-navy-700 text-faint hover:text-ink p-2" title="Change link">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.dropbox.com/scl/fo/…"
              className="w-full bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50"
            />
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving}
                className="rounded-lg bg-amber/15 border border-amber/40 text-amber text-[12px] font-semibold px-3 py-1.5 disabled:opacity-40 hover:bg-amber/25 transition-colors">
                {saving ? 'Saving…' : saved ? <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved</span> : 'Save link'}
              </button>
              {initial && <button onClick={() => { setUrl(initial); setEditing(false); setError(null) }} className="text-[12px] text-faint hover:text-ink">Cancel</button>}
              {error && <span className="text-[11.5px] text-alert">{error}</span>}
            </div>
            <p className="text-[10.5px] text-faint">Paste a shared-folder link (Dropbox, Drive, SharePoint…). It opens in a new tab.</p>
          </div>
        )}
      </div>
    </section>
  )
}
