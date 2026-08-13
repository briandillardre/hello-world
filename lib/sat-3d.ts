import { MercatorCoordinate } from 'maplibre-gl'
import { buildPlaneAtlas, ATLAS_CELLS, SHAPE_SPAN_FRAC, PLANE_CLASS_INDEX, PLANE_FLOOR_PX, type PlaneClass } from './aircraft-shapes'
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl'

/**
 * The sky engine — one custom WebGL layer that draws everything above the
 * map surface at TRUE position and scale:
 *
 *   · Satellites — each bird at its real altitude (LEO skims the surface,
 *     GPS rides mid-orbit, the GEO ring hangs 35,786 km out, to scale).
 *   · Sun & moon — placed by live ephemeris (lib/celestial.ts); discs sized
 *     to their real angular diameter (~0.5°), the moon shaded by its actual
 *     phase (lit from the sun's direction).
 *   · Stars — the Yale bright-star catalog on a distant shell, rotating with
 *     sidereal time, tinted by each star's B−V color, drawn in ONE batched
 *     call.
 *   · Aircraft — live ADS-B traffic as heading-rotated darts at true
 *     altitude (a 737 at 36,000 ft floats visibly above a pitched map).
 *
 * Positioning uses the transform's model matrix (globe- and mercator-aware);
 * bodies behind the planet are hidden by a camera→body segment-vs-unit-sphere
 * test (the globe shader projects a unit sphere, so occlusion is pure
 * geometry — no depth-buffer dependence). Clip-space z is clamped into the
 * frustum because these bodies live far beyond MapLibre's far plane.
 */

export interface Sat3D {
  name: string
  group: string
  lon: number
  lat: number
  altKm: number
  mph: number | null
  /** NORAD catalog number — popup detail + external tracking link. */
  norad?: string | null
  inclDeg?: number | null
  periodMin?: number | null
  /** Screen cache in CSS px, written by the render pass — used for hit-testing. */
  sx: number
  sy: number
  visible: boolean
}

export interface Plane3D {
  hex: string
  flight: string | null
  reg: string | null
  typeCode: string | null
  /** Friendly name from the type database ("Cessna 172", "Airbus A380"). */
  typeLabel: string | null
  /** Silhouette class + real wingspan — drives shape + on-screen size. */
  shape: PlaneClass
  spanM: number
  lon: number
  lat: number
  altFt: number
  mph: number | null
  track: number | null
  /** Estimated bank angle (rad, + = right turn) inferred from turn rate. */
  bankRad: number
  sx: number
  sy: number
  visible: boolean
}

export interface CelestialBody {
  kind: 'sun' | 'moon'
  /** Sub-point + altitude above the surface in meters — projected per frame. */
  lon: number
  lat: number
  altM: number
  /** True angular RADIUS as seen from Earth, radians (~0.0047 for both). */
  angRad: number
  distLabel: string
  /** Moon only: illuminated fraction 0..1 (popup display). */
  illum?: number
  sx: number
  sy: number
  visible: boolean
}

export interface CelestialState {
  sun: CelestialBody | null
  moon: CelestialBody | null
  /** Raw star records: lon, lat, sizePx, brightness, tint — 5 floats per star.
   *  The render pass projects them for the active projection variant. */
  stars: Float32Array | null
  starCount: number
  /** Bumped after rebuilding `stars`; the render pass re-projects + uploads. */
  starsRev: number
  /** Altitude of the star shell above the surface, meters. */
  starAltM: number
}

const CORE_COLORS: Record<string, [number, number, number]> = {
  gps: [0.204, 0.827, 0.6], // #34d399
  weather: [1.0, 0.62, 0.086], // #ff9e16
  stations: [0.957, 0.447, 0.714], // #f472b6
}
const CORE_DEFAULT: [number, number, number] = [0.91, 0.941, 0.969] // #e8f0f7
const GLOW: [number, number, number] = [0.49, 0.827, 0.988] // #7dd3fc
const PLANE_COLOR: [number, number, number] = [1.0, 0.85, 0.35] // amber dart (trail lines)
// Per-class paint (Brian, Aug 12) — airliners amber, widebodies deep
// orange, bizjets sky, GA props teal, helicopters violet. App palette.
const PLANE_CLASS_COLOR: Record<PlaneClass, [number, number, number]> = {
  narrow: [1.0, 0.62, 0.09],   // #ff9e16
  wide: [0.976, 0.451, 0.086], // #f97316
  biz: [0.49, 0.827, 0.988],   // #7dd3fc
  prop: [0.176, 0.831, 0.749], // #2dd4bf
  heli: [0.655, 0.545, 0.98],  // #a78bfa
}

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

type V3 = [number, number, number]
type V4 = [number, number, number, number]

function mulMV(m: ArrayLike<number>, v: V4): V4 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ]
}

