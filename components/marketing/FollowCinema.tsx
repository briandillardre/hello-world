'use client'

/**
 * Self-contained "Follow Mode" cinematic for the splash hero.
 *
 * A pure-canvas dark-topo 3D flythrough — scan-line terrain relief, a winding
 * river, extruded buildings, and a glowing asset the camera chases: pan-up
 * reveal → chase along the amber trail → slow orbit → loop. It depends on NO
 * map tiles or external assets, so it always renders (unlike a live MapLibre
 * embed, which needs tile CDNs), and it mirrors the product's real Dark + Topo
 * map style. Pauses when scrolled off-screen and respects reduced motion.
 */

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const AMBER = '#ff9e16', CYAN = '#22d3ee', INK = '#e8f0f7', FAINT = '#7f9bb3'
const BG_DEEP = '#020c15'
const DUR = 20

function terrain(x: number, y: number) {
  return 1.8 * Math.sin(x * 0.1) * Math.cos(y * 0.085)
    + 0.9 * Math.sin(x * 0.21 + 1.7) * Math.cos(y * 0.17)
    + 0.5 * Math.sin(x * 0.37 + y * 0.28)
    + 1.4 * Math.sin((x + y) * 0.045)
}
function riverX(y: number) { return 7 * Math.sin(y * 0.055) + 3 * Math.sin(y * 0.13 + 2) }
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

const BUILDINGS: [number, number, number, number][] = []
for (let i = 0; i < 26; i++) {
  const y = 12 + i * 7 + (i % 3) * 2
  const side = (i % 2 ? 1 : -1) * (5 + (i % 4) * 2.2)
  BUILDINGS.push([riverX(y) + side, y, 1.6 + (i % 3) * 0.5, 2.2 + (i % 5) * 1.1])
}

