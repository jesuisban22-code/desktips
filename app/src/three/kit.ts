/**
 * Geometry kit — the shared vocabulary every Bureau component builds from.
 *
 * RULE: nothing in this project uses a raw BoxGeometry. Every edge gets a
 * chamfer, because a chamfer is what catches the light and turns a cube into
 * an object. Use `chamfer()` for panels and `turned()` for anything that would
 * have been made on a lathe (legs, lamp stems, mugs, pots).
 *
 * SCALE: 1 unit = 1 metre. Person is 1.72 tall. Desk top at 0.75.
 */

import * as THREE from "three"
import { RoundedBoxGeometry } from "three-stdlib"

// ── Cached geometry ──────────────────────────────────────────────────────────

const geoCache = new Map<string, THREE.BufferGeometry>()
function cacheGeo<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  let g = geoCache.get(key)
  if (!g) { g = build(); geoCache.set(key, g) }
  return g as T
}

// ── Chamfered box ────────────────────────────────────────────────────────────

/**
 * The workhorse. A box with softened edges.
 *
 * @param r  chamfer radius in metres. Keep it small — 0.004 for a thin panel,
 *           0.012 for a table top, 0.02 for a chunky beam. A chamfer larger
 *           than half the smallest dimension is clamped.
 */
export function chamfer(w: number, h: number, d: number, r = 0.008, seg = 2): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2.05, h / 2.05, d / 2.05)
  const key = `cb-${w.toFixed(4)}-${h.toFixed(4)}-${d.toFixed(4)}-${rr.toFixed(4)}-${seg}`
  return cacheGeo(key, () => new RoundedBoxGeometry(w, h, d, seg, rr))
}

/** A very slightly tapered box — reads as hand-made rather than machined. */
export function taperedBox(
  wBottom: number, wTop: number, h: number, dBottom: number, dTop: number,
): THREE.BufferGeometry {
  const key = `tb-${wBottom}-${wTop}-${h}-${dBottom}-${dTop}`
  return cacheGeo(key, () => {
    const g = new THREE.BufferGeometry()
    const hw0 = wBottom / 2, hw1 = wTop / 2
    const hd0 = dBottom / 2, hd1 = dTop / 2
    const y0 = -h / 2, y1 = h / 2
    // 8 corners
    const v = [
      [-hw0, y0, -hd0], [hw0, y0, -hd0], [hw0, y0, hd0], [-hw0, y0, hd0],
      [-hw1, y1, -hd1], [hw1, y1, -hd1], [hw1, y1, hd1], [-hw1, y1, hd1],
    ]
    const faces = [
      [0, 1, 2, 3],  // bottom (reversed below)
      [4, 7, 6, 5],  // top
      [0, 4, 5, 1],  // -Z
      [1, 5, 6, 2],  // +X
      [2, 6, 7, 3],  // +Z
      [3, 7, 4, 0],  // -X
    ]
    const pos: number[] = [], uv: number[] = []
    for (const f of faces) {
      const [a, b, c, dd] = f
      const quad = [a, b, c, a, c, dd]
      for (const idx of quad) pos.push(...v[idx])
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1)
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    // Belt and braces: any normal that still came out degenerate points up.
    const nrm = g.getAttribute("normal")
    for (let i = 0; i < nrm.count; i++) {
      const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i)
      if (!(x * x + y * y + z * z > 1e-8)) nrm.setXYZ(i, 0, 1, 0)
    }
    nrm.needsUpdate = true
    return g
  })
}

// ── Turned (lathe) parts ─────────────────────────────────────────────────────

export type Profile = Array<[number, number]>   // [radius, y] pairs, bottom → top

/**
 * Revolve a profile. Use for table legs, lamp stems, mugs, plant pots —
 * anything with rotational symmetry.
 */
/**
 * Segments needed so no facet chord exceeds ~26 mm. Hand-picked counts are
 * what left the lamp shades and the stool seat visibly polygonal: a count that
 * looks fine on a 20 mm knob is far too coarse on a 320 mm shade. Callers may
 * still ask for more, never for less.
 */
function latheSegments(profile: Profile): number {
  const maxR = profile.reduce((m, [r]) => Math.max(m, r), 0)
  // 20 mm, not 26: Plant and a few others are placed with a scale above 1,
  // which stretches the chord, and the geometry cache is shared across scales.
  const n = Math.ceil((2 * Math.PI * maxR) / 0.020)
  return Math.min(64, Math.max(12, n + (n % 2)))
}

