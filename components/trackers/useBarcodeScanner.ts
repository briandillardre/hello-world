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
      try {
        const [c, { detector }] = await Promise.all([openCamera(v), makeDetector()])
        if (cancelled) { c.stop(); return }
        cam.current = c
        setTorch({ available: c.torch, on: false })
        setState('on')
        let detecting = false
        let last = '', lastAt = 0
        timer = setInterval(async () => {
          if (!v || v.readyState < 2 || detecting) return
          detecting = true
          try {
            const codes = await detector.detect(v)
            if (cancelled) return
            for (const code of codes) {
              if (!code.rawValue) continue
              const took = onCodeRef.current(code.rawValue)
              const now = Date.now()
              if (took !== false && (code.rawValue !== last || now - lastAt > 2500)) {
                try { navigator.vibrate?.(40) } catch { /* no vibration */ }
              }
              last = code.rawValue; lastAt = now
            }
          } catch { /* a frame that fails to decode is just the next frame */ }
          finally { detecting = false }
        }, 350)
      } catch {
        if (!cancelled) setState('off') // denied / no camera → type it in
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
