'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'

/**
 * First-run guided tour of the live map — spotlights each control with a
 * plain-English card. No library: targets are found by [data-tour] attribute
 * (or a CSS selector), highlighted with a glowing ring, card floats beside.
 *
 * Runs once per device (localStorage), skippable at every step, and can be
 * relaunched any time via the `ht:tour` window event (Getting Started page).
 */

const DONE_KEY = 'ht_map_tour_done_v1'

interface Step {
  selector: string
  title: string
  body: string
  /** Prefer placing the card on this side of the target. */
  side: 'below' | 'above'
}

// Built per-surface (Aug 22 truth-check): the public /live demo has no
// New-zone button, so the tour must not point at one there.
const buildSteps = (canDrawZones: boolean): Step[] => [
  {
    selector: '[data-tour="layers"]',
    title: 'Layers & your fleet',
    body: 'Layers holds the map itself — basemaps, radar and weather, job-site money layers, land checks. The chips underneath flip your fleet on and off the map: trucks, machines, people, tools, zones.',
    side: 'below',
  },
  {
    selector: '[data-tour="askai"]',
    title: 'AskAI',
    body: 'Ask in plain English — "Where\'s the crew truck?" or "How long were we at the Smith job this week?" It answers from your live fleet data.',
    side: 'below',
  },
  {
    selector: '.maplibregl-ctrl-top-right',
    title: 'Zoom & locate',
    body: 'Zoom, tilt for 3D, jump to your own location, or fit the whole fleet on screen in one tap — the same stack also measures distances & takeoffs, '
      + (canDrawZones ? 'draws a new zone, ' : '')
      + 'and saves a branded PDF snapshot of the map.',
    side: 'below',
  },
  {
    selector: '[data-tour="timeline"]',
    title: 'The time machine',
    body: 'Live is now. Tap Today, Yesterday, or any range and drag the slider to replay exactly where everything went — trails, heatmap, and 3D views included.',
    side: 'above',
  },
  {
    selector: '[data-tour="nav"]',
    title: 'Everything else',
    body: 'Assets lists your fleet and tools. Alerts is where after-hours movement, fuel warnings, and zone activity land. That\'s the tour — go click a truck!',
    side: 'above',
  },
]

export function MapTour({ canDrawZones = true }: { canDrawZones?: boolean }) {
  const [step, setStep] = useState<number | null>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Stable across renders (buildSteps is pure); rebuilt only if the surface's
  // capabilities change.
  const steps = buildSteps(canDrawZones)

  // Auto-start once per device; relaunchable via window event or ?tour=1.
  useEffect(() => {
    const start = () => setStep(0)
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tour') === '1') {
      const t = setTimeout(start, 900)
      window.addEventListener('ht:tour', start)
      return () => { clearTimeout(t); window.removeEventListener('ht:tour', start) }
    }
    try {
      if (!localStorage.getItem(DONE_KEY)) {
        // Small delay so the map chrome has mounted before we measure it.
        const t = setTimeout(start, 1600)
        window.addEventListener('ht:tour', start)
        return () => { clearTimeout(t); window.removeEventListener('ht:tour', start) }
      }
    } catch { /* private mode — event-only */ }
    window.addEventListener('ht:tour', start)
    return () => window.removeEventListener('ht:tour', start)
  }, [])

  const finish = useCallback(() => {
    setStep(null)
    try { localStorage.setItem(DONE_KEY, new Date().toISOString()) } catch { /* private mode */ }
  }, [])

  // Measure the current step's target; re-measure on resize. Skip missing
  // targets (e.g. timeline hidden because no tracks yet).
  useEffect(() => {
    if (step === null) return
    const measure = () => {
      const el = document.querySelector(steps[step].selector)
      if (!el) { setBox(null); return }
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) { setBox(null); return }
      setBox({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    const id = setInterval(measure, 500) // chrome moves (panels open/close)
    return () => { window.removeEventListener('resize', measure); clearInterval(id) }
  }, [step])

  useEffect(() => {
    if (step !== null && box === null) {
      // Target absent — auto-advance past it.
      const t = setTimeout(() => setStep((s) => (s !== null && s < steps.length - 1 ? s + 1 : (finish(), null))), 250)
      return () => clearTimeout(t)
    }
  }, [step, box, finish])

  if (step === null) return null
  const s = steps[step]
  const last = step === steps.length - 1

  // Card position: clamped to viewport, preferring the step's side.
  const CARD_W = 300
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const cx = box ? Math.min(Math.max(12, box.x + box.w / 2 - CARD_W / 2), vw - CARD_W - 12) : 12
  const below = s.side === 'below'
  const cy = box ? (below ? Math.min(box.y + box.h + 14, vh - 220) : Math.max(12, box.y - 14)) : vh / 2

  return (
    <div className="fixed inset-0 z-[95]">
      {/* dim backdrop — click skips nothing, X/Skip are explicit */}
      <div className="absolute inset-0 bg-navy-950/55" onClick={finish} />
      {/* glow ring on the target */}
      {box && (
        <div
          className="absolute rounded-2xl border-2 border-amber shadow-glow-amber pointer-events-none transition-all duration-300"
          style={{ left: box.x - 6, top: box.y - 6, width: box.w + 12, height: box.h + 12 }}
        />
      )}
      {/* the card */}
      <div
        className="absolute w-[300px] rounded-2xl bg-navy-900 border border-navy-600 shadow-panel p-4 transition-all duration-300"
        style={{ left: cx, top: cy, transform: below ? undefined : 'translateY(-100%)' }}
      >
        <button
          onClick={finish}
          aria-label="Close tour"
          className="absolute -top-3 right-3 grid place-items-center w-7 h-7 rounded-full bg-navy-900 border border-navy-600 text-faint hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <p className="font-display font-bold text-[15px] text-ink">{s.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex gap-1">
            {steps.map((_, i) => (
              <span key={i} className={'w-1.5 h-1.5 rounded-full ' + (i === step ? 'bg-amber' : 'bg-navy-700')} />
            ))}
          </span>
          <button onClick={finish} className="ml-auto text-[12px] font-semibold text-faint hover:text-ink px-2 py-1">
            Skip
          </button>
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="grid place-items-center w-8 h-8 rounded-lg border border-navy-700 text-faint hover:text-ink"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] px-3 py-1.5 hover:bg-amber-600"
          >
            {last ? 'Done' : 'Next'} {!last && <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
