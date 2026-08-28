'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Camera, CheckCircle2, CircleAlert, Keyboard, ScanLine, Truck, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { quickAddTrackerAction } from '@/lib/actions/assets'

/**
 * Scan-to-map: point the phone at the IMEI barcode on the tracker's box,
 * the asset exists, the dot appears on first report. Built batch-first —
 * unbox 13 devices, scan 13 times, done (Brian, Aug 28: setup time was
 * "absolutely insane"; the app side is now seconds per device).
 *
 * Camera scanning uses the native BarcodeDetector where the browser has it
 * (Android Chrome — the phone that's actually in the truck yard); every
 * browser gets the type-it-in path, which also covers unreadable labels.
 */

type Row =
  | { kind: 'created'; id: string; name: string }
  | { kind: 'existing'; id: string; name: string }
  | { kind: 'error'; text: string }

interface DetectedBarcode { rawValue: string }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}

export function TrackerScan() {
  const [type, setType] = useState<'vehicle' | 'equipment'>('vehicle')
  const [rows, setRows] = useState<Row[]>([])
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // IMEIs handled this session — a barcode in frame fires the detector many
  // times a second; each box must land exactly one row.
  const seenRef = useRef<Set<string>>(new Set())
  const typeRef = useRef(type)
  typeRef.current = type
  const busyRef = useRef(false)

  const submit = async (raw: string) => {
    const imei = (raw.match(/\d{15}/) ?? [])[0]
    if (imei) {
      if (seenRef.current.has(imei)) return
      seenRef.current.add(imei)
    }
    if (busyRef.current) { if (imei) seenRef.current.delete(imei); return }
    busyRef.current = true
    setBusy(true)
    try {
      const res = await quickAddTrackerAction(raw, typeRef.current)
      if (res.existing) setRows((r) => [{ kind: 'existing', id: res.existing!.id, name: res.existing!.name }, ...r])
      else if (res.ok && res.asset) setRows((r) => [{ kind: 'created', id: res.asset!.id, name: res.asset!.name }, ...r])
      else {
        if (imei) seenRef.current.delete(imei) // let a failed one retry
        setRows((r) => [{ kind: 'error', text: res.error ?? 'Could not add that tracker.' }, ...r])
      }
    } catch {
      if (imei) seenRef.current.delete(imei)
      setRows((r) => [{ kind: 'error', text: 'Network hiccup — try that one again.' }, ...r])
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // Camera + native barcode loop. No library: BarcodeDetector covers the
  // Android phones this happens on; everyone else types the IMEI below.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) { setCamera('off'); return }
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        const detector = new Detector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13', 'itf'] })
        setCamera('on')
        timer = setInterval(async () => {
          const v = videoRef.current
          if (!v || v.readyState < 2 || busyRef.current) return
          try {
            const codes = await detector.detect(v)
            for (const c of codes) {
              if (/\d{15}/.test(c.rawValue)) { void submit(c.rawValue); break }
            }
          } catch { /* a frame that fails to decode is just the next frame */ }
        }, 350)
      } catch {
        if (!cancelled) setCamera('off') // denied/no camera → manual entry
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink flex items-center gap-2"><ScanLine className="h-5 w-5 text-amber" /> Scan trackers</h1>
        <p className="text-[13px] text-muted mt-1">
          Scan the IMEI barcode on each box. The asset exists immediately and its dot
          appears on the map the moment the device first reports — usually next ignition.
          Name it, pick an icon, and set rates whenever you like.
        </p>
      </div>

      {/* what is this box going in */}
      <div className="flex gap-2">
        {([['vehicle', 'Truck (OBD plug-in)', Truck], ['equipment', 'Machine (GPS unit)', Wrench]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setType(k)}
            className={
              'flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-colors ' +
              (type === k ? 'border-amber text-amber bg-amber/10' : 'border-navy-700 text-muted hover:text-ink')
            }
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* camera viewfinder — hidden entirely when scanning isn't available */}
      {camera !== 'off' && (
        <div className="relative rounded-xl overflow-hidden border border-navy-700 bg-navy-950 aspect-[4/3]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-24 rounded-lg border-2 border-amber/70 pointer-events-none" />
          {camera === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-faint text-sm bg-navy-950/80">
              <span className="flex items-center gap-2"><Camera className="h-4 w-4" /> Starting camera…</span>
            </div>
          )}
        </div>
      )}

      {/* the always-there fallback: type it */}
      <div className="rounded-xl border border-navy-800 bg-navy-950/60 p-3 space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5">
          <Keyboard className="h-3.5 w-3.5" /> {camera === 'off' ? 'Type the IMEI from the box label' : 'Or type it'}
        </p>
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) { void submit(manual); setManual('') } }}
            inputMode="numeric"
            placeholder="15-digit IMEI"
            className="flex-1 bg-navy-900 border border-navy-700 rounded-lg px-3 py-2 text-[16px] text-ink placeholder:text-faint outline-none focus:border-amber/50 font-mono"
          />
          <Button disabled={!manual.trim() || busy} onClick={() => { void submit(manual); setManual('') }}>Add</Button>
        </div>
      </div>

      {/* this session's boxes */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{rows.length} scanned</p>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-navy-800 bg-navy-950/60 px-3 py-2.5">
              {row.kind === 'error'
                ? <CircleAlert className="h-4 w-4 text-alert flex-none" />
                : <CheckCircle2 className={'h-4 w-4 flex-none ' + (row.kind === 'created' ? 'text-teal' : 'text-amber')} />}
              {row.kind === 'error' ? (
                <span className="text-[13px] text-muted">{row.text}</span>
              ) : (
                <>
                  <span className="text-[13.5px] text-ink font-medium truncate">{row.name}</span>
                  <span className="text-[12px] text-faint flex-none">{row.kind === 'created' ? 'added — on the map at first report' : 'already added'}</span>
                  <Link href={`/assets/${row.id}`} className="ml-auto text-[12.5px] font-semibold text-amber hover:underline flex-none">Open</Link>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
