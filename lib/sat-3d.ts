import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl'

/**
 * True-3D satellite rendering — each bird floats at its REAL altitude above
 * the globe instead of being squashed onto its ground-track point.
 *
 * How: a MapLibre custom layer asks the transform for a model matrix at
 * (lon, lat, altitude-in-meters) — `getMatrixForModel` works under both globe
 * and mercator projections — and draws a point sprite at that position in
 * clip space. LEO birds hug the surface (~400 km), GPS rides mid-orbit
 * (~20,200 km), and the GEO weather ring hangs 35,786 km out, exactly to
 * scale with the planet.
 *
 * Satellites on the far side of the planet are hidden by a camera→satellite
 * segment-vs-unit-sphere test (the globe shader projects a unit sphere, so
 * occlusion is pure geometry — no depth-buffer dependence).
 */

export interface Sat3D {
  name: string
  group: string
  lon: number
  lat: number
  altKm: number
  mph: number | null
  /** Screen cache in CSS px, written by the render pass — used for hit-testing. */
  sx: number
  sy: number
  visible: boolean
}

const CORE_COLORS: Record<string, [number, number, number]> = {
  gps: [0.204, 0.827, 0.6], // #34d399
  weather: [1.0, 0.62, 0.086], // #ff9e16
  stations: [0.957, 0.447, 0.714], // #f472b6
}
const CORE_DEFAULT: [number, number, number] = [0.91, 0.941, 0.969] // #e8f0f7
const GLOW: [number, number, number] = [0.49, 0.827, 0.988] // #7dd3fc

