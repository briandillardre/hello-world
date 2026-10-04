'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { makeDetector, openCamera, type Camera } from '@/lib/barcode-camera'

/**
 * Camera + barcode loop for a <video>: reads ~3 frames a second and hands
 * every code to `onCode`, which says whether it took it (a short buzz when
 * it did — a hand-held phone needs to feel the read). `off` = no camera here,
 * or it was refused: the caller's type-it-in path is the way.
 */
export function useBarcodeScanner(videoRef: RefObject<HTMLVideoElement>, onCode: (raw: string) => boolean | void) {
  const [state, setState] = useState<'starting' | 'on' | 'off'>('starting')
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false })
  const cam = useRef<Camera | null>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const v = videoRef.current
    if (!v || !navigator.mediaDevices?.getUserMedia) { setState('off'); return }
    ;(async () => {
      let c: Camera | null = null
      try {
        // The camera first, then the reader: a reader that fails to load (an
        // offline yard, a chunk gone after a deploy) must not leave the camera
        // running behind a viewfinder that has already gone (ship-check, Oct 4).
        c = await openCamera(v)
        if (cancelled) { c.stop(); return }
        const { detector } = await makeDetector()
        if (cancelled) { c.stop(); return }
        cam.current = c
        setTorch({ available: c.torch, on: false })
        setState('on')
        let detecting = false
        let failures = 0
        // When each code last buzzed: two codes in view (IMEI + serial) used
        // to look new on every frame and buzz six times a second.
        const buzzed = new Map<string, number>()
        timer = setInterval(async () => {
          if (!v || v.readyState < 2 || detecting) return
          detecting = true
          try {
            const codes = await detector.detect(v)
            failures = 0
            if (cancelled) return
            for (const code of codes) {
              if (!code.rawValue) continue
              const took = onCodeRef.current(code.rawValue)
              const now = Date.now()
              if (took !== false && now - (buzzed.get(code.rawValue) ?? 0) > 2500) {
                buzzed.set(code.rawValue, now)
                try { navigator.vibrate?.(40) } catch { /* no vibration */ }
              }
            }
          } catch {
            // One bad frame is just the next frame; a reader that throws on
            // every frame never loaded — hand over to typing it in.
            if (++failures >= 10 && !cancelled) {
              if (timer) clearInterval(timer)
              c?.stop(); cam.current = null
              setState('off')
            }
          }
          finally { detecting = false }
        }, 350)
      } catch {
        c?.stop()
        if (!cancelled) setState('off') // denied / no camera / no reader → type it in
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      cam.current?.stop()
      cam.current = null
    }
  }, [videoRef])

  const toggleTorch = async () => {
    const c = cam.current
    if (!c?.torch) return
    const next = !torch.on
    if (await c.setTorch(next)) setTorch({ available: true, on: next })
  }
  return { state, torch, toggleTorch }
}