/** Unit direction vector (ECEF-style axes) from a sub-point lat/lon. */
function dirFromLL(lonDeg: number, latDeg: number): V3 {
  const lon = lonDeg * Math.PI / 180
  const lat = latDeg * Math.PI / 180
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
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

// ── Point-sprite program (satellites, sun, moon, planes) ────────────────────
const POINT_VERT = `
attribute vec3 a_pos;
uniform vec4 u_pos;
uniform float u_size;
void main() {
  vec4 p = u_pos + vec4(a_pos, 0.0) * 0.0;
  // Bodies live far beyond MapLibre's far plane — pull z into the frustum
  // (we don't depth-test; draw order layers the sky).
  p.z = clamp(p.z, -abs(p.w) * 0.999, abs(p.w) * 0.999);
  gl_Position = p;
  gl_PointSize = u_size;
}`

const POINT_FRAG = `
precision mediump float;
uniform vec4 u_color;   // premultiplied
uniform vec3 u_light;   // moon mode: sun direction in sprite space (y down)
uniform float u_mode;   // 0 soft glow · 1 hard disc · 2 moon sphere
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  if (u_mode > 1.5) {
    float r2 = dot(pc, pc) * 4.0;
    if (r2 > 1.0) { gl_FragColor = vec4(0.0); return; }
    vec3 n = vec3(pc.x * 2.0, pc.y * 2.0, sqrt(max(0.0, 1.0 - r2)));
    float lit = max(dot(n, u_light), 0.0);
    float b = 0.06 + 0.94 * lit;
    float edge = 1.0 - smoothstep(0.92, 1.0, sqrt(r2));
    gl_FragColor = vec4(u_color.rgb * b, u_color.a) * edge;
  } else if (u_mode > 0.5) {
    float r = length(pc) * 2.0;
    float a = 1.0 - smoothstep(0.82, 1.0, r);
    gl_FragColor = u_color * a;
  } else {
    float r = length(pc) * 2.0;
    float a = 1.0 - smoothstep(0.65, 1.0, r);
    gl_FragColor = u_color * a;
  }
}`

// ── Batched star program ────────────────────────────────────────────────────
const STAR_VERT = `
attribute vec3 a_pos;
attribute vec3 a_meta;  // sizePx, brightness, tint
uniform mat4 u_matrix;
uniform vec4 u_cam;     // planet-space camera xyz + occlusion-enabled flag
varying float v_b;
varying float v_t;
void main() {
  if (u_cam.w > 0.5) {
    vec3 d = a_pos - u_cam.xyz;
    float a = dot(d, d);
    float b = 2.0 * dot(u_cam.xyz, d);
    float c = dot(u_cam.xyz, u_cam.xyz) - 1.0;
    float disc = b * b - 4.0 * a * c;
    if (disc > 0.0) {
      float t = (-b - sqrt(disc)) / (2.0 * a);
      if (t > 0.0 && t < 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; v_b = 0.0; v_t = 0.0; return; }
    }
  }
  vec4 p = u_matrix * vec4(a_pos, 1.0);
  p.z = clamp(p.z, -abs(p.w) * 0.999, abs(p.w) * 0.999);
  gl_Position = p;
  gl_PointSize = a_meta.x;
  v_b = a_meta.y;
  v_t = a_meta.z;
}`

const STAR_FRAG = `
precision mediump float;
varying float v_b;
varying float v_t;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float r = length(pc) * 2.0;
  float a = (1.0 - smoothstep(0.4, 1.0, r)) * v_b;
  vec3 cool = vec3(0.78, 0.87, 1.0);
  vec3 warm = vec3(1.0, 0.82, 0.58);
  vec3 col = mix(cool, warm, v_t);
  gl_FragColor = vec4(col * a, a);
}`

// ── World-space quad program (aircraft lie in the ground plane) ─────────────
const QUAD_VERT = `
attribute vec3 a_pos;
attribute vec2 a_uv;
uniform mat4 u_matrix;
varying vec2 v_uv;
void main() {
  vec4 p = u_matrix * vec4(a_pos, 1.0);
  p.z = clamp(p.z, -abs(p.w) * 0.999, abs(p.w) * 0.999);
  gl_Position = p;
  v_uv = a_uv;
}`

const QUAD_FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec4 u_color;
varying vec2 v_uv;
void main() {
  float a = texture2D(u_tex, v_uv).a;
  gl_FragColor = u_color * a;
}`

// ── Flight-trail line program (world-space polyline at altitude) ───────────
const LINE_VERT = `
attribute vec3 a_pos;
attribute float a_t;
uniform mat4 u_matrix;
varying float v_t;
void main() {
  vec4 p = u_matrix * vec4(a_pos, 1.0);
  p.z = clamp(p.z, -abs(p.w) * 0.999, abs(p.w) * 0.999);
  gl_Position = p;
  v_t = a_t;
}`

const LINE_FRAG = `
precision mediump float;
uniform vec4 u_color;
varying float v_t;
void main() {
  // Fade the tail out: oldest (t=0) faint, newest (t=1) bright.
  gl_FragColor = vec4(u_color.rgb, u_color.a * (0.12 + 0.88 * v_t));
}`

interface ModelTransform {
  getMatrixForModel(location: [number, number], altitude?: number): ArrayLike<number>
  worldSize?: number
}

function compile(gl: WebGLRenderingContext | WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(vs, vertSrc)
  gl.compileShader(vs)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(fs, fragSrc)
  gl.compileShader(fs)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  return prog
}

export const SKY_LAYER_ID = 'sat-3d'

export interface SwarmState {
  /** [lon, lat, altKm] triplets from the propagation worker. */
  pos: Float32Array
  n: number
  rev: number
}

export interface PlaneTrail {
  /** [lon, lat, altM] triplets, oldest → newest (aircraft at the end). */
  pts: Float32Array
  n: number
}

export function createSat3DLayer(
  getSats: () => Sat3D[] | null,
  getCelestial?: () => CelestialState | null,
  getPlanes?: () => Plane3D[] | null,
  getSwarm?: () => SwarmState | null,
  getPlaneTrail?: () => PlaneTrail | null,
): CustomLayerInterface {
  let prog: WebGLProgram | null = null
  let starProg: WebGLProgram | null = null
  let buf: WebGLBuffer | null = null
  let starBuf: WebGLBuffer | null = null
  let starBufCount = 0
  let starBufRev = -1
  let starBufVariant = ''
  let starPosArr: Float32Array | null = null
  let swarmBuf: WebGLBuffer | null = null
  let swarmBufCount = 0
  let swarmBufRev = -1
  let swarmBufVariant = ''
  let swarmPosArr: Float32Array | null = null
  let aPos = 0
  let uPos: WebGLUniformLocation | null = null
  let uSize: WebGLUniformLocation | null = null
  let uColor: WebGLUniformLocation | null = null
  let uLight: WebGLUniformLocation | null = null
  let uMode: WebGLUniformLocation | null = null
  let planeTex: WebGLTexture | null = null
  let quadProg: WebGLProgram | null = null
  let quadBuf: WebGLBuffer | null = null
  let qPos = 0
  let qUv = 0
  let qMatrix: WebGLUniformLocation | null = null
  let qTex: WebGLUniformLocation | null = null
  let qColor: WebGLUniformLocation | null = null
  let lineProg: WebGLProgram | null = null
  let lineBuf: WebGLBuffer | null = null
  let lPos = 0
  let lT = 0
  let lMatrix: WebGLUniformLocation | null = null
  let lColor: WebGLUniformLocation | null = null
  let sPos = 0
  let sMeta = 0
  let sMatrix: WebGLUniformLocation | null = null
  let sCam: WebGLUniformLocation | null = null
  let mapRef: MLMap | null = null

  return {
    id: SKY_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      mapRef = map
      prog = compile(gl, POINT_VERT, POINT_FRAG)
      starProg = compile(gl, STAR_VERT, STAR_FRAG)
      if (prog) {
        aPos = gl.getAttribLocation(prog, 'a_pos')
        uPos = gl.getUniformLocation(prog, 'u_pos')
        uSize = gl.getUniformLocation(prog, 'u_size')
        uColor = gl.getUniformLocation(prog, 'u_color')
        uLight = gl.getUniformLocation(prog, 'u_light')
        uMode = gl.getUniformLocation(prog, 'u_mode')
        buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0]), gl.STATIC_DRAW)
      }
      if (starProg) {
        sPos = gl.getAttribLocation(starProg, 'a_pos')
        sMeta = gl.getAttribLocation(starProg, 'a_meta')
        sMatrix = gl.getUniformLocation(starProg, 'u_matrix')
        sCam = gl.getUniformLocation(starProg, 'u_cam')
        starBuf = gl.createBuffer()
        swarmBuf = gl.createBuffer()
      }
      quadProg = compile(gl, QUAD_VERT, QUAD_FRAG)
      if (quadProg) {
        qPos = gl.getAttribLocation(quadProg, 'a_pos')
        qUv = gl.getAttribLocation(quadProg, 'a_uv')
        qMatrix = gl.getUniformLocation(quadProg, 'u_matrix')
        qTex = gl.getUniformLocation(quadProg, 'u_tex')
        qColor = gl.getUniformLocation(quadProg, 'u_color')
        quadBuf = gl.createBuffer()
      }
      lineProg = compile(gl, LINE_VERT, LINE_FRAG)
      if (lineProg) {
        lPos = gl.getAttribLocation(lineProg, 'a_pos')
        lT = gl.getAttribLocation(lineProg, 'a_t')
        lMatrix = gl.getUniformLocation(lineProg, 'u_matrix')
        lColor = gl.getUniformLocation(lineProg, 'u_color')
        lineBuf = gl.createBuffer()
      }
    },

    onRemove(_map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      if (prog) gl.deleteProgram(prog)
      if (starProg) gl.deleteProgram(starProg)
      if (planeTex) gl.deleteTexture(planeTex)
      planeTex = null
      if (quadProg) gl.deleteProgram(quadProg)
      if (quadBuf) gl.deleteBuffer(quadBuf)
      quadProg = null
      quadBuf = null
      if (lineProg) gl.deleteProgram(lineProg)
      if (lineBuf) gl.deleteBuffer(lineBuf)
      lineProg = null
      lineBuf = null
      if (buf) gl.deleteBuffer(buf)
      if (starBuf) gl.deleteBuffer(starBuf)
      if (swarmBuf) gl.deleteBuffer(swarmBuf)
      swarmBuf = null
      swarmBufCount = 0
      swarmBufRev = -1
      swarmBufVariant = ''
      swarmPosArr = null
      prog = null
      starProg = null
      buf = null
      starBuf = null
      starBufCount = 0
      starBufRev = -1
      starBufVariant = ''
      starPosArr = null
      mapRef = null
    },

    render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!mapRef) return
      const sats = getSats()
      const cel = getCelestial?.() ?? null
      const planes = getPlanes?.() ?? null
      const swarm = getSwarm?.() ?? null
      const trail = getPlaneTrail?.() ?? null
      const anything = (sats && sats.length) || cel?.sun || cel?.moon || (cel?.starCount ?? 0) > 0 || (planes && planes.length) || (swarm && swarm.n > 0) || (trail && trail.n > 1)
      if (!anything) return
      const isGlobe = options.shaderData.variantName === 'globe'
      // Globe shader: mainMatrix projects unit-sphere planet space (pair
      // with getMatrixForModel). Mercator shader: the classic model-view-
      // projection consumes mercator 0..1 coords with conformal z — the
      // globe-path matrices mis-scale altitude there.
      const main = (isGlobe
        ? options.defaultProjectionData.mainMatrix
        : options.modelViewProjectionMatrix) as unknown as ArrayLike<number>
      const tr = (mapRef as unknown as { transform: ModelTransform }).transform
      if (typeof tr?.getMatrixForModel !== 'function') return

      // Where does (lon, lat, altitude m) live in the space mainMatrix
      // consumes? Globe shader: unit-sphere planet space via the model
      // matrix. Mercator shader: conformal mercator coords (the documented
      // custom-layer contract) — the model-matrix path misbehaves for
      // low altitudes there.
      const ws = tr.worldSize ?? 512 * Math.pow(2, mapRef.getZoom())
      const toWorld = (lon: number, lat: number, altM: number): V3 => {
        if (isGlobe) {
          const mm = tr.getMatrixForModel([lon, lat], altM)
          const w = mm[15] || 1
          return [mm[12] / w, mm[13] / w, mm[14] / w]
        }
        // The classic MVP consumes WORLD-PIXEL space: mercator 0..1 scaled
        // by worldSize, z conformal in the same unit.
        const mc = MercatorCoordinate.fromLngLat({ lng: lon, lat }, altM)
        return [mc.x * ws, mc.y * ws, (mc.z ?? 0) * ws]
      }

      // Camera position in planet space (globe shader projects a unit sphere).
      // M·cam = [0,0,c,0] for perspective M, so cam = q.xyz/q.w with
      // q = M⁻¹·[0,0,1,0] — sign of c cancels. Used to hide far-side bodies.
      let cam: V3 | null = null
      if (isGlobe) {
        const inv = inv4(main)
        if (inv) {
          const q = mulMV(inv, [0, 0, 1, 0])
          if (Math.abs(q[3]) > 1e-12) {
            const c: V3 = [q[0] / q[3], q[1] / q[3], q[2] / q[3]]
            if (c[0] * c[0] + c[1] * c[1] + c[2] * c[2] > 1.002) cam = c
          }
        }
      }

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const wCss = gl.drawingBufferWidth / dpr
      const hCss = gl.drawingBufferHeight / dpr

      /** Hidden behind the planet? Segment cam→P vs unit sphere. */
      const occluded = (P: V3): boolean => {
        if (!cam) return false
        const dx = P[0] - cam[0], dy = P[1] - cam[1], dz = P[2] - cam[2]
        const a = dx * dx + dy * dy + dz * dz
        const b = 2 * (cam[0] * dx + cam[1] * dy + cam[2] * dz)
        const cc = cam[0] * cam[0] + cam[1] * cam[1] + cam[2] * cam[2] - 1
        const disc = b * b - 4 * a * cc
        if (disc <= 0) return false
        const t = (-b - Math.sqrt(disc)) / (2 * a)
        return t > 0 && t < 1
      }

      /** Project planet-space point; writes screen cache; null if off/behind camera. */
      const project = (P: V3): { clip: V4; sx: number; sy: number } | null => {
        const clip = mulMV(main, [P[0], P[1], P[2], 1])
        if (clip[3] <= 0) return null
        const nx = clip[0] / clip[3]
        const ny = clip[1] / clip[3]
        if (nx < -1.35 || nx > 1.35 || ny < -1.35 || ny > 1.35) return null
        return { clip, sx: (nx * 0.5 + 0.5) * wCss, sy: (1 - (ny * 0.5 + 0.5)) * hCss }
      }

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied output
      gl.disable(gl.DEPTH_TEST) // occlusion handled geometrically above

      // ── Stars (one batched call, farthest first; globe view only) ─────────
      if (isGlobe && starProg && starBuf && cel?.stars && cel.starCount > 0) {
        gl.useProgram(starProg)
        gl.bindBuffer(gl.ARRAY_BUFFER, starBuf)
        const variantKey = options.shaderData.variantName
        if (cel.starsRev !== starBufRev || variantKey !== starBufVariant) {
          const n = cel.starCount
          if (!starPosArr || starPosArr.length !== n * 6) starPosArr = new Float32Array(n * 6)
          for (let i = 0; i < n; i++) {
            const r = i * 5
            const P = toWorld(cel.stars[r], cel.stars[r + 1], cel.starAltM)
            const o = i * 6
            starPosArr[o] = P[0]; starPosArr[o + 1] = P[1]; starPosArr[o + 2] = P[2]
            starPosArr[o + 3] = cel.stars[r + 2]
            starPosArr[o + 4] = cel.stars[r + 3]
            starPosArr[o + 5] = cel.stars[r + 4]
          }
          gl.bufferData(gl.ARRAY_BUFFER, starPosArr, gl.DYNAMIC_DRAW)
          starBufCount = n
          starBufRev = cel.starsRev
          starBufVariant = variantKey
        }
        if (starBufCount > 0) {
          gl.enableVertexAttribArray(sPos)
          gl.vertexAttribPointer(sPos, 3, gl.FLOAT, false, 24, 0)
          gl.enableVertexAttribArray(sMeta)
          gl.vertexAttribPointer(sMeta, 3, gl.FLOAT, false, 24, 12)
          gl.uniformMatrix4fv(sMatrix, false, Array.from(main))
          gl.uniform4f(sCam, cam?.[0] ?? 0, cam?.[1] ?? 0, cam?.[2] ?? 0, cam ? 1 : 0)
          gl.drawArrays(gl.POINTS, 0, starBufCount)
          gl.disableVertexAttribArray(sMeta)
        }
      }

      // ── Full swarm (~11,500 ambient specks, one batched call) ─────────────
      if (starProg && swarmBuf && swarm && swarm.n > 0) {
        gl.useProgram(starProg)
        gl.bindBuffer(gl.ARRAY_BUFFER, swarmBuf)
        const variantKey = options.shaderData.variantName
        if (swarm.rev !== swarmBufRev || variantKey !== swarmBufVariant) {
          const n = swarm.n
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
          if (!swarmPosArr || swarmPosArr.length !== n * 6) swarmPosArr = new Float32Array(n * 6)
          for (let i = 0; i < n; i++) {
            const altKm = swarm.pos[i * 3 + 2]
            const P = toWorld(swarm.pos[i * 3], swarm.pos[i * 3 + 1], altKm * 1000)
            const o = i * 6
            swarmPosArr[o] = P[0]; swarmPosArr[o + 1] = P[1]; swarmPosArr[o + 2] = P[2]
            swarmPosArr[o + 3] = (altKm > 10000 ? 2.2 : altKm > 1500 ? 1.7 : 1.3) * dpr
            swarmPosArr[o + 4] = 0.55
            swarmPosArr[o + 5] = 0.12
          }
          gl.bufferData(gl.ARRAY_BUFFER, swarmPosArr, gl.DYNAMIC_DRAW)
          swarmBufCount = n
          swarmBufRev = swarm.rev
          swarmBufVariant = variantKey
        }
        if (swarmBufCount > 0) {
          gl.enableVertexAttribArray(sPos)
          gl.vertexAttribPointer(sPos, 3, gl.FLOAT, false, 24, 0)
          gl.enableVertexAttribArray(sMeta)
          gl.vertexAttribPointer(sMeta, 3, gl.FLOAT, false, 24, 12)
          gl.uniformMatrix4fv(sMatrix, false, Array.from(main))
          gl.uniform4f(sCam, cam?.[0] ?? 0, cam?.[1] ?? 0, cam?.[2] ?? 0, cam ? 1 : 0)
          gl.drawArrays(gl.POINTS, 0, swarmBufCount)
          gl.disableVertexAttribArray(sMeta)
        }
      }

      if (!prog || !buf) return
      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      if (aPos >= 0) {
        gl.enableVertexAttribArray(aPos)
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
      }
      gl.uniform3f(uLight, 0, 0, 1)

      /** Pixel diameter for a body of angular radius `ang` under the current fov. */
      const angPx = (ang: number): number => (2 * ang / options.fov) * hCss

      const drawPoint = (clip: V4, sizePx: number, mode: number, r: number, g: number, b: number, alpha: number) => {
        gl.uniform4f(uPos, clip[0], clip[1], clip[2], clip[3])
        gl.uniform1f(uSize, sizePx * dpr)
        gl.uniform1f(uMode, mode)
        gl.uniform4f(uColor, r * alpha, g * alpha, b * alpha, alpha)
        gl.drawArrays(gl.POINTS, 0, 1)
      }

      // ── Sun ───────────────────────────────────────────────────────────────
      let sunScreen: { sx: number; sy: number } | null = null
      let sunW: V3 | null = null
      let moonW: V3 | null = null
      if (cel?.sun && isGlobe) {
        const s = cel.sun
        sunW = toWorld(s.lon, s.lat, s.altM)
        const p = project(sunW)
        if (p) sunScreen = { sx: p.sx, sy: p.sy }
        if (p && !occluded(sunW)) {
          s.sx = p.sx; s.sy = p.sy; s.visible = true
          const core = Math.max(7, angPx(s.angRad))
          drawPoint(p.clip, core * 5.2, 0, 1.0, 0.85, 0.55, 0.10)
          drawPoint(p.clip, core * 2.4, 0, 1.0, 0.88, 0.6, 0.28)
          drawPoint(p.clip, core, 1, 1.0, 0.97, 0.88, 1)
        } else { s.visible = false }
      } else if (cel?.sun) { cel.sun.visible = false }

      // ── Moon (phase-shaded sphere) ────────────────────────────────────────
      if (cel?.moon && isGlobe) {
        const mo = cel.moon
        moonW = toWorld(mo.lon, mo.lat, mo.altM)
        const p = project(moonW)
        if (p && !occluded(moonW)) {
          mo.sx = p.sx; mo.sy = p.sy; mo.visible = true
          // Sun direction in sprite space: xy toward the sun on screen
          // (y down, matching gl_PointCoord), z toward the viewer by
          // -cos(elongation) — full moon lit from the front, new from behind.
          let lx = 0, ly = 0, lz = 1
          if (sunW && moonW) {
            // Elongation from the geocentric DIRECTIONS (unit vectors from
            // the sub-points) — projection-space positions would distort it.
            const sd = dirFromLL(cel.sun!.lon, cel.sun!.lat)
            const md = dirFromLL(mo.lon, mo.lat)
            const cosE = sd[0] * md[0] + sd[1] * md[1] + sd[2] * md[2]
            const sinE = Math.sqrt(Math.max(0, 1 - cosE * cosE))
            let dx = 0, dy = -1
            if (sunScreen) {
              const ddx = sunScreen.sx - p.sx
              const ddy = sunScreen.sy - p.sy
              const dl = Math.hypot(ddx, ddy)
              if (dl > 1e-6) { dx = ddx / dl; dy = ddy / dl }
            }
            lx = dx * sinE; ly = dy * sinE; lz = -cosE
          }
          gl.uniform3f(uLight, lx, ly, lz)
          const core = Math.max(6, angPx(mo.angRad))
          drawPoint(p.clip, core, 2, 0.86, 0.87, 0.9, 1)
          gl.uniform3f(uLight, 0, 0, 1)
        } else { mo.visible = false }
      } else if (cel?.moon) { cel.moon.visible = false }

      // ── Selected aircraft's flight trail (3D polyline at true altitude) ──
      // Foreshortens with pitch; fades from a faint tail to a bright head at
      // the aircraft. Drawn before the planes so the silhouette sits on top.
      if (lineProg && lineBuf && trail && trail.n > 1) {
        const n = trail.n
        const arr = new Float32Array(n * 4)
        for (let i = 0; i < n; i++) {
          const P = toWorld(trail.pts[i * 3], trail.pts[i * 3 + 1], trail.pts[i * 3 + 2])
          arr[i * 4] = P[0]; arr[i * 4 + 1] = P[1]; arr[i * 4 + 2] = P[2]
          arr[i * 4 + 3] = i / (n - 1)
        }
        gl.useProgram(lineProg)
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf)
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(lPos)
        gl.vertexAttribPointer(lPos, 3, gl.FLOAT, false, 16, 0)
        gl.enableVertexAttribArray(lT)
        gl.vertexAttribPointer(lT, 1, gl.FLOAT, false, 16, 12)
        gl.uniformMatrix4fv(lMatrix, false, Array.from(main))
        gl.uniform4f(lColor, PLANE_COLOR[0], PLANE_COLOR[1], PLANE_COLOR[2], 0.85)
        try { gl.lineWidth(2) } catch { /* clamped to 1 on many GPUs */ }
        gl.drawArrays(gl.LINE_STRIP, 0, n)
        gl.disableVertexAttribArray(lT)
        // Restore point-program vertex state for the passes below.
        gl.useProgram(prog!)
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        if (aPos >= 0) {
          gl.enableVertexAttribArray(aPos)
          gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
        }
      }

      // ── Aircraft (real silhouettes at real proportions) ──────────────────
      if (planes && planes.length) {
        if (!planeTex && typeof document !== 'undefined') {
          try {
            const atlas = buildPlaneAtlas()
            planeTex = gl.createTexture()
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, planeTex)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          } catch { planeTex = null }
        }
        const zoom = mapRef.getZoom()
        // Zoomed in tight, the camera sits BELOW cruise altitude and jets
        // would vanish behind it — clamp render altitude under the camera so
        // traffic stays visible (parallax still reads at every zoom).
        const ctrLat = mapRef.getCenter().lat * Math.PI / 180
        const camAltM = (156543.03 * Math.cos(ctrLat) / Math.pow(2, zoom)) * hCss / (2 * Math.tan(options.fov / 2))
        const altCapM = Math.max(300, camAltM * 0.62)

        // FlightRadar24-style zoom handling. The pixel floor that keeps a
        // distant Cessna visible at z10 turns 1,200 aircraft into a solid
        // carpet at continental zoom, so: (a) the floor shrinks as you zoom
        // out (full size by z8, 30% at planet zoom), and (b) below z7.5
        // overlapping traffic is thinned to ONE aircraft per screen cell —
        // highest altitude wins, so cruise jets outrank the GA swarm, same
        // priority FR24 uses. Glow halos only render close-in; at far zoom
        // they just wash the cluster yellow.
        const floorScale = Math.min(1, Math.max(0.3, (zoom - 3) / 5))
        const declutter = zoom < 7.5
        const glowOn = zoom >= 6
        const CELL_PX = 26
        const cellBest = new Map<number, { pl: Plane3D; clip: V4; spanPx: number }>()

        // Pass 1: project + declutter, then soft glows (point program bound).
        const glowables: { pl: Plane3D; clip: V4; spanPx: number }[] = []
        for (const pl of planes) {
          const P = toWorld(pl.lon, pl.lat, Math.min(pl.altFt * 0.3048, altCapM))
          if (occluded(P)) { pl.visible = false; continue }
          const p = project(P)
          if (!p) { pl.visible = false; continue }
          pl.sx = p.sx; pl.sy = p.sy; pl.visible = true
          const mpp = 156543.03 * Math.cos(pl.lat * Math.PI / 180) / Math.pow(2, zoom)
          const spanPx = Math.min(58, Math.max(PLANE_FLOOR_PX[pl.shape] * floorScale, pl.spanM / mpp))
          if (declutter) {
            const key = (Math.round(pl.sx / CELL_PX) + 4096) * 8192 + (Math.round(pl.sy / CELL_PX) + 4096)
            const prev = cellBest.get(key)
            if (prev) {
              if (prev.pl.altFt >= pl.altFt) { pl.visible = false; continue }
              prev.pl.visible = false
            }
            cellBest.set(key, { pl, clip: p.clip, spanPx })
          } else {
            glowables.push({ pl, clip: p.clip, spanPx })
          }
        }
        if (declutter) cellBest.forEach((g) => glowables.push(g))
        if (glowOn) for (const g of glowables) drawPoint(g.clip, g.spanPx * 1.5, 0, GLOW[0], GLOW[1], GLOW[2], 0.13)

        // Pass 2: silhouettes as WORLD-SPACE quads lying in the ground plane
        // (nose along track) — they foreshorten with the map's pitch like the
        // terrain does, instead of standing up billboard-style. Banking rolls
        // the quad around its longitudinal axis into the turn.
        //
        // Depth cue (Brian, Aug 12 — "slightly 3d as you pan around"): every
        // aircraft casts a soft silhouette SHADOW on the ground directly
        // below it. Plane at altitude + shadow at the surface = parallax
        // while panning/pitching, which is what makes them read airborne.
        // Colors are per class — jets amber, wides deep orange, bizjets sky,
        // props teal, helos violet — matching the app palette.
        if (quadProg && quadBuf && glowables.length) {
          const mppCam = 156543.03 * Math.cos(ctrLat) / Math.pow(2, zoom)
          // Close enough that the altitude offset is >~ a few px — shadows at
          // continental zoom are subpixel noise, skip the extra draw.
          const shadowsOn = zoom >= 7.5
          // Emit one quad for plane `pl` at altitude altM (span × mul) into arr.
          const emit = (arr: number[], pl: Plane3D, altM: number, mul: number) => {
            const latR = pl.lat * Math.PI / 180
            const lonR = pl.lon * Math.PI / 180
            const spanMr = Math.max(pl.spanM, PLANE_FLOOR_PX[pl.shape] * floorScale * mppCam) * mul
            const half = (spanMr / SHAPE_SPAN_FRAC) / 2
            const theta = (pl.track ?? 0) * Math.PI / 180
            const bank = pl.bankRad
            let C: V3, fwd: V3, right: V3, up: V3, scale: number
            if (isGlobe) {
              // Planet space: x = cosφ·sinλ, y = sinφ, z = cosφ·cosλ.
              C = toWorld(pl.lon, pl.lat, altM)
              up = [Math.cos(latR) * Math.sin(lonR), Math.sin(latR), Math.cos(latR) * Math.cos(lonR)]
              const east: V3 = [Math.cos(lonR), 0, -Math.sin(lonR)]
              const north: V3 = [
                up[1] * east[2] - up[2] * east[1],
                up[2] * east[0] - up[0] * east[2],
                up[0] * east[1] - up[1] * east[0],
              ]
              fwd = [
                north[0] * Math.cos(theta) + east[0] * Math.sin(theta),
                north[1] * Math.cos(theta) + east[1] * Math.sin(theta),
                north[2] * Math.cos(theta) + east[2] * Math.sin(theta),
              ]
              right = [
                east[0] * Math.cos(theta) - north[0] * Math.sin(theta),
                east[1] * Math.cos(theta) - north[1] * Math.sin(theta),
                east[2] * Math.cos(theta) - north[2] * Math.sin(theta),
              ]
              scale = half / 6371008.8
            } else {
              // Mercator world px: north = −y, east = +x, up = +z.
              C = toWorld(pl.lon, pl.lat, altM)
              up = [0, 0, 1]
              fwd = [Math.sin(theta), -Math.cos(theta), 0]
              right = [Math.cos(theta), Math.sin(theta), 0]
              const mppHere = 156543.03 * Math.cos(latR) / Math.pow(2, zoom)
              scale = half / mppHere
            }
            if (bank) {
              const cb = Math.cos(bank), sb = Math.sin(bank)
              right = [
                right[0] * cb - up[0] * sb,
                right[1] * cb - up[1] * sb,
                right[2] * cb - up[2] * sb,
              ]
            }
            const F: V3 = [fwd[0] * scale, fwd[1] * scale, fwd[2] * scale]
            const R: V3 = [right[0] * scale, right[1] * scale, right[2] * scale]
            const cellU0 = PLANE_CLASS_INDEX[pl.shape] / ATLAS_CELLS
            const cellU1 = cellU0 + 1 / ATLAS_CELLS
            // Corners: nose (v=0) at +F; atlas u grows to the RIGHT.
            const corner = (sf: number, sr: number): V3 => [
              C[0] + F[0] * sf + R[0] * sr,
              C[1] + F[1] * sf + R[1] * sr,
              C[2] + F[2] * sf + R[2] * sr,
            ]
            const nl = corner(1, -1), nr = corner(1, 1), tl = corner(-1, -1), tr = corner(-1, 1)
            const put = (v: V3, u: number, w: number) => { arr.push(v[0], v[1], v[2], u, w) }
            put(nl, cellU0, 0); put(nr, cellU1, 0); put(tl, cellU0, 1)
            put(nr, cellU1, 0); put(tr, cellU1, 1); put(tl, cellU0, 1)
          }

          const shadowV: number[] = []
          const classV: Record<PlaneClass, number[]> = { prop: [], biz: [], narrow: [], wide: [], heli: [] }
          for (const { pl } of glowables) {
            const altM = Math.min(pl.altFt * 0.3048, altCapM)
            if (shadowsOn) emit(shadowV, pl, 0, 0.92)
            emit(classV[pl.shape], pl, altM, 1)
          }

          gl.useProgram(quadProg)
          gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
          gl.enableVertexAttribArray(qPos)
          gl.enableVertexAttribArray(qUv)
          gl.uniformMatrix4fv(qMatrix, false, Array.from(main))
          gl.activeTexture(gl.TEXTURE0)
          if (planeTex) gl.bindTexture(gl.TEXTURE_2D, planeTex)
          gl.uniform1i(qTex, 0)
          const drawBatch = (arr: number[], c: [number, number, number], a: number) => {
            if (!arr.length) return
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW)
            gl.vertexAttribPointer(qPos, 3, gl.FLOAT, false, 20, 0)
            gl.vertexAttribPointer(qUv, 2, gl.FLOAT, false, 20, 12)
            gl.uniform4f(qColor, c[0], c[1], c[2], a)
            gl.drawArrays(gl.TRIANGLES, 0, arr.length / 5)
          }
          drawBatch(shadowV, [0, 0, 0], 0.28) // ground shadows first, under everything
          ;(Object.keys(classV) as PlaneClass[]).forEach((cls) => drawBatch(classV[cls], PLANE_CLASS_COLOR[cls], 1))
          gl.disableVertexAttribArray(qUv)
          // Restore the point program state for the satellite pass below.
          gl.useProgram(prog)
          gl.bindBuffer(gl.ARRAY_BUFFER, buf)
          if (aPos >= 0) {
            gl.enableVertexAttribArray(aPos)
            gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
          }
        }
      }

      // ── Satellites ────────────────────────────────────────────────────────
      if (sats && sats.length) {
        for (const s of sats) {
          const P = toWorld(s.lon, s.lat, s.altKm * 1000)
          if (occluded(P)) { s.visible = false; continue }
          const p = project(P)
          if (!p) { s.visible = false; continue }
          s.sx = p.sx; s.sy = p.sy; s.visible = true
          drawPoint(p.clip, sizeFor(s.altKm, GLOW_SIZE), 0, GLOW[0], GLOW[1], GLOW[2], 0.32)
          const c = CORE_COLORS[s.group] ?? CORE_DEFAULT
          drawPoint(p.clip, sizeFor(s.altKm, CORE_SIZE), 0, c[0], c[1], c[2], 1)
        }
      }
    },
  }
}

/** Nearest visible pickable within `radiusPx` of a screen point, or null. */
export function pickSat<T extends { sx: number; sy: number; visible: boolean }>(
  items: T[] | null | undefined,
  x: number,
  y: number,
  radiusPx = 16,
): T | null {
  if (!items) return null
  let best: T | null = null
  let bd = radiusPx
  for (const s of items) {
    if (!s.visible) continue
    const d = Math.hypot(s.sx - x, s.sy - y)
    if (d < bd) { bd = d; best = s }
  }
  return best
}
