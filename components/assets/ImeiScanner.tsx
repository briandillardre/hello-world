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

/**
 * Pull an IMEI out of a decoded barcode.
 *
 * EXACTLY fifteen digits, never a window slid along a longer run. An ICCID is
 * 19–20 digits, so a sliding window offers it five or six chances at a Luhn
 * pass — measured at ~47% on real SIM numbers, including the ones in this
 * repo's own fixtures. And a SIM card sitting on the device label is not a
 * hypothetical: our own pairing step tells people to photograph exactly that.
 * A false positive here writes a bogus tracker_id, and the device then reports
 * forever into a company with no asset matching it — precisely the failure
 * this scanner exists to prevent (ship-check, Aug 28 — P0).
 */
function imeiFrom(raw: string): string | null {
  const runs = raw.match(/(?<!\d)\d{15}(?!\d)/g) ?? []
  return runs.find((run) => imeiLooksValid(run).ok) ?? null
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
  // Held in a ref so the effect does not depend on the caller's identity.
  // onFound is an inline arrow at the call site, so a new identity every
  // render would restart the camera constantly — and, with doneRef latched,
  // restart it DEAD (ship-check, Aug 28 — P0).
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound

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
    // Re-arm. stop() latches this true, and without resetting it here a second
    // run of the effect — a re-render, or React StrictMode's double-invoke in
    // dev — leaves a live camera preview whose detect loop returns on its
    // first line forever: visibly running, permanently blind.
    doneRef.current = false
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
            // Re-check after the await: the user can tap "Type it instead"
            // mid-frame, and firing onFound then would fill in a value they
            // just declined to scan.
            if (doneRef.current || cancelled) return
            for (const c of codes) {
              const imei = imeiFrom(c.rawValue)
              if (imei) { stop(); onFoundRef.current(imei); return }
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
  }, [stop])

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