export function FollowCinema() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0, dpr = 1
    const cam = { x: 0, y: 0, height: 3.4, yaw: 0 }
    let focal = 300, horizonY = 0
    let dist = 0, truckX = 0, truckY = 0, orbitAngle = 0
    const trail: [number, number][] = []

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = rect.width; H = rect.height
      canvas.width = W * dpr; canvas.height = H * dpr
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function project(wx: number, wy: number, wz: number) {
      const dx = wx - cam.x, dy = wy - cam.y
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw)
      const forward = dx * s + dy * c
      if (forward < 0.35) return null
      const lateral = dx * c - dy * s
      return { x: W / 2 + (lateral / forward) * focal, y: horizonY - ((wz - cam.height) / forward) * focal, f: forward }
    }
    function roundRect(x: number, y: number, w: number, h: number, r: number) {
      g!.beginPath(); g!.moveTo(x + r, y); g!.arcTo(x + w, y, x + w, y + h, r); g!.arcTo(x + w, y + h, x, y + h, r)
      g!.arcTo(x, y + h, x, y, r); g!.arcTo(x, y, x + w, y, r); g!.closePath()
    }
    function clockLabel(t: number) {
      const m = Math.floor(8 * 60 + 34 + t * 22)
      let hh = Math.floor(m / 60) % 24; const mm = m % 60, ap = hh >= 12 ? 'PM' : 'AM'
      hh = hh % 12; if (hh === 0) hh = 12
      return `${hh}:${String(mm).padStart(2, '0')} ${ap}`
    }

    function drawSky() {
      const sky = g!.createLinearGradient(0, 0, 0, horizonY + 40)
      sky.addColorStop(0, '#071726'); sky.addColorStop(1, BG_DEEP)
      g!.fillStyle = sky; g!.fillRect(0, 0, W, horizonY + 42)
      g!.fillStyle = BG_DEEP; g!.fillRect(0, horizonY + 40, W, H - horizonY - 40)
      const gl = g!.createRadialGradient(W / 2, horizonY, 20, W / 2, horizonY, W * 0.7)
      gl.addColorStop(0, 'rgba(20,80,111,0.28)'); gl.addColorStop(1, 'rgba(0,0,0,0)')
      g!.fillStyle = gl; g!.fillRect(0, 0, W, horizonY + 120)
    }
    function drawTerrain() {
      const LMAX = 34, COLS = 80
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw)
      for (let d = 62; d >= 3; d -= 0.8) {
        const near = 1 - clamp((d - 3) / 59, 0, 1)
        const pts: [number, number][] = []
        for (let i = 0; i <= COLS; i++) {
          const l = -LMAX + (2 * LMAX) * (i / COLS)
          const wx = cam.x + l * c + d * s, wy = cam.y - l * s + d * c
          const wz = terrain(wx, wy)
          pts.push([W / 2 + (l / d) * focal, horizonY - ((wz - cam.height) / d) * focal])
        }
        g!.beginPath(); g!.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) g!.lineTo(pts[i][0], pts[i][1])
        g!.lineTo(pts[pts.length - 1][0], H); g!.lineTo(pts[0][0], H); g!.closePath()
        const fill = g!.createLinearGradient(0, horizonY, 0, H)
        fill.addColorStop(0, '#08283c'); fill.addColorStop(1, BG_DEEP)
        g!.fillStyle = fill; g!.fill()
        g!.beginPath(); g!.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) g!.lineTo(pts[i][0], pts[i][1])
        g!.strokeStyle = `rgba(255,158,22,${0.12 + near * 0.72})`
        g!.lineWidth = 0.7 + near * 1.5; g!.stroke()
      }
    }
    function drawRiver() {
      const seg = []
      for (let y = cam.y + 2; y < cam.y + 60; y += 0.6) {
        const x = riverX(y), p = project(x, y, terrain(x, y) - 0.15); if (p) seg.push(p)
      }
      if (seg.length < 2) return
      g!.save(); g!.lineCap = 'round'
      for (let pass = 0; pass < 2; pass++) {
        g!.beginPath(); g!.moveTo(seg[0].x, seg[0].y)
        for (let i = 1; i < seg.length; i++) g!.lineTo(seg[i].x, seg[i].y)
        g!.strokeStyle = pass === 0 ? 'rgba(34,211,238,0.18)' : 'rgba(45,212,191,0.85)'
        g!.lineWidth = pass === 0 ? 9 : 2.4; g!.shadowColor = CYAN; g!.shadowBlur = pass === 0 ? 18 : 6; g!.stroke()
      }
      g!.restore()
    }
    function drawBuildings() {
      const list: [number, number, number, number, number][] = []
      for (const [x, y, bw, bh] of BUILDINGS) { const b = project(x, y, terrain(x, y)); if (b) list.push([b.f, x, y, bw, bh]) }
      list.sort((a, b) => b[0] - a[0])
      for (const [f, x, y, bw, bh] of list) {
        const gz = terrain(x, y)
        const corners = [[-bw / 2, -bw / 2], [bw / 2, -bw / 2], [bw / 2, bw / 2], [-bw / 2, bw / 2]]
        const bots = [], tops = []
        let ok = true
        for (const [ox, oy] of corners) {
          const b = project(x + ox, y + oy, gz), tp = project(x + ox, y + oy, gz + bh)
          if (!b || !tp) { ok = false; break }
          bots.push(b); tops.push(tp)
        }
        if (!ok) continue
        const near = clamp(1 - (f - 3) / 55, 0, 1)
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4
          g!.beginPath(); g!.moveTo(bots[i].x, bots[i].y); g!.lineTo(bots[j].x, bots[j].y)
          g!.lineTo(tops[j].x, tops[j].y); g!.lineTo(tops[i].x, tops[i].y); g!.closePath()
          g!.fillStyle = `rgba(30,52,74,${0.55 * near + 0.25})`; g!.fill()
          g!.strokeStyle = `rgba(96,165,250,${0.25 * near})`; g!.lineWidth = 0.8; g!.stroke()
        }
        g!.beginPath(); g!.moveTo(tops[0].x, tops[0].y)
        for (let i = 1; i < 4; i++) g!.lineTo(tops[i].x, tops[i].y); g!.closePath()
        g!.fillStyle = `rgba(42,63,87,${0.7 * near + 0.2})`; g!.fill()
        g!.strokeStyle = `rgba(96,165,250,${0.4 * near})`; g!.lineWidth = 1; g!.stroke()
      }
    }
    function drawTrail() {
      const pts = trail.map(([x, y]) => project(x, y, terrain(x, y) + 0.05)).filter(Boolean) as { x: number, y: number }[]
      if (pts.length < 2) return
      g!.save()
      for (let pass = 0; pass < 2; pass++) {
        g!.beginPath(); g!.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) g!.lineTo(pts[i].x, pts[i].y)
        g!.strokeStyle = pass === 0 ? 'rgba(255,158,22,0.20)' : 'rgba(255,158,22,0.95)'
        g!.lineWidth = pass === 0 ? 11 : 3.2; g!.lineJoin = 'round'; g!.lineCap = 'round'
        g!.shadowColor = AMBER; g!.shadowBlur = pass === 0 ? 20 : 8; g!.stroke()
      }
      g!.restore()
    }
    function drawTruck(t: number) {
      const p = project(truckX, truckY, terrain(truckX, truckY) + 0.15); if (!p) return
      const r = clamp(220 / p.f, 9, 28)
      g!.save()
      const gl = g!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6)
      gl.addColorStop(0, 'rgba(255,158,22,0.55)'); gl.addColorStop(1, 'rgba(255,158,22,0)')
      g!.fillStyle = gl; g!.beginPath(); g!.arc(p.x, p.y, r * 2.6, 0, 7); g!.fill()
      const pr = (t % 1.4) / 1.4
      g!.strokeStyle = `rgba(255,158,22,${0.6 * (1 - pr)})`; g!.lineWidth = 2
      g!.beginPath(); g!.arc(p.x, p.y, r + pr * r * 1.8, 0, 7); g!.stroke()
      g!.fillStyle = AMBER; g!.strokeStyle = '#04121d'; g!.lineWidth = 2.5
      g!.beginPath(); g!.arc(p.x, p.y, r, 0, 7); g!.fill(); g!.stroke()
      g!.font = `700 ${Math.round(r * 1.05)}px sans-serif`; g!.textAlign = 'center'; g!.textBaseline = 'middle'
      g!.fillText('🚚', p.x, p.y + 1)
      g!.font = '700 14px sans-serif'; g!.textAlign = 'left'
      const label = 'Silverado 1500 #3', tw = g!.measureText(label).width
      roundRect(p.x + r + 8, p.y - 15, tw + 16, 24, 7); g!.fillStyle = 'rgba(0,26,46,0.9)'; g!.fill()
      g!.strokeStyle = 'rgba(20,80,111,0.9)'; g!.lineWidth = 1; g!.stroke()
      g!.fillStyle = INK; g!.fillText(label, p.x + r + 16, p.y - 2)
      g!.restore()
    }
    function drawHUD(t: number) {
      g!.save(); g!.textBaseline = 'alphabetic'
      const tg = g!.createLinearGradient(0, 0, 0, 78); tg.addColorStop(0, 'rgba(2,12,21,0.8)'); tg.addColorStop(1, 'rgba(2,12,21,0)')
      g!.fillStyle = tg; g!.fillRect(0, 0, W, 78)
      // FOLLOWING chip
      g!.font = '700 13px sans-serif'; g!.textAlign = 'center'
      const chip = '🎥  FOLLOWING · Silverado 1500 #3', cw = g!.measureText(chip).width
      roundRect(W / 2 - cw / 2 - 14, 16, cw + 28, 30, 15); g!.fillStyle = 'rgba(255,158,22,0.16)'; g!.fill()
      g!.strokeStyle = 'rgba(255,158,22,0.5)'; g!.lineWidth = 1.2; g!.stroke()
      g!.fillStyle = AMBER; g!.fillText(chip, W / 2, 35)
      // clock
      g!.textAlign = 'right'; g!.font = '700 18px sans-serif'; g!.fillStyle = AMBER
      g!.fillText(clockLabel(t), W - 20, 33)
      g!.font = '600 11px sans-serif'; g!.fillStyle = FAINT; g!.fillText('Yesterday · replay', W - 20, 49)
      // bottom bar
      const by = H - 52
      const bg2 = g!.createLinearGradient(0, by - 26, 0, H); bg2.addColorStop(0, 'rgba(2,12,21,0)'); bg2.addColorStop(1, 'rgba(2,12,21,0.9)')
      g!.fillStyle = bg2; g!.fillRect(0, by - 26, W, H - (by - 26))
      roundRect(18, by, W - 36, 38, 12); g!.fillStyle = 'rgba(4,18,29,0.82)'; g!.fill()
      g!.strokeStyle = 'rgba(20,58,82,0.9)'; g!.lineWidth = 1; g!.stroke()
      g!.fillStyle = AMBER; g!.beginPath(); g!.arc(40, by + 19, 11, 0, 7); g!.fill()
      g!.fillStyle = '#1a1100'; g!.beginPath(); g!.moveTo(37, by + 14); g!.lineTo(37, by + 24); g!.lineTo(46, by + 19); g!.closePath(); g!.fill()
      const tx0 = 62, tx1 = W - 150, prog = clamp(t / DUR, 0, 1)
      g!.strokeStyle = 'rgba(127,155,179,0.35)'; g!.lineWidth = 4; g!.lineCap = 'round'
      g!.beginPath(); g!.moveTo(tx0, by + 19); g!.lineTo(tx1, by + 19); g!.stroke()
      g!.strokeStyle = AMBER; g!.beginPath(); g!.moveTo(tx0, by + 19); g!.lineTo(tx0 + (tx1 - tx0) * prog, by + 19); g!.stroke()
      g!.fillStyle = AMBER; g!.beginPath(); g!.arc(tx0 + (tx1 - tx0) * prog, by + 19, 5.5, 0, 7); g!.fill()
      g!.textAlign = 'left'; g!.font = '700 13px sans-serif'; g!.fillStyle = AMBER; g!.fillText('⛑ $27', tx1 + 14, by + 24)
      g!.fillStyle = FAINT; g!.font = '600 12px sans-serif'; g!.fillText('300×', W - 54, by + 24)
      // title lower-third
      if (t < 3.6) {
        const a = t < 0.5 ? smooth(t / 0.5) : t > 3.0 ? smooth(1 - (t - 3.0) / 0.6) : 1
        g!.globalAlpha = clamp(a, 0, 1); g!.textAlign = 'left'
        g!.font = '800 26px sans-serif'; g!.fillStyle = INK; g!.fillText('Follow Mode', 24, H / 2 - 4)
        g!.font = '600 14px sans-serif'; g!.fillStyle = AMBER
        g!.fillText('The camera rides with any asset — all day.', 26, H / 2 + 20)
        g!.globalAlpha = 1
      }
      // vignette
      const vg = g!.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85)
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)')
      g!.fillStyle = vg; g!.fillRect(0, 0, W, H)
      g!.restore()
    }

    let raf = 0, start: number | null = null, lastMs: number | null = null, running = true
    const tick = (now: number) => {
      if (!running) return
      if (start === null) start = now
      const abs = now - start
      const t = (abs / 1000) % DUR
      const dt = lastMs === null ? 0.016 : Math.min(0.05, (abs - lastMs) / 1000); lastMs = abs

      let v = 0
      if (t < 3) v = smooth(t / 3)
      else if (t < 12) v = 1
      else if (t < 13) v = smooth(1 - (t - 12))
      dist += v * dt * 6.2
      truckY = dist; truckX = 6.2 * Math.sin(dist * 0.11)
      const vx = 6.2 * 0.11 * Math.cos(dist * 0.11) * v + 0.0001
      const travelDir = Math.atan2(vx, 1)
      let targetOrbit = travelDir
      if (t >= 13) targetOrbit = travelDir + smooth(clamp((t - 13) / 4.2, 0, 1)) * Math.PI * 1.15
      orbitAngle += (targetOrbit - orbitAngle) * Math.min(1, dt * 3.2)
      cam.yaw += (orbitAngle - cam.yaw) * Math.min(1, dt * 3.5)
      const lead = t >= 13 ? 7.2 : 6.5
      cam.x = truckX - Math.sin(orbitAngle) * lead
      cam.y = truckY - Math.cos(orbitAngle) * lead
      cam.height = 3.2 + terrain(cam.x, cam.y) * 0.35 + 0.25 * Math.sin(t * 0.8)
      const reveal = smooth(clamp(t / 2.6, 0, 1))
      horizonY = H * (0.66 - 0.22 * reveal); focal = 250 + 70 * reveal
      if (t > 17.5) { const p = smooth(clamp((t - 17.5) / 2.5, 0, 1)); focal = 320 - 26 * p; cam.height += p * 1.4 }
      if (v > 0.02 && (trail.length === 0 || Math.hypot(truckX - trail[trail.length - 1][0], truckY - trail[trail.length - 1][1]) > 0.35))
        trail.push([truckX, truckY])
      while (trail.length > 220) trail.shift()
      if (t < 0.05) trail.length = 0 // reset on loop

      drawSky(); drawTerrain(); drawRiver(); drawTrail(); drawBuildings(); drawTruck(t); drawHUD(t)
      raf = requestAnimationFrame(tick)
    }

    if (reduced) {
      // one static, tilted hero frame — no motion
      cam.yaw = 0.25; dist = 40; truckY = dist; truckX = 6.2 * Math.sin(dist * 0.11)
      cam.x = truckX; cam.y = truckY - 6.5; cam.height = 3.6; horizonY = H * 0.44; focal = 300
      for (let i = 0; i < 60; i++) trail.push([6.2 * Math.sin((dist - i * 0.4) * 0.11), dist - i * 0.4])
      drawSky(); drawTerrain(); drawRiver(); drawTrail(); drawBuildings(); drawTruck(2); drawHUD(2)
    } else {
      raf = requestAnimationFrame(tick)
      // pause when off-screen to save battery
      const io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !running) { running = true; lastMs = null; start = null; raf = requestAnimationFrame(tick) }
        else if (!e.isIntersecting) { running = false; cancelAnimationFrame(raf) }
      }, { threshold: 0.05 })
      io.observe(canvas)
      return () => { running = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect() }
    }
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div className="relative rounded-2xl overflow-hidden border border-navy-800 shadow-panel ring-1 ring-amber/10 bg-[#020c15]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-800 bg-[#020c15]">
        <span className="font-mono text-[12px] text-faint">~/fleet/riverside-tower · dark + topo</span>
        <span className="font-mono text-[11px] text-teal flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-teal shadow-glow-teal animate-blink" /> FOLLOW MODE
        </span>
      </div>
      <canvas ref={canvasRef} className="block w-full aspect-[16/10]" />
      <Link
        href="/map"
        className="flex items-center justify-center gap-2 px-4 py-3 border-t border-navy-800 bg-amber/[0.06] hover:bg-amber/[0.12] transition-colors font-display font-bold text-[13.5px] text-amber"
      >
        Fly the camera with your own trucks — open the live map
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