export function turned(profile: Profile, segments?: number): THREE.BufferGeometry {
  const seg = Math.max(segments ?? 0, latheSegments(profile))
  const key = `lathe-${seg}-${profile.map(p => p.join(",")).join("|")}`
  return cacheGeo(key, () => {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y))
    return new THREE.LatheGeometry(pts, seg)
  })
}

/** A classic turned table leg: square at the top, turned below. */
export const LEG_TURNED: Profile = [
  [0.030, 0.00], [0.034, 0.02], [0.030, 0.05],
  [0.022, 0.09], [0.026, 0.14], [0.024, 0.34],
  [0.030, 0.40], [0.034, 0.46], [0.028, 0.52],
  [0.032, 0.58], [0.036, 0.64], [0.036, 0.74],
]

/** A slimmer tapered leg for lighter furniture. */
export const LEG_TAPER: Profile = [
  [0.018, 0.00], [0.022, 0.03], [0.024, 0.30],
  [0.028, 0.60], [0.030, 0.74],
]

/** Lamp stem. */
export const LAMP_STEM: Profile = [
  [0.075, 0.000], [0.078, 0.012], [0.060, 0.020],
  [0.022, 0.035], [0.018, 0.060], [0.016, 0.300],
  [0.020, 0.330], [0.016, 0.350],
]

/** Terracotta plant pot. */
export const POT_PROFILE: Profile = [
  [0.000, 0.000], [0.085, 0.000], [0.088, 0.012],
  [0.105, 0.150], [0.118, 0.235], [0.126, 0.250],
  [0.122, 0.258], [0.108, 0.250], [0.096, 0.150],
  [0.078, 0.014], [0.000, 0.014],
]

/** A mug. */
export const MUG_PROFILE: Profile = [
  [0.000, 0.000], [0.038, 0.000], [0.040, 0.006],
  [0.042, 0.085], [0.044, 0.095], [0.040, 0.095],
  [0.037, 0.085], [0.035, 0.010], [0.000, 0.010],
]

// ── Extruded panels & mouldings ──────────────────────────────────────────────

/**
 * A flat panel with a bevelled edge — door panels, picture frames, drawer
 * fronts. Much more convincing than a thin box.
 */
export function bevelPanel(
  w: number, h: number, thickness: number, bevel = 0.006,
): THREE.BufferGeometry {
  const key = `bp-${w}-${h}-${thickness}-${bevel}`
  return cacheGeo(key, () => {
    const s = new THREE.Shape()
    const hw = w / 2 - bevel, hh = h / 2 - bevel
    const r = Math.min(0.01, hw * 0.2, hh * 0.2)
    s.moveTo(-hw + r, -hh)
    s.lineTo(hw - r, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + r)
    s.lineTo(hw, hh - r);  s.quadraticCurveTo(hw, hh, hw - r, hh)
    s.lineTo(-hw + r, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - r)
    s.lineTo(-hw, -hh + r);s.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
    const g = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(thickness - bevel * 2, 0.001),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 4,
    })
    g.center()
    return g
  })
}

/**
 * A recessed frame-and-panel, like a real cabinet door: outer stile/rail
 * frame with a sunken centre. Returns a Group-ready set of parts.
 */
export function framePanelParts(w: number, h: number, stile = 0.07, depth = 0.022) {
  return {
    frameTop:   { geo: chamfer(w, stile, depth, 0.004),              pos: [0, h / 2 - stile / 2, 0] as const },
    frameBot:   { geo: chamfer(w, stile, depth, 0.004),              pos: [0, -h / 2 + stile / 2, 0] as const },
    frameLeft:  { geo: chamfer(stile, h - stile * 2, depth, 0.004),  pos: [-w / 2 + stile / 2, 0, 0] as const },
    frameRight: { geo: chamfer(stile, h - stile * 2, depth, 0.004),  pos: [w / 2 - stile / 2, 0, 0] as const },
    inset:      { geo: bevelPanel(w - stile * 1.7, h - stile * 1.7, depth * 0.6, 0.005), pos: [0, 0, -depth * 0.18] as const },
  }
}

