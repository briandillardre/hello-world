/**
 * Writes a synthetic civil grading sheet as a REAL PDF (no libraries) with a
 * known answer — the fixture for scripts/plan-read-test.mjs.
 *
 * It is drawn the way Civil 3D / AutoCAD exports look in the wild:
 *  - CAD layers as optional content (V-TOPO-MAJR/MINR existing, C-TOPO-MAJR/
 *    MINR proposed, C-BLDG, C-ANNO-SPOT, G-ANNO-TTLB, C-LEGEND)
 *  - existing contours dashed + grey; the MINOR ones exploded into one path
 *    per dash (some exporters do that)
 *  - proposed contours solid; majors heavier
 *  - index-contour labels cut into gaps along the line: proposed as real
 *    rotated text, existing as "AutoCAD SHX Text" Square annotations
 *  - spot grades: an x marker + "FG 812.45" text; "GS" shots as two SHX notes
 *  - a building outline with "FFE = 811.50" inside; proposed contours stop at its walls
 *  - a legend with sample contour lines + labels OUTSIDE the site
 *
 * The page's drawing units are points; the site is drawn at 1" = 30'
 * (2.4 pt per ft). `exist(xFt, yFt)` and `prop(xFt, yFt)` are the truth.
 */

export const PT_PER_FT = 72 / 30
export const SITE = { x0: 150, y0: 150, wFt: 420, hFt: 300 } // page origin of the site + its size in feet

export function exist(x, y) {
  return 800 + 0.035 * x + 0.02 * y + 5 * Math.sin(x / 85) * Math.cos(y / 60)
}

const LIM = { cx: 210, cy: 150, rx: 150, ry: 105 } // grading limits (ellipse, feet)
function w(x, y) {
  const d = Math.hypot((x - LIM.cx) / LIM.rx, (y - LIM.cy) / LIM.ry)
  if (d >= 1) return 0
  if (d <= 0.6) return 1
  const t = (1 - d) / 0.4
  return t * t * (3 - 2 * t)
}
export function prop(x, y) {
  const pad = 811 + 0.012 * (x - LIM.cx) - 0.008 * (y - LIM.cy)
  const k = w(x, y)
  return exist(x, y) * (1 - k) + pad * k
}
export const BUILDING = { x0: 175, y0: 125, x1: 245, y1: 175, ffe: 811.5 } // feet — the floor 6" over the graded pad

const toPage = (xFt, yFt) => [SITE.x0 + xFt * PT_PER_FT, SITE.y0 + yFt * PT_PER_FT]

/** Marching squares at `levels` over the site; returns { level, pts(page) }[] chained. */
function contoursOf(f, levels, chainLines, stepFt = 2.5) {
  const nx = Math.round(SITE.wFt / stepFt), ny = Math.round(SITE.hFt / stepFt)
  const v = new Float64Array((nx + 1) * (ny + 1))
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v[j * (nx + 1) + i] = f(i * stepFt, j * stepFt)
  const out = []
  for (const L of levels) {
    const segs = []
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = v[j * (nx + 1) + i], b = v[j * (nx + 1) + i + 1], c = v[(j + 1) * (nx + 1) + i + 1], d = v[(j + 1) * (nx + 1) + i]
      const pts = []
      const edge = (za, zb, xa, ya, xb, yb) => {
        if ((za < L) === (zb < L)) return
        const t = (L - za) / (zb - za)
        pts.push(...toPage((xa + (xb - xa) * t) * stepFt, (ya + (yb - ya) * t) * stepFt))
      }
      edge(a, b, i, j, i + 1, j); edge(b, c, i + 1, j, i + 1, j + 1); edge(c, d, i + 1, j + 1, i, j + 1); edge(d, a, i, j + 1, i, j)
      if (pts.length === 4) segs.push(pts)
      else if (pts.length === 8) { segs.push(pts.slice(0, 4)); segs.push(pts.slice(4, 8)) }
    }
    for (const c of chainLines(segs, 0.01, [], 1e-6)) if (c.pts.length >= 6) out.push({ level: L, pts: c.pts, closed: c.closed })
  }
  return out
}

const lenOf = (p) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s }

/** The point (and direction) at arc length s along a polyline. */
function pointAt(pts, s) {
  let acc = 0
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1]
    const sl = Math.hypot(bx - ax, by - ay)
    if (sl > 0 && acc + sl >= s) { const u = (s - acc) / sl; return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, dx: (bx - ax) / sl, dy: (by - ay) / sl } }
    acc += sl
  }
  const n = pts.length
  const sl = Math.hypot(pts[n - 2] - pts[n - 4], pts[n - 1] - pts[n - 3]) || 1
  return { x: pts[n - 2], y: pts[n - 1], dx: (pts[n - 2] - pts[n - 4]) / sl, dy: (pts[n - 1] - pts[n - 3]) / sl }
}

