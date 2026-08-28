'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { imeiLooksValid } from '@/lib/devices'
import { Button } from '@/components/ui/button'

/**
 * Point the phone at a device label and read the IMEI off its barcode.
 *
 * Typing fifteen digits, fourteen times, in a truck cab, is how you end up
 * with a tracker that reports perfectly into a company that has no asset
 * matching it — a failure indistinguishable from dead hardware (Brian,
 * Aug 28: "this process should be much simpler...").
 *
 * Uses the platform BarcodeDetector rather than pulling in a decoder: it is
 * native on Android Chrome (where the installer actually stands), and where
 * it is missing we simply do not offer the button — manual entry with the
 * Luhn check is the honest fallback, not a broken camera view.
 */

// Minimal shape of the platform API — TS has no lib.dom types for it yet.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function ctor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}

/** True when this browser can actually scan. Checked on mount, not at module
 *  load, so SSR never disagrees with the client about what's on screen. */
export function useCanScan() {
  const [can, setCan] = useState(false)
  useEffect(() => {
    setCan(!!ctor() && !!navigator.mediaDevices?.getUserMedia)
  }, [])
  return can
}

/** Device labels print the IMEI plain, but some barcodes carry a prefix or
 *  pack several fields. Pull the first 15-digit run that passes Luhn. */
function imeiFrom(raw: string): string | null {
  const runs = raw.match(/\d{15,}/g) ?? []
  for (const run of runs) {
    for (let i = 0; i + 15 <= run.length; i++) {
      const candidate = run.slice(i, i + 15)
      if (imeiLooksValid(candidate).ok) return candidate
    }
  }
  return null
}

export function ImeiScanner({ onFound, onClose }: { onFound: (imei: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState('Point the camera at the barcode on the device label.')

  // Keep the live objects in refs so the cleanup below can always reach them,
  // even if the effect re-runs or the component unmounts mid-frame. A camera
  // left running is the worst kind of leak — the indicator light stays on.
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const doneRef = useRef(false)

  const stop = useCallback(() => {
    doneRef.current = true
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    const Detector = ctor()
    if (!Detector) { setError('This browser can’t scan barcodes. Type the IMEI instead.'); return }

    let cancelled = false
    const detector = new Detector({ formats: ['code_128', 'code_39', 'qr_code', 'data_matrix', 'itf'] })

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (!v) { stream.getTracks().forEach((t) => t.stop()); return }
        v.srcObject = stream
        await v.play()

        let misses = 0
        const tick = async () => {
          if (doneRef.current || cancelled) return
          try {
            const codes = await detector.detect(v)
            for (const c of codes) {
              const imei = imeiFrom(c.rawValue)
              if (imei) { stop(); onFound(imei); return }
            }
            // Seeing barcodes but none of them an IMEI is worth saying — it
            // usually means the SIM tray or a packaging code is in frame.
            if (codes.length) {
              misses++
              if (misses > 12) setHint('Reading a barcode, but it isn’t a 15-digit IMEI. Try the one under the model number.')
            }
          } catch { /* a dropped frame is normal; keep going */ }
          rafRef.current = requestAnimationFrame(() => { void tick() })
        }
        void tick()
      } catch (e) {
        if (cancelled) return
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        setError(denied
          ? 'Camera access was blocked. Allow it in your browser settings, or type the IMEI instead.'
          : 'Couldn’t start the camera. Type the IMEI instead.')
      }
    })()

    return () => { cancelled = true; stop() }
  }, [onFound, stop])

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl overflow-hidden bg-navy-950 border border-navy-800 aspect-[4/3]">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {/* Sight line — a full frame invites people to fill it with the whole
            label; a narrow band gets the barcode close enough to decode. */}
        {!error && (
          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-16 border-2 border-amber/70 rounded-lg pointer-events-none" />
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <p className="text-[13px] text-faint leading-relaxed">{error}</p>
          </div>
        )}
        <button
          onClick={() => { stop(); onClose() }}
          aria-label="Close scanner"
          className="absolute top-2 right-2 h-8 w-8 grid place-items-center rounded-full bg-navy-950/80 text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!error && <p className="text-[12.5px] text-faint leading-relaxed">{hint}</p>}
      <Button variant="outline" onClick={() => { stop(); onClose() }} className="w-full">
        Type it instead
      </Button>
    </div>
  )
}

export function ScanButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="gap-1.5 shrink-0">
      <Camera className="h-4 w-4" /> Scan
    </Button>
  )
}
