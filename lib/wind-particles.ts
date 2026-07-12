import type maplibregl from 'maplibre-gl'

/**
 * Animated wind-flow particles (the Windy look) on a plain canvas riding the
 * map. Particles live in geo coordinates, advect through a bilinear sample of
 * the model wind grid, and leave fading speed-colored trails. Cheap: one
 * canvas, ~1–2k particles, two composite ops per frame.
 */

export interface WindField {
  lat0: number; lon0: number; dLat: number; dLon: number
  ny: number; nx: number
  u: number[]; v: number[]
}

/** Bilinear m/s sample at a point; null outside the grid. */
export function sampleWind(f: WindField, lng: number, lat: number): [number, number] | null {
  const x = (lng - f.lon0) / f.dLon
  const y = (lat - f.lat0) / f.dLat
  if (x < 0 || y < 0 || x > f.nx - 1.001 || y > f.ny - 1.001) return null
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const i = (yy: number, xx: number) => yy * f.nx + xx
  const u =
    f.u[i(y0, x0)] * (1 - fx) * (1 - fy) + f.u[i(y0, x0 + 1)] * fx * (1 - fy) +
    f.u[i(y0 + 1, x0)] * (1 - fx) * fy + f.u[i(y0 + 1, x0 + 1)] * fx * fy
  const v =
    f.v[i(y0, x0)] * (1 - fx) * (1 - fy) + f.v[i(y0, x0 + 1)] * fx * (1 - fy) +
    f.v[i(y0 + 1, x0)] * (1 - fx) * fy + f.v[i(y0 + 1, x0 + 1)] * fx * fy
  return [u, v]
}

interface Particle { lng: number; lat: number; age: number; life: number }

function speedColor(ms: number): string {
  const mph = ms * 2.237
  if (mph < 8) return 'rgba(125,211,252,0.75)'   // light air — pale blue
  if (mph < 18) return 'rgba(45,212,191,0.85)'   // breeze — teal
  if (mph < 30) return 'rgba(255,158,22,0.9)'    // windy — amber
  return 'rgba(255,93,93,0.95)'                  // honking — red
}

/** Start the animation. Returns a stop() that tears everything down. */
export function startWindParticles(map: maplibregl.Map, field: WindField): () => void {
  const container = map.getContainer()
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1'
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')!

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const resize = () => {
    canvas.width = container.clientWidth * dpr
    canvas.height = container.clientHeight * dpr
    canvas.style.width = container.clientWidth + 'px'
    canvas.style.height = container.clientHeight + 'px'
  }
  resize()

  let particles: Particle[] = []
  const spawn = (): Particle => {
    const b = map.getBounds()
    return {
      lng: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
      lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
      age: 0,
      life: 80 + Math.random() * 90,
    }
  }
  const seed = () => {
    const n = Math.min(1200, Math.max(350, Math.round((container.clientWidth * container.clientHeight) / 1800)))
    particles = Array.from({ length: n }, spawn)
  }
  seed()

  // Trails smear into garbage while the camera moves — wipe and re-seed after.
  const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height)
  const onMoveEnd = () => { clear(); seed() }
  map.on('move', clear)
  map.on('moveend', onMoveEnd)
  map.on('resize', resize)

  let raf = 0
  const frame = () => {
    raf = requestAnimationFrame(frame)
    if (map.isMoving()) return // wiped during gestures; resume after

    // Fade what's already there — this is what turns dots into trails.
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = 'rgba(0,0,0,0.90)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineWidth = 1.05 * dpr
    ctx.lineCap = 'round'

    // Constant SCREEN speed regardless of zoom: direction is the wind's,
    // pace is pixels-per-frame scaled gently by wind strength. Zoom in and
    // particles glide; zoom out and they glide the same — never a sandstorm.
    const zoom = map.getZoom()
    const degPerPx = 360 / (512 * Math.pow(2, zoom))

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const uv = sampleWind(field, p.lng, p.lat)
      if (!uv || ++p.age > p.life) { particles[i] = spawn(); continue }
      const [u, v] = uv
      const ms = Math.hypot(u, v)
      if (ms < 0.05) { particles[i] = spawn(); continue }
      const pxSpeed = Math.min(3, 0.4 + ms * 0.14) // 10 m/s ≈ 1.8 px/frame
      const k = (pxSpeed * degPerPx) / ms
      const nLng = p.lng + (u * k) / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))
      const nLat = p.lat + v * k * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))
      const a = map.project([p.lng, p.lat])
      const b = map.project([nLng, nLat])
      ctx.strokeStyle = speedColor(Math.hypot(u, v))
      ctx.beginPath()
      ctx.moveTo(a.x * dpr, a.y * dpr)
      ctx.lineTo(b.x * dpr, b.y * dpr)
      ctx.stroke()
      p.lng = nLng
      p.lat = nLat
      // Off-screen? Recycle so density stays where the eyes are.
      if (b.x < -40 || b.y < -40 || b.x > container.clientWidth + 40 || b.y > container.clientHeight + 40) {
        particles[i] = spawn()
      }
    }
  }
  raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    map.off('move', clear)
    map.off('moveend', onMoveEnd)
    map.off('resize', resize)
    canvas.remove()
  }
}