let labelCount = 0
/**
 * Split a polyline at arc positions (gaps of `gap` pt centred there); returns
 * pieces + label anchors. Every third label sits 2 pt off the gap's middle —
 * CAD labels are not always centred.
 */
function cutGaps(pts, at, gap) {
  const pieces = []
  const anchors = []
  let cur = [pts[0], pts[1]]
  let acc = 0
  let gi = 0
  const cuts = at.map(s => [s - gap / 2, s + gap / 2])
  let inGap = false
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1]
    const sl = Math.hypot(bx - ax, by - ay)
    let s0 = acc
    while (gi < cuts.length && s0 + sl >= (inGap ? cuts[gi][1] : cuts[gi][0])) {
      const target = inGap ? cuts[gi][1] : cuts[gi][0]
      const u = (target - acc) / sl
      const px = ax + (bx - ax) * u, py = ay + (by - ay) * u
      if (!inGap) {
        cur.push(px, py)
        if (cur.length >= 4) pieces.push(cur)
        anchors.push(pointAt(pts, (cuts[gi][0] + cuts[gi][1]) / 2 + (labelCount++ % 3 === 2 ? 2 : 0)))
        cur = []
        inGap = true
      } else {
        cur = [px, py]
        inGap = false
        gi++
      }
      s0 = target
    }
    if (!inGap) cur.push(bx, by)
    acc += sl
  }
  if (!inGap && cur.length >= 4) pieces.push(cur)
  return { pieces, anchors }
}

const f2 = (v) => (Math.round(v * 100) / 100).toString()
const esc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m)

/**
 * Build the PDF. Options: rotate (page /Rotate), explodeMinor (dashes as
 * separate paths). Returns { bytes, truth } where truth lists what a perfect
 * reader returns.
 */
