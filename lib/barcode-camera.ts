'use client'

/**
 * The phone camera as a barcode reader — the tracker-label and QR scanners
 * share it (Tenna's Play reviews, Oct 4: "camera can't scan successfully").
 *
 *  - The phone's own BarcodeDetector when it reads the formats we need; else
 *    zxing (open source, MIT) through the same API — iOS, and the Android
 *    WebViews without one, used to get no camera at all. Its WebAssembly is
 *    served from /zxing — a copy of node_modules/zxing-wasm's reader build
 *    that scripts/barcode-test.mjs checks; never a third-party CDN at scan time.
 *  - A 1080p feed with continuous focus where the camera offers it — a
 *    15-digit IMEI barcode is ~3 cm across, and the default 640×480 often
 *    can't resolve its bars.
 *  - The flashlight, where the camera has one: labels live in dark cabs and
 *    under dashboards.
 */

export interface Detected { rawValue: string }
export interface Detector { detect(source: CanvasImageSource): Promise<Detected[]> }
type DetectorCtor = (new (opts?: { formats?: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> }

export const SCAN_FORMATS = ['code_128', 'qr_code', 'code_39', 'ean_13', 'itf', 'data_matrix']
/** The zxing WebAssembly this build ships (public/zxing). */
export const ZXING_WASM_PATH = '/zxing/zxing_reader.wasm'

export async function makeDetector(formats: string[] = SCAN_FORMATS): Promise<{ detector: Detector; engine: 'native' | 'zxing' }> {
  const Native = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? formats
      const use = formats.filter((f) => supported.includes(f))
      // The two that matter: the IMEI's Code 128 and our QR stickers.
      if (use.includes('code_128') && use.includes('qr_code')) return { detector: new Native({ formats: use }), engine: 'native' }
    } catch { /* no usable native reader — zxing below */ }
  }
  const m = await import('barcode-detector/ponyfill')
  m.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? ZXING_WASM_PATH : prefix + path) } })
  return { detector: new m.BarcodeDetector({ formats: formats as never }) as unknown as Detector, engine: 'zxing' }
}

export interface Camera {
  /** The camera has a flashlight we can switch. */
  torch: boolean
  setTorch(on: boolean): Promise<boolean>
  stop(): void
}

type TrackCaps = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }

export async function openCamera(video: HTMLVideoElement): Promise<Camera> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  })
  const stop = () => stream.getTracks().forEach((t) => t.stop())
  try {
    const track = stream.getVideoTracks()[0]
    const caps = (track?.getCapabilities?.() ?? {}) as TrackCaps
    if (caps.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
    }
    video.srcObject = stream
    await video.play().catch(() => {})
    return {
      torch: !!caps.torch,
      setTorch: async (on) => {
        try { await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }); return true } catch { return false }
      },
      stop,
    }
  } catch (e) {
    stop()
    throw e
  }
}
