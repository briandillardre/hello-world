'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'

interface DetectedBarcode { rawValue: string }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}

/**
 * The phone camera as a barcode reader — no library. Native BarcodeDetector
 * covers the Android phones this happens on; where it is missing the
 * component renders nothing and the caller's type-it-in path is the way.
 * Every decoded code is handed to `onCode`; the caller owns throttling.
 */
export function Scanner({ onCode, hint = 'Point at the barcode or QR on the label' }: { onCode: (raw: string) => void; hint?: string }) {
  const [state, setState] = useState<'starting' | 'on' | 'off'>('starting')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) { setState('off'); return }
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        if (cancelled) return
        const detector = new Detector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13', 'itf', 'data_matrix'] })
        setState('on')
        timer = setInterval(async () => {
          const v = videoRef.current
          if (!v || v.readyState < 2) return
          try {
            const codes = await detector.detect(v)
            for (const c of codes) if (c.rawValue) onCodeRef.current(c.rawValue)
          } catch { /* next frame */ }
        }, 350)
      } catch {
        if (!cancelled) setState('off')
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  if (state === 'off') return null
  return (
    <div className="relative rounded-xl overflow-hidden border border-navy-700 bg-navy-950 aspect-[4/3]">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 rounded-lg border-2 border-amber/70 pointer-events-none" />
      <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-ink/80 drop-shadow">{hint}</p>
      {state === 'starting' && (
        <div className="absolute inset-0 grid place-items-center text-faint text-sm bg-navy-950/80">
          <span className="flex items-center gap-2"><Camera className="h-4 w-4" /> Starting camera…</span>
        </div>
      )}
    </div>
  )
}
