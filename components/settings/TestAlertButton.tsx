'use client'

import { useState } from 'react'
import { BellRing, Check, Loader2 } from 'lucide-react'
import { sendTestAlertAction } from '@/lib/actions/company'

/** Prove the theft-alert pipeline works WITHOUT waiting for a 2 AM movement:
 *  fires a clearly-labeled test through the real SMS + webhook path and
 *  reports exactly what is (and isn't) configured. */
export function TestAlertButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const fire = async () => {
    setBusy(true)
    setMsg(null)
    const r = await sendTestAlertAction()
    setBusy(false)
    if (!r.ok) { setMsg({ text: r.error ?? 'Failed to send.', ok: false }); return }
    if (r.smsAttempted) {
      setMsg({ text: `Test SMS sent to ${r.smsTo} — check your phone. Webhook ${r.webhookConfigured ? 'also posted' : 'not configured'}.`, ok: true })
    } else if (!r.twilioConfigured) {
      setMsg({ text: 'No SMS sent — add TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM in Vercel env vars first.' + (r.webhookConfigured ? ' (Webhook fired.)' : ''), ok: false })
    } else if (!r.smsTo) {
      setMsg({ text: 'Twilio is configured but no recipient — set the Alert phone above (or ALERT_SMS_TO).', ok: false })
    } else {
      setMsg({ text: 'Attempted — check Vercel logs if nothing arrives.', ok: true })
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={fire}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 text-amber font-display font-bold text-sm px-4 py-2 hover:bg-amber/20 transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
        Send test theft alert
      </button>
      {msg && (
        <p className={`text-xs flex items-start gap-1.5 ${msg.ok ? 'text-[#34d399]' : 'text-amber'}`}>
          {msg.ok && <Check className="h-3.5 w-3.5 flex-none mt-0.5" />}
          {msg.text}
        </p>
      )}
    </div>
  )
}
