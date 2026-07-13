/**
 * Transactional email via Resend's REST API — no SDK, one fetch.
 *
 * Gated on RESEND_API_KEY: absent → sendEmail() reports 'not configured' and
 * callers fall back to their linkless behavior (e.g. invites show the copy
 * link, exactly as before). Configured → invites, and eventually digests and
 * alert mirrors, arrive by email.
 *
 * Env:
 *   RESEND_API_KEY   — from resend.com (free tier: 3k emails/mo)
 *   EMAIL_FROM       — verified sender, e.g. "HammerTrack <team@hammertrack.ai>"
 *                      (defaults to that; the domain must be verified in Resend)
 */

const FROM_DEFAULT = 'HammerTrack <team@hammertrack.ai>'

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'not configured' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || FROM_DEFAULT, to: [to], subject, html }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      console.error('Resend send failed', res.status, msg)
      return { ok: false, error: `send failed (${res.status})` }
    }
    return { ok: true }
  } catch (err) {
    console.error('Resend send error', err)
    return { ok: false, error: 'send failed' }
  }
}

/** The invite email — plain, legible, one button. Inline styles only. */
export function inviteEmailHtml(opts: { companyName: string; inviterName: string; role: string; link: string }): string {
  const { companyName, inviterName, role, link } = opts
  return `
  <div style="background:#001523;padding:32px 16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#00243d;border:1px solid #0e3a5c;border-radius:14px;padding:28px">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7fa3bd">HammerTrack</p>
      <h1 style="margin:0 0 16px;font-size:20px;color:#e8f0f7">${inviterName || 'Your team'} invited you to ${companyName}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#b8cadb">
        You've been added as <strong style="color:#e8f0f7">${role}</strong> on ${companyName}'s live fleet map —
        trucks, equipment, crews, and tools in one place.
      </p>
      <a href="${link}"
         style="display:inline-block;background:#ff9e16;color:#1a1100;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;text-decoration:none">
        Accept invite
      </a>
      <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#7fa3bd">
        The link works once and expires in 14 days. If the button doesn't work, paste this into your browser:<br>
        <span style="color:#b8cadb;word-break:break-all">${link}</span>
      </p>
    </div>
  </div>`
}
