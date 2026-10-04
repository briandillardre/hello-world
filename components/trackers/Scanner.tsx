'use client'

import { useRef } from 'react'
import { Camera, Flashlight, FlashlightOff } from 'lucide-react'
import { useBarcodeScanner } from './useBarcodeScanner'

/**
 * The phone camera as a barcode reader (lib/barcode-camera.ts: the phone's
 * own reader, else zxing; a sharp, focused feed; the flashlight). Where no
 * camera can be had the component renders nothing and the caller's
 * type-it-in path is the way. Every decoded code is handed to `onCode`; the
 * caller owns throttling.
 */
export function Scanner({ onCode, hint = 'Point at the barcode or QR on the label' }: { onCode: (raw: string) => boolean | void; hint?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { state, torch, toggleTorch } = useBarcodeScanner(videoRef, onCode)

  if (state === 'off') return null
  return (
    <div className="relative rounded-xl overflow-hidden border border-navy-700 bg-navy-950 aspect-[4/3]">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 rounded-lg border-2 border-amber/70 pointer-events-none" />
      <p className="absolute bottom-2 inset-x-14 text-center text-[11px] text-ink/80 drop-shadow">{hint}</p>
      {torch.available && (
        <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} aria-label={torch.on ? 'Turn the flashlight off' : 'Turn the flashlight on'}
          className={`absolute bottom-1.5 right-1.5 grid h-10 w-10 place-items-center rounded-full border ${torch.on ? 'border-amber bg-amber text-navy-950' : 'border-navy-600 bg-navy-950/70 text-ink'}`}>
          {torch.on ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
        </button>
      )}
      {state === 'starting' && (
        <div className="absolute inset-0 grid place-items-center text-faint text-sm bg-navy-950/80">
          <span className="flex items-center gap-2"><Camera className="h-4 w-4" /> Starting camera…</span>
        </div>
      )}
    </div>
  )
}