/** Crown / cornice moulding profile, extruded along a length. */
export function moulding(length: number, height = 0.06, projection = 0.045): THREE.BufferGeometry {
  const key = `mould-${length}-${height}-${projection}`
  return cacheGeo(key, () => {
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(projection, 0)
    s.quadraticCurveTo(projection * 0.55, height * 0.30, projection * 0.62, height * 0.52)
    s.quadraticCurveTo(projection * 0.70, height * 0.74, projection * 0.24, height * 0.86)
    s.lineTo(projection * 0.20, height)
    s.lineTo(0, height)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, {
      depth: length, bevelEnabled: false, curveSegments: 5,
    })
    g.rotateY(Math.PI / 2)
    g.center()
    return g
  })
}

// ── Curves & tubes ───────────────────────────────────────────────────────────

/** A hanging cable / cord that sags naturally between two points. */
export function sagCable(
  from: [number, number, number], to: [number, number, number],
  sag = 0.25, radius = 0.006, segments = 20,
): THREE.BufferGeometry {
  const key = `cable-${from.join(",")}-${to.join(",")}-${sag}-${radius}`
  return cacheGeo(key, () => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const p = a.clone().lerp(b, t)
      // Catenary-ish droop
      p.y -= Math.sin(t * Math.PI) * sag
      pts.push(p)
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    return new THREE.TubeGeometry(curve, segments, radius, 6, false)
  })
}

/**
 * A rolled-up sheet of paper (blueprint tube).
 *
 * Closed-ended on purpose: an open cylinder shows its hollow interior from
 * above and reads as a flat strip of plastic rather than a roll of paper.
 */
export function rolledSheet(length = 0.5, radius = 0.035): THREE.BufferGeometry {
  const key = `roll-${length}-${radius}`
  return cacheGeo(key, () =>
    new THREE.CylinderGeometry(radius, radius * 0.94, length, 20, 1, false),
  )
}

// ── Organic / foliage ────────────────────────────────────────────────────────

/**
 * A leaf blade — flat, tapered, slightly curled. Much better than a sphere.
 */
export function leaf(length = 0.18, width = 0.07, curl = 0.25): THREE.BufferGeometry {
  const key = `leaf-${length}-${width}-${curl}`
  return cacheGeo(key, () => {
    const seg = 8
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    for (let i = 0; i <= seg; i++) {
      const t = i / seg
      // Width follows a leaf silhouette: narrow at base, widest ~35%, taper to tip
      // Never let the row collapse to a point. At t = 0 and t = 1 the silhouette
      // function returns exactly 0, the two vertices coincide, their only
      // triangle is degenerate, and computeVertexNormals hands back a zero
      // normal — which shades as pure black. That is why some leaves were
      // rendering as flat black cut-outs.
      const wHere = Math.max(
        width * Math.sin(Math.pow(t, 0.65) * Math.PI) * (1 - t * 0.15),
        width * 0.05,
      )
      const y = Math.sin(t * Math.PI * 0.8) * curl * length
      pos.push(-wHere / 2, y, t * length)
      pos.push( wHere / 2, y, t * length)
      uv.push(0, t, 1, t)
      if (i < seg) {
        const b = i * 2
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    // Belt and braces: any normal that still came out degenerate points up.
    const nrm = g.getAttribute("normal")
    for (let i = 0; i < nrm.count; i++) {
      const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i)
      if (!(x * x + y * y + z * z > 1e-8)) nrm.setXYZ(i, 0, 1, 0)
    }
    nrm.needsUpdate = true
    return g
  })
}

// ── Deterministic pseudo-random (for scattering props) ───────────────────────

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Small random jitter in radians — makes placed objects look hand-set. */
export function jitter(r: () => number, amount = 0.05) {
  return (r() - 0.5) * 2 * amount
}

// ── Scale constants ──────────────────────────────────────────────────────────

export const SCALE = {
  personHeight: 1.72,
  deskTop:      0.75,
  // Set by the figure, not by a catalogue: with a 0.400 shin and a 0.075 shoe,
  // a seat any higher than this leaves the feet hanging in the air or the
  // thighs buried in the cushion. 0.45 did both at once.
  seatHeight:   0.405,
  ceiling:      3.40,
  roomHalf:     6.00,
  doorHeight:   2.10,
  doorWidth:    0.92,
} as const
