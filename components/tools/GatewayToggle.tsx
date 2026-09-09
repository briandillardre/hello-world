'use client'

import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import { isNativeApp } from '@/lib/native'
import { GATEWAY_STATUS_EVENT, phoneGatewayEnabled, setPhoneGateway, type GatewayStatus } from './PhoneGateway'

/** The switch that makes this phone a tag gateway, with a live status line. */
export function GatewayToggle() {
  const [native, setNative] = useState(false)
  const [on, setOn] = useState(false)
  const [st, setSt] = useState<GatewayStatus | null>(null)
  useEffect(() => {
    setNative(isNativeApp()); setOn(phoneGatewayEnabled())
    const h = (e: Event) => setSt((e as CustomEvent<GatewayStatus>).detail)
    window.addEventListener(GATEWAY_STATUS_EVENT, h)
    return () => window.removeEventListener(GATEWAY_STATUS_EVENT, h)
  }, [])
  if (!native) return null
  const ago = st?.reportedAt ? Math.round((Date.now() - st.reportedAt) / 1000) : null
  return (
    <section className="rounded-xl border border-teal/30 bg-teal/[0.05] p-4 space-y-2">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-teal/15 border border-teal/30 grid place-items-center flex-none"><Radio className={'h-4 w-4 text-teal ' + (on ? 'animate-pulse' : '')} /></span>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-sm text-ink">This phone hears tags</p>
          <p className="text-[12px] text-muted leading-snug">While the app is open, the tools near you show on the map as riding with you — the way they ride with a truck. Every 20 seconds it reports what it heard and where you were.</p>
        </div>
        <button
          type="button" role="switch" aria-checked={on}
          onClick={() => { const next = !on; setOn(next); setPhoneGateway(next) }}
          className={'relative flex-none w-12 h-7 rounded-full border transition-colors ' + (on ? 'bg-teal border-teal' : 'bg-navy-800 border-navy-600')}
        >
          <span className={'absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ' + (on ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>
      </div>
      {on && (
        <p className="text-[11.5px] font-mono text-faint">
          {st?.error ? <span className="text-alert">{st.error}</span>
            : st?.reportedAt ? `heard ${st.heard} tag${st.heard === 1 ? '' : 's'} · ${st.matched} known tool${st.matched === 1 ? '' : 's'} · holding ${st.holding} · reported ${ago}s ago`
            : st ? `listening… heard ${st.heard} tag${st.heard === 1 ? '' : 's'} so far` : 'starting…'}
        </p>
      )}
    </section>
  )
}
