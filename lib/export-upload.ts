'use client'

import { createClient, isSupabaseConfigured } from '@/lib/supabase'
import { mintExportUploadAction, finalizeExportAction } from '@/lib/actions/share-links'

/**
 * Put a finished export somewhere a phone can actually get it (Brian,
 * Sep 19: "GIF won't save to phone").
 *
 * The file never rides through a server action (Vercel's ~4.5 MB body cap
 * would eat a medium GIF): the action mints a signed upload URL, the device
 * streams the blob straight to storage, and finalize checks the object is
 * really there before it becomes a link. What comes back is two URLs — the
 * signed file URL (Save: an external host, so the shell hands it to the
 * system browser, which downloads it) and the short /x/<id> for texting.
 */

export type ExportFileKind = 'gif' | 'png' | 'pdf'
export const EXPORT_MIME: Record<ExportFileKind, string> = { gif: 'image/gif', png: 'image/png', pdf: 'application/pdf' }

export interface ExportLink {
  id: string
  /** hammertrack.ai/x/<id> — the one to text or email. Lives 30 days. */
  url: string
  /** Direct signed URL that downloads the file (Content-Disposition:
   *  attachment). Good for 7 days; the short link re-mints one on every open. */
  fileUrl: string
  expiresAt: string
}

export type PublishResult = { ok: true; link: ExportLink } | { ok: false; error: string }

/** Are export links available at all (a signed-in company, not demo mode)? */
export const exportLinksAvailable = isSupabaseConfigured

export async function publishExport(blob: Blob, filename: string, kind: ExportFileKind, title?: string): Promise<PublishResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Links need a signed-in company — demo mode keeps the file on this screen.' }
  try {
    const pre = await mintExportUploadAction(kind, blob.size)
    if (!pre.ok) return { ok: false, error: pre.error }
    const up = await createClient().storage.from('exports')
      .uploadToSignedUrl(pre.path, pre.token, blob, { contentType: EXPORT_MIME[kind], upsert: false })
    if (up.error) return { ok: false, error: 'The upload did not finish — check your signal and try again.' }
    const fin = await finalizeExportAction(pre.path, filename, title ?? null)
    if (!fin.ok) return { ok: false, error: fin.error }
    return { ok: true, link: { id: fin.id, url: fin.url, fileUrl: fin.fileUrl, expiresAt: fin.expiresAt } }
  } catch {
    return { ok: false, error: 'Could not make a link for this file — it is still here on screen.' }
  }
}