export function buildPlanPdf(chainLines, opts = {}) {
  labelCount = 0
  const rotate = opts.rotate ?? 0
  const explodeMinor = opts.explodeMinor ?? true
  const W = 1728, H = 1296 // 24" × 18"
  const layers = ['V-TOPO-MAJR', 'V-TOPO-MINR', 'C-TOPO-MAJR', 'C-TOPO-MINR', 'C-BLDG', 'C-ANNO-SPOT', 'G-ANNO-TTLB', 'C-LEGEND', 'C-GRAD-LIMT', 'C-CURB', 'C-STRM']
  const content = []
  const annots = [] // { rect, contents }
  const say = (s) => content.push(s)
  const layer = (name, body) => { say(`/OC /oc${layers.indexOf(name)} BDC`); body(); say('EMC') }
  const poly = (p) => { say(`${f2(p[0])} ${f2(p[1])} m`); for (let i = 2; i < p.length; i += 2) say(`${f2(p[i])} ${f2(p[i + 1])} l`); say('S') }
  const text = (s, x, y, size, ang) => {
    // Readable: never upside down.
    let a = ang
    if (a > Math.PI / 2) a -= Math.PI
    if (a < -Math.PI / 2) a += Math.PI
    const c = Math.cos(a), sn = Math.sin(a)
    const len = s.length * size * 0.556
    const bx = x - c * len / 2 + sn * size * 0.35, by = y - sn * len / 2 - c * size * 0.35
    say(`BT /F1 ${size} Tf ${f2(c)} ${f2(sn)} ${f2(-sn)} ${f2(c)} ${f2(bx)} ${f2(by)} Tm (${esc(s)}) Tj ET`)
  }
  const shx = (s, x, y, size, ang) => {
    const len = s.length * size * 0.6
    const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang))
    const hw = (len * c + size * sn) / 2, hh = (len * sn + size * c) / 2
    annots.push({ rect: [x - hw, y - hh, x + hw, y + hh], contents: s })
  }

  const eLevels = [], pLevels = []
  for (let z = 795; z <= 830; z++) { eLevels.push(z); pLevels.push(z) }
  const ex = contoursOf(exist, eLevels, chainLines)
  // Proposed contours only where the grading changes things (inside the limits).
  const prAll = contoursOf(prop, pLevels, chainLines)
  // Each run is carried out to the first point past the limit (w = 0, where
  // proposed IS existing), so it ends on the existing contour of its level —
  // the tie-in, the way a grading plan draws it.
  const wAt = (x, y) => w((x - SITE.x0) / PT_PER_FT, (y - SITE.y0) / PT_PER_FT)
  const pr = []
  for (const c of prAll) {
    const n = c.pts.length / 2
    const ins = []
    for (let k = 0; k < n; k++) ins.push(wAt(c.pts[2 * k], c.pts[2 * k + 1]) > 0.02)
    if (ins.every(Boolean)) { pr.push({ level: c.level, pts: c.pts, closed: c.closed }); continue }
    for (let k = 0; k < n; k++) {
      if (!ins[k] || (k > 0 && ins[k - 1])) continue
      let a = k, b = k
      while (b + 1 < n && ins[b + 1]) b++
      while (a > 0 && wAt(c.pts[2 * a], c.pts[2 * a + 1]) > 0) a--
      while (b + 1 < n && wAt(c.pts[2 * b], c.pts[2 * b + 1]) > 0) b++
      if (b - a >= 2) pr.push({ level: c.level, pts: c.pts.slice(2 * a, 2 * b + 2), closed: false })
      k = b
    }
  }
  // Grading plans don't draw contours through a building: they stop at its walls.
  const inBldg = (x, y) => { const [a, b] = toFt(x, y); return a > BUILDING.x0 && a < BUILDING.x1 && b > BUILDING.y0 && b < BUILDING.y1 }
  for (let i = pr.length - 1; i >= 0; i--) {
    const c = pr[i]
    const runs = []
    let cur = []
    for (let k = 0; k < c.pts.length; k += 2) {
      if (inBldg(c.pts[k], c.pts[k + 1])) { if (cur.length >= 6) runs.push(cur); cur = [] } else cur.push(c.pts[k], c.pts[k + 1])
    }
    if (cur.length >= 6) runs.push(cur)
    if (runs.length === 1 && runs[0].length === c.pts.length) continue
    pr.splice(i, 1, ...runs.map(r => ({ level: c.level, pts: r, closed: false })))
  }

  const SIZE = 6
  const truth = { exist: [], prop: [] }
  // Existing: dashed grey. Majors with SHX labels in gaps, minors exploded.
  say('q 0.6 0.6 0.6 RG')
  for (const c of ex) {
    const major = c.level % 5 === 0
    const L = lenOf(c.pts)
    if (major) {
      layer('V-TOPO-MAJR', () => {
        say('0.9 w [9 4.5] 0 d')
        const at = L > 260 ? [L / 3, (2 * L) / 3] : L > 120 ? [L / 2] : []
        const { pieces, anchors } = cutGaps(c.pts, at, 3 * SIZE * 0.6 + 4)
        for (const p of pieces) poly(p)
        for (const a of anchors) {
          if (opts.parenLabels) { say('Q q 0.6 0.6 0.6 rg'); text(`(${c.level})`, a.x, a.y, SIZE, Math.atan2(a.dy, a.dx)); say('Q q 0.6 0.6 0.6 RG 0.9 w [9 4.5] 0 d') }
          else shx(String(c.level), a.x, a.y, SIZE, Math.atan2(a.dy, a.dx))
        }
      })
    } else {
      layer('V-TOPO-MINR', () => {
        say('0.35 w')
        if (!explodeMinor) { say('[6 3] 0 d'); poly(c.pts); return }
        say('[] 0 d')
        // one path per dash
        let acc = 0, on = true, next = 6, cur = [c.pts[0], c.pts[1]]
        for (let i = 2; i < c.pts.length; i += 2) {
          const ax = c.pts[i - 2], ay = c.pts[i - 1], bx = c.pts[i], by = c.pts[i + 1]
          const sl = Math.hypot(bx - ax, by - ay)
          let s0 = acc
          while (s0 + 1e-9 < acc + sl && acc + sl >= next) {
            const u = (next - acc) / sl
            const px = ax + (bx - ax) * u, py = ay + (by - ay) * u
            if (on) { cur.push(px, py); if (cur.length >= 4) poly(cur); cur = [] } else cur = [px, py]
            on = !on
            s0 = next
            next += on ? 6 : 3
          }
          if (on) cur.push(bx, by)
          acc += sl
        }
        if (on && cur.length >= 4) poly(cur)
      })
    }
    truth.exist.push(c.level)
  }
  say('Q')
  // Proposed: solid black, majors heavy with real-text labels in gaps.
  say('q 0 0 0 RG [] 0 d')
  for (const c of pr) {
    const major = c.level % 5 === 0
    const L = lenOf(c.pts)
    layer(major ? 'C-TOPO-MAJR' : 'C-TOPO-MINR', () => {
      say(major ? '1.2 w' : '0.5 w')
      if (major) {
        const at = L > 220 ? [L / 3, (2 * L) / 3] : L > 90 ? [L / 2] : []
        const { pieces, anchors } = cutGaps(c.pts, at, 3 * SIZE * 0.556 + 4)
        for (const p of pieces) poly(p)
        for (const a of anchors) {
          // A white mask box behind the words, on the contour's own layer (AutoCAD wipeouts export so).
          const an = Math.atan2(a.dy, a.dx), hw = 3 * SIZE * 0.556 / 2 + 1, hh = SIZE * 0.6
          const cc = Math.cos(an), ss = Math.sin(an)
          const corner = (u, v) => [a.x + cc * u - ss * v, a.y + ss * u + cc * v]
          say('q 1 1 1 RG 0.5 w'); poly([...corner(-hw, -hh), ...corner(hw, -hh), ...corner(hw, hh), ...corner(-hw, hh), ...corner(-hw, -hh)]); say('Q')
          text(String(c.level), a.x, a.y, SIZE, an)
        }
      } else poly(c.pts)
    })
    truth.prop.push(c.level)
  }
  say('Q')
  // Building + FFE.
  const [bx0, by0] = toPage(BUILDING.x0, BUILDING.y0), [bx1, by1] = toPage(BUILDING.x1, BUILDING.y1)
  layer('C-BLDG', () => { say('q 0 0 0 RG 1.4 w'); say(`${f2(bx0)} ${f2(by0)} ${f2(bx1 - bx0)} ${f2(by1 - by0)} re S Q`) })
  say('q 0 0 0 rg')
  text(`FFE = ${BUILDING.ffe.toFixed(2)}`, (bx0 + bx1) / 2, (by0 + by1) / 2, 8, 0)
  say('Q')
  // Spot grades: x marker + label; GS shots as two SHX notes.
  const spots = [
    { xFt: 120, yFt: 95, tag: 'FG', role: 'fg' }, { xFt: 300, yFt: 210, tag: 'FG', role: 'fg' },
    { xFt: 150, yFt: 230, tag: 'TC', role: 'skip' }, { xFt: 330, yFt: 60, tag: 'GS', role: 'eg', pt: 812 }, { xFt: 60, yFt: 260, tag: 'GS', role: 'eg', pt: 805 },
    { xFt: 385, yFt: 160, tag: 'GS', role: 'eg', pt: 818 },
  ]
  truth.spots = []
  layer('C-ANNO-SPOT', () => {
    say('q 0 0 0 RG 0.5 w')
    for (const s of spots) {
      const z = (s.role === 'eg' ? exist(s.xFt, s.yFt) : prop(s.xFt, s.yFt)) + (s.tag === 'TC' ? 0.5 : 0)
      const zz = Math.round(z * 100) / 100
      const [px, py] = toPage(s.xFt, s.yFt)
      say(`${f2(px - 2)} ${f2(py - 2)} m ${f2(px + 2)} ${f2(py + 2)} l S ${f2(px - 2)} ${f2(py + 2)} m ${f2(px + 2)} ${f2(py - 2)} l S`)
      if (s.tag === 'GS') {
        // A survey shot: point number, elevation and code side by side. The point number is a
        // whole number that could pass for a contour label.
        shx(String(s.pt), px + 14, py + 12, 5, 0); shx(zz.toFixed(2), px + 14, py + 5, 5, 0); shx('GS', px + 14, py - 2, 5, 0)
      }
      else { say('Q q 0 0 0 rg'); text(`${s.tag} ${zz.toFixed(2)}`, px + 22, py + 4, 5, 0); say('Q q 0 0 0 RG 0.5 w') }
      truth.spots.push({ x: px, y: py, z: zz, role: s.role, tag: s.tag })
    }
    say('Q')
  })
  // Limit of grading: the ellipse, closed, dash-dot on its own layer.
  layer('C-GRAD-LIMT', () => {
    say('q 0 0 0 RG 1 w [12 3 2 3] 0 d')
    const ring = []
    for (let k = 0; k < 96; k++) { const a = (k / 96) * 2 * Math.PI; ring.push(...toPage(LIM.cx + LIM.rx * Math.cos(a), LIM.cy + LIM.ry * Math.sin(a))) }
    say(`${f2(ring[0])} ${f2(ring[1])} m`); for (let i = 2; i < ring.length; i += 2) say(`${f2(ring[i])} ${f2(ring[i + 1])} l`); say('h S Q')
  })
  // Distractors a real sheet has inside the site: a curb line (long, solid,
  // black, gently curved — like a contour), a storm pipe with its size, and a
  // station label that lands right on an existing minor contour.
  layer('C-CURB', () => {
    say('q 0 0 0 RG 0.5 w')
    const curb = []
    for (let k = 0; k <= 40; k++) { const t = k / 40; curb.push(...toPage(260 + 100 * t, 40 + 30 * Math.sin(t * 2.2))) }
    poly(curb)
    say('Q')
  })
  layer('C-STRM', () => {
    say('q 0 0 0 RG 0.7 w')
    poly([...toPage(20, 150), ...toPage(150, 140)])
    say('Q q 0 0 0 rg')
    text('24', ...toPage(85, 148), 5, Math.atan2(-10, 130))
    say('Q')
  })
  {
    const c = ex.find(e => e.level === 803 && lenOf(e.pts) > 200)
    if (c) { const k = (c.pts.length >> 2) << 1; shx('100', c.pts[k], c.pts[k + 1], SIZE, 0); truth.station = { x: c.pts[k], y: c.pts[k + 1] } }
  }
  // Legend, outside the site: samples on the contour layers + labels.
  const lx = W - 300, ly = 200
  layer('C-LEGEND', () => {
    say('q 0 0 0 RG 1.2 w')
    poly([lx, ly, lx + 120, ly])
    say('Q')
    text('812', lx + 60, ly + 6, SIZE, 0)
    text('PROPOSED CONTOUR', lx + 200, ly, 6, 0)
  })
  layer('V-TOPO-MAJR', () => { say('q 0.6 0.6 0.6 RG 0.9 w [9 4.5] 0 d'); poly([lx, ly + 40, lx + 120, ly + 40]); say('Q') })
  shx('810', lx + 60, ly + 46, SIZE, 0)
  layer('C-TOPO-MAJR', () => { say('q 0 0 0 RG 1.2 w'); poly([lx, ly + 80, lx + 120, ly + 80]); say('Q') })
  text('815', lx + 60, ly + 86, SIZE, 0)
  // An engineer's seal outside the site: thousands of tiny strokes in a few points (a signature) —
  // it must not slow the read down or turn into contours.
  layer('G-ANNO-TTLB', () => {
    say('q 0 0 0 RG 0.3 w')
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let k = 0; k < 6000; k++) {
      const x = W - 160 + rnd() * 60, y = 80 + rnd() * 40
      say(`${f2(x)} ${f2(y)} m ${f2(x + rnd() * 1.5)} ${f2(y + rnd() * 1.5)} l S`)
    }
    say('Q')
  })
  // Title block.
  layer('G-ANNO-TTLB', () => { say('q 0 0 0 RG 2 w'); say(`20 20 ${W - 40} ${H - 40} re S Q`); text('GRADING PLAN  C-3.0', W - 200, 60, 12, 0) })

  // ── assemble ──
  const objs = []
  const add = (s) => { objs.push(s); return objs.length }
  const catalogId = add(null), pagesId = add(null), pageId = add(null)
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const ocgIds = layers.map(n => add(`<< /Type /OCG /Name (${n}) >>`))
  const stream = content.join('\n')
  const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  const annotIds = annots.map(a => add(`<< /Type /Annot /Subtype /Square /Rect [${a.rect.map(f2).join(' ')}] /T (AutoCAD SHX Text) /Contents (${esc(a.contents)}) /C [] /F 4 /BS << /W 0 >> >>`))
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /OCProperties << /OCGs [${ocgIds.map(i => `${i} 0 R`).join(' ')}] /D << /ON [${ocgIds.map(i => `${i} 0 R`).join(' ')}] /Order [${ocgIds.map(i => `${i} 0 R`).join(' ')}] >> >> >>`
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`
  objs[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Rotate ${rotate} /Resources << /Font << /F1 ${fontId} 0 R >> /Properties << ${ocgIds.map((id, i) => `/oc${i} ${id} 0 R`).join(' ')} >> >> /Contents ${contentId} 0 R /Annots [${annotIds.map(i => `${i} 0 R`).join(' ')}] >>`
  let out = '%PDF-1.7\n%âãÏÓ\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  truth.limit = LIM
  return { bytes: Buffer.from(out, 'latin1'), truth, page: { W, H }, sitePageBox: { x0: SITE.x0 - 40, y0: SITE.y0 - 40, x1: SITE.x0 + SITE.wFt * PT_PER_FT + 40, y1: SITE.y0 + SITE.hFt * PT_PER_FT + 40 } }
}

/** Page point → site feet (inverse of toPage). */
export const toFt = (x, y) => [(x - SITE.x0) / PT_PER_FT, (y - SITE.y0) / PT_PER_FT]