/** Piecewise-linear size by orbit altitude (km) — LEO specks, GEO lanterns. */
function sizeFor(altKm: number, stops: [number, number][]): number {
  if (altKm <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    if (altKm <= stops[i][0]) {
      const [x0, y0] = stops[i - 1]
      const [x1, y1] = stops[i]
      return y0 + ((altKm - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return stops[stops.length - 1][1]
}
const CORE_SIZE: [number, number][] = [[300, 3.5], [2000, 4.5], [20000, 6.5], [36000, 8.5]]
const GLOW_SIZE: [number, number][] = [[300, 9], [2000, 12], [20000, 19], [36000, 26]]

type V4 = [number, number, number, number]

function mulMV(m: ArrayLike<number>, v: V4): V4 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ]
}

/** 4×4 inverse via adjugate; null if singular. */
function inv4(m: ArrayLike<number>): number[] | null {
  const inv = new Array<number>(16)
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
  if (!det) return null
  for (let i = 0; i < 16; i++) inv[i] /= det
  return inv
}

const VERT = `
attribute vec3 a_pos;
uniform vec4 u_pos;
uniform float u_size;
void main() {
  gl_Position = u_pos + vec4(a_pos, 0.0) * 0.0;
  gl_PointSize = u_size;
}`

const FRAG = `
precision mediump float;
uniform vec4 u_color;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = 1.0 - smoothstep(0.65, 1.0, r);
  gl_FragColor = u_color * a;
}`

interface ModelTransform {
  getMatrixForModel(location: [number, number], altitude?: number): ArrayLike<number>
}

export function createSat3DLayer(getSats: () => Sat3D[] | null): CustomLayerInterface {
  let prog: WebGLProgram | null = null
  let buf: WebGLBuffer | null = null
  let aPos = 0
  let uPos: WebGLUniformLocation | null = null
  let uSize: WebGLUniformLocation | null = null
  let uColor: WebGLUniformLocation | null = null
  let mapRef: MLMap | null = null

  return {
    id: 'sat-3d',
    type: 'custom',
    renderingMode: '3d',

    onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      mapRef = map
      const vs = gl.createShader(gl.VERTEX_SHADER)!
      gl.shaderSource(vs, VERT)
      gl.compileShader(vs)
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!
      gl.shaderSource(fs, FRAG)
      gl.compileShader(fs)
      prog = gl.createProgram()!
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        prog = null
        return
      }
      aPos = gl.getAttribLocation(prog, 'a_pos')
      uPos = gl.getUniformLocation(prog, 'u_pos')
      uSize = gl.getUniformLocation(prog, 'u_size')
      uColor = gl.getUniformLocation(prog, 'u_color')
      buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0]), gl.STATIC_DRAW)
    },

    onRemove(_map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      if (prog) gl.deleteProgram(prog)
      if (buf) gl.deleteBuffer(buf)
      prog = null
      buf = null
      mapRef = null
    },

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
      const sats = getSats()
      if (!sats || !sats.length || !prog || !mapRef) return
      const main = options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>
      const tr = (mapRef as unknown as { transform: ModelTransform }).transform
      if (typeof tr?.getMatrixForModel !== 'function') return

      // Camera position in planet space (globe shader projects a unit sphere).
      // M·cam = [0,0,c,0] for perspective M, so cam = q.xyz/q.w with
      // q = M⁻¹·[0,0,1,0] — sign of c cancels. Used to hide far-side birds.
      let cam: [number, number, number] | null = null
      if (options.shaderData.variantName === 'globe') {
        const inv = inv4(main)
        if (inv) {
          const q = mulMV(inv, [0, 0, 1, 0])
          if (Math.abs(q[3]) > 1e-12) {
            const c: [number, number, number] = [q[0] / q[3], q[1] / q[3], q[2] / q[3]]
            if (c[0] * c[0] + c[1] * c[1] + c[2] * c[2] > 1.002) cam = c
          }
        }
      }

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const wCss = gl.drawingBufferWidth / dpr
      const hCss = gl.drawingBufferHeight / dpr

      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      if (aPos >= 0) {
        gl.enableVertexAttribArray(aPos)
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
      }
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied output
      gl.disable(gl.DEPTH_TEST) // occlusion handled geometrically above

      for (const s of sats) {
        const model = tr.getMatrixForModel([s.lon, s.lat], s.altKm * 1000)
        const tw = model[15] || 1
        const S: [number, number, number] = [model[12] / tw, model[13] / tw, model[14] / tw]

        if (cam) {
          // Segment cam→sat vs unit sphere: hidden when the planet sits between.
          const dx = S[0] - cam[0], dy = S[1] - cam[1], dz = S[2] - cam[2]
          const a = dx * dx + dy * dy + dz * dz
          const b = 2 * (cam[0] * dx + cam[1] * dy + cam[2] * dz)
          const cc = cam[0] * cam[0] + cam[1] * cam[1] + cam[2] * cam[2] - 1
          const disc = b * b - 4 * a * cc
          if (disc > 0) {
            const t = (-b - Math.sqrt(disc)) / (2 * a)
            if (t > 0 && t < 1) { s.visible = false; continue }
          }
        }

        const clip = mulMV(main, [model[12], model[13], model[14], model[15]])
        if (clip[3] <= 0) { s.visible = false; continue }
        const nx = clip[0] / clip[3]
        const ny = clip[1] / clip[3]
        if (nx < -1.2 || nx > 1.2 || ny < -1.2 || ny > 1.2) { s.visible = false; continue }
        s.sx = (nx * 0.5 + 0.5) * wCss
        s.sy = (1 - (ny * 0.5 + 0.5)) * hCss
        s.visible = true

        gl.uniform4f(uPos, clip[0], clip[1], clip[2], clip[3])

        // Halo pass (premultiplied alpha)
        const ga = 0.32
        gl.uniform1f(uSize, sizeFor(s.altKm, GLOW_SIZE) * dpr)
        gl.uniform4f(uColor, GLOW[0] * ga, GLOW[1] * ga, GLOW[2] * ga, ga)
        gl.drawArrays(gl.POINTS, 0, 1)

        // Core pass
        const c = CORE_COLORS[s.group] ?? CORE_DEFAULT
        gl.uniform1f(uSize, sizeFor(s.altKm, CORE_SIZE) * dpr)
        gl.uniform4f(uColor, c[0], c[1], c[2], 1)
        gl.drawArrays(gl.POINTS, 0, 1)
      }
    },
  }
}

/** Nearest visible satellite within `radiusPx` of a screen point, or null. */
export function pickSat(sats: Sat3D[] | null, x: number, y: number, radiusPx = 16): Sat3D | null {
  if (!sats) return null
  let best: Sat3D | null = null
  let bd = radiusPx
  for (const s of sats) {
    if (!s.visible) continue
    const d = Math.hypot(s.sx - x, s.sy - y)
    if (d < bd) { bd = d; best = s }
  }
  return best
}
