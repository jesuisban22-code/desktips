/**
 * Procedural canvas textures — generated once at startup, cached.
 * No external image assets, keeps the .exe small.
 *
 * Every generator returns a THREE.CanvasTexture already configured for
 * tiling and correct color space.
 */

import * as THREE from "three"

// ── Deterministic noise ──────────────────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Value-noise lattice with bilinear interpolation. */
function makeValueNoise(seed: number, size = 64) {
  const rnd = mulberry32(seed)
  const grid = new Float32Array(size * size)
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()

  const smooth = (t: number) => t * t * (3 - 2 * t)

  return (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const x0 = ((xi % size) + size) % size
    const y0 = ((yi % size) + size) % size
    const x1 = (x0 + 1) % size
    const y1 = (y0 + 1) % size
    const v00 = grid[y0 * size + x0], v10 = grid[y0 * size + x1]
    const v01 = grid[y1 * size + x0], v11 = grid[y1 * size + x1]
    const sx = smooth(xf), sy = smooth(yf)
    const a = v00 + (v10 - v00) * sx
    const b = v01 + (v11 - v01) * sx
    return a + (b - a) * sy
  }
}

/** Fractal brownian motion over value noise. */
function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4, lac = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq)
    norm += amp
    amp *= gain
    freq *= lac
  }
  return sum / norm
}

// ── Canvas helper ────────────────────────────────────────────────────────────

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas")
  c.width = c.height = size
  const ctx = c.getContext("2d")!
  return [c, ctx]
}

function finish(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 4
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, THREE.CanvasTexture>()
function cached(key: string, build: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key)
  if (!t) { t = build(); cache.set(key, t) }
  return t
}

// ── Wood grain ───────────────────────────────────────────────────────────────

/**
 * Oak / walnut grain. Long stretched fbm along X plus occasional darker
 * cathedral rings, with a few knots.
 */
export function woodTexture(light: string, dark: string, seed = 1, size = 512): THREE.CanvasTexture {
  return cached(`wood-${light}-${dark}-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const noise = makeValueNoise(seed)
    const A = hexToRgb(light), B = hexToRgb(dark)
    const img = ctx.createImageData(size, size)

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size
        // Stretch strongly along X so grain runs lengthwise
        const grain = fbm(noise, u * 3.0, v * 46.0, 4)
        // Cathedral rings: warp the coordinate then band it
        const warp = fbm(noise, u * 2.0 + 11, v * 6.0 + 7, 3)
        const rings = Math.abs(Math.sin((v * 18 + warp * 5.0) * Math.PI))
        let t = grain * 0.55 + rings * 0.45
        // Fine pore streaks
        t += (fbm(noise, u * 4 + 31, v * 190 + 3, 2) - 0.5) * 0.12
        t = Math.min(1, Math.max(0, t))
        const [r, g, b] = [
          A[0] + (B[0] - A[0]) * t,
          A[1] + (B[1] - A[1]) * t,
          A[2] + (B[2] - A[2]) * t,
        ]
        const i = (y * size + x) * 4
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)

    // A couple of knots
    const rnd = mulberry32(seed * 7 + 3)
    const knots = 1 + Math.floor(rnd() * 2)
    for (let k = 0; k < knots; k++) {
      const kx = rnd() * size, ky = rnd() * size
      const kr = 6 + rnd() * 10
      for (let ring = kr; ring > 0; ring -= 1.6) {
        ctx.beginPath()
        ctx.ellipse(kx, ky, ring * 1.7, ring, 0, 0, Math.PI * 2)
        ctx.strokeStyle = mix(A, B, 0.55 + 0.35 * (ring / kr))
        ctx.lineWidth = 1.1
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.ellipse(kx, ky, 2.4, 1.5, 0, 0, Math.PI * 2)
      ctx.fillStyle = mix(A, B, 1)
      ctx.fill()
    }

    return finish(c, 1)
  })
}

/** Grayscale roughness companion for wood — pores are rougher. */
export function woodRoughness(seed = 1, size = 256): THREE.CanvasTexture {
  return cached(`woodrough-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const noise = makeValueNoise(seed + 99)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = fbm(noise, (x / size) * 3, (y / size) * 40, 3)
        const g = Math.round(150 + v * 90)
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1, false)
  })
}

// ── Plaster wall ─────────────────────────────────────────────────────────────

export function plasterTexture(base: string, seed = 5, size = 512): THREE.CanvasTexture {
  return cached(`plaster-${base}-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const noise = makeValueNoise(seed)
    const A = hexToRgb(base)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Broad mottling + fine tooth
        const broad = fbm(noise, (x / size) * 3.5, (y / size) * 3.5, 4)
        const fine  = fbm(noise, (x / size) * 26, (y / size) * 26, 2)
        const t = (broad - 0.5) * 0.10 + (fine - 0.5) * 0.045
        const i = (y * size + x) * 4
        img.data[i]     = Math.max(0, Math.min(255, A[0] * (1 + t)))
        img.data[i + 1] = Math.max(0, Math.min(255, A[1] * (1 + t)))
        img.data[i + 2] = Math.max(0, Math.min(255, A[2] * (1 + t)))
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1)
  })
}

/** Bump/normal-ish grayscale for plaster tooth. */
export function plasterBump(seed = 5, size = 256): THREE.CanvasTexture {
  return cached(`plasterbump-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const noise = makeValueNoise(seed + 41)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = fbm(noise, (x / size) * 30, (y / size) * 30, 3)
        const g = Math.round(110 + v * 80)
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1, false)
  })
}

// ── Persian rug ──────────────────────────────────────────────────────────────

/**
 * Symmetric medallion rug. Drawn with real geometry (not noise) so it reads
 * as a designed object, then roughened with a wool speckle pass.
 */
export function rugTexture(
  field: string, motif: string, deep: string, cream: string, size = 512,
): THREE.CanvasTexture {
  return cached(`rug-${field}-${motif}`, () => {
    const [c, ctx] = canvas(size)
    const S = size

    // Ground
    ctx.fillStyle = field
    ctx.fillRect(0, 0, S, S)

    // Outer border bands
    const band = (inset: number, w: number, color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2)
    }
    band(S * 0.035, S * 0.030, deep)
    band(S * 0.070, S * 0.016, motif)
    band(S * 0.094, S * 0.008, cream)

    // Border guard motif — repeating diamonds along the frame
    ctx.fillStyle = cream
    const gp = S * 0.055
    const count = 22
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const d = S * 0.014
      const pts: Array<[number, number]> = [
        [gp + (S - gp * 2) * t, gp],
        [gp + (S - gp * 2) * t, S - gp],
        [gp, gp + (S - gp * 2) * t],
        [S - gp, gp + (S - gp * 2) * t],
      ]
      for (const [px, py] of pts) {
        ctx.beginPath()
        ctx.moveTo(px, py - d); ctx.lineTo(px + d, py)
        ctx.lineTo(px, py + d); ctx.lineTo(px - d, py)
        ctx.closePath(); ctx.fill()
      }
    }

    // Central medallion.
    //
    // Two earlier versions failed on a real screen, in opposite directions.
    // The first was sharp-pointed stars filled with the rug's cream: under the
    // lamps the cream clipped to white and the spikes read as a rendering
    // fault. The second replaced them with deep-coloured lobes on a deep-red
    // ground, which read as an amoeba — right colours, no legible design.
    //
    // What a medallion actually needs: rings that alternate light and dark so
    // the eye can count them, and an edge that is only gently scalloped. Lobes
    // deep enough to see from across the room turn concentric rings into
    // flames.
    const cx = S / 2, cy = S / 2
    const softCream = mix(hexToRgb(cream), hexToRgb(motif), 0.42)
    const SQUASH = 1.28
    const LOBES = 24
    const DEPTH = 0.028

    const ring = (radius: number, color: string, rot = 0) => {
      ctx.beginPath()
      const STEPS = 480
      for (let i = 0; i <= STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2
        const r = radius * (1 + DEPTH * Math.cos(LOBES * (a - rot)))
        const px = cx + Math.cos(a) * r * SQUASH
        const py = cy + Math.sin(a) * r
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    }

    const outline = (radius: number, color: string, w: number, rot = 0) => {
      ctx.beginPath()
      const STEPS = 480
      for (let i = 0; i <= STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2
        const r = radius * (1 + DEPTH * Math.cos(LOBES * (a - rot)))
        const px = cx + Math.cos(a) * r * SQUASH
        const py = cy + Math.sin(a) * r
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.stroke()
    }

    ring(S * 0.216, deep)
    ring(S * 0.200, motif)
    outline(S * 0.200, deep, S * 0.0055)
    ring(S * 0.152, deep)
    outline(S * 0.152, softCream, S * 0.004)
    ring(S * 0.112, softCream)
    outline(S * 0.112, deep, S * 0.0045)
    ring(S * 0.062, deep)
    ctx.beginPath()
    ctx.ellipse(cx, cy, S * 0.028 * SQUASH, S * 0.028, 0, 0, Math.PI * 2)
    ctx.fillStyle = motif
    ctx.fill()

    // Pendants at the head and foot of the medallion — what makes a rug read
    // as woven to a plan rather than stamped with a shape.
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx, cy + sgn * S * 0.202)
      ctx.quadraticCurveTo(cx + S * 0.028, cy + sgn * S * 0.245, cx, cy + sgn * S * 0.282)
      ctx.quadraticCurveTo(cx - S * 0.028, cy + sgn * S * 0.245, cx, cy + sgn * S * 0.202)
      ctx.closePath()
      ctx.fillStyle = motif
      ctx.fill()
      ctx.strokeStyle = deep
      ctx.lineWidth = S * 0.004
      ctx.stroke()
    }

    // Corner ornaments.
    //
    // These used to be solid quadratic blobs, which read as four amber eggs;
    // outlining them turned them into four eyes staring out of the corners.
    // A stack of diamonds on the diagonal is what the border guard already
    // uses, so the corners now rhyme with the frame instead of arguing with it.
    const diamond = (px: number, py: number, r: number, fill: string, stroke?: string) => {
      ctx.beginPath()
      ctx.moveTo(px, py - r); ctx.lineTo(px + r * SQUASH, py)
      ctx.lineTo(px, py + r); ctx.lineTo(px - r * SQUASH, py)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = S * 0.0035
        ctx.stroke()
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const ox = cx + sx * S * 0.315
        const oy = cy + sy * S * 0.315
        diamond(ox, oy, S * 0.046, motif, deep)
        diamond(ox, oy, S * 0.022, deep)
        diamond(ox - sx * S * 0.082, oy - sy * S * 0.082, S * 0.022, softCream, deep)
        diamond(ox + sx * S * 0.055, oy + sy * S * 0.055, S * 0.016, deep)
      }
    }

    // Wool speckle — breaks up the flatness
    const noise = makeValueNoise(77)
    const img = ctx.getImageData(0, 0, S, S)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = (fbm(noise, (x / S) * 90, (y / S) * 90, 2) - 0.5) * 0.20
        const i = (y * S + x) * 4
        img.data[i]     = Math.max(0, Math.min(255, img.data[i]     * (1 + n)))
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * (1 + n)))
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * (1 + n)))
      }
    }
    ctx.putImageData(img, 0, 0)

    return finish(c, 1)
  })
}

// ── Paper ────────────────────────────────────────────────────────────────────

export function paperTexture(base: string, seed = 12, size = 256): THREE.CanvasTexture {
  return cached(`paper-${base}-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const noise = makeValueNoise(seed)
    const A = hexToRgb(base)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fib = fbm(noise, (x / size) * 60, (y / size) * 60, 2)
        const t = (fib - 0.5) * 0.055
        const i = (y * size + x) * 4
        img.data[i]     = Math.min(255, A[0] * (1 + t))
        img.data[i + 1] = Math.min(255, A[1] * (1 + t))
        img.data[i + 2] = Math.min(255, A[2] * (1 + t))
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1)
  })
}

/** A technical drawing / blueprint sheet. */
/**
 * A pencil elevation on warm paper, for the small frame beside the blueprint.
 * It used to hang an unmarked sheet of cream paper on a cream wall, which read
 * as an empty frame from the room camera.
 */
export function sketchTexture(size = 512): THREE.CanvasTexture {
  return cached("sketch", () => {
    const [c, ctx] = canvas(size)
    const S = (v: number) => v * size
    ctx.fillStyle = "#efe3c8"
    ctx.fillRect(0, 0, size, size)

    // laid-paper tint
    ctx.strokeStyle = "rgba(150,120,80,0.05)"
    ctx.lineWidth = 1
    for (let i = 0; i < size; i += 5) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke()
    }

    const ink = "#4a3a28"
    ctx.strokeStyle = "rgba(74,58,40,0.45)"
    ctx.lineWidth = 2
    ctx.strokeRect(S(0.07), S(0.07), S(0.86), S(0.86))

    // a little house elevation: gable, door, two windows, a chimney
    ctx.strokeStyle = ink
    ctx.lineWidth = 3.4
    ctx.beginPath()
    ctx.moveTo(S(0.20), S(0.70)); ctx.lineTo(S(0.20), S(0.44))
    ctx.lineTo(S(0.50), S(0.26)); ctx.lineTo(S(0.80), S(0.44))
    ctx.lineTo(S(0.80), S(0.70)); ctx.closePath(); ctx.stroke()
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.moveTo(S(0.62), S(0.345)); ctx.lineTo(S(0.62), S(0.22))
    ctx.lineTo(S(0.69), S(0.22)); ctx.lineTo(S(0.69), S(0.385))
    ctx.stroke()
    ctx.lineWidth = 2.4
    ctx.strokeRect(S(0.44), S(0.54), S(0.12), S(0.16))          // door
    ctx.strokeRect(S(0.26), S(0.50), S(0.11), S(0.10))          // window
    ctx.strokeRect(S(0.63), S(0.50), S(0.11), S(0.10))
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(S(0.315), S(0.50)); ctx.lineTo(S(0.315), S(0.60))
    ctx.moveTo(S(0.26), S(0.55)); ctx.lineTo(S(0.37), S(0.55))
    ctx.moveTo(S(0.685), S(0.50)); ctx.lineTo(S(0.685), S(0.60))
    ctx.moveTo(S(0.63), S(0.55)); ctx.lineTo(S(0.74), S(0.55))
    ctx.stroke()
    // ground line and a scribbled caption
    ctx.lineWidth = 2.8
    ctx.beginPath(); ctx.moveTo(S(0.14), S(0.70)); ctx.lineTo(S(0.86), S(0.70)); ctx.stroke()
    ctx.strokeStyle = "rgba(74,58,40,0.55)"
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i++) {
      const y = S(0.77 + i * 0.045)
      ctx.beginPath(); ctx.moveTo(S(0.16), y); ctx.lineTo(S(0.16 + 0.34 - i * 0.07), y); ctx.stroke()
    }
    return finish(c)
  })
}

export function blueprintTexture(size = 512): THREE.CanvasTexture {
  return cached("blueprint", () => {
    const [c, ctx] = canvas(size)
    ctx.fillStyle = "#f2ead6"
    ctx.fillRect(0, 0, size, size)

    // Grid
    ctx.strokeStyle = "rgba(44,85,120,0.16)"
    ctx.lineWidth = 1
    for (let i = 0; i <= size; i += size / 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke()
    }

    // Title block
    ctx.strokeStyle = "#2c5578"
    ctx.lineWidth = 2.5
    ctx.strokeRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92)
    ctx.lineWidth = 1.8
    ctx.strokeRect(size * 0.60, size * 0.78, size * 0.36, size * 0.18)
    ctx.beginPath()
    ctx.moveTo(size * 0.60, size * 0.845); ctx.lineTo(size * 0.96, size * 0.845)
    ctx.moveTo(size * 0.60, size * 0.905); ctx.lineTo(size * 0.96, size * 0.905)
    ctx.stroke()

    // A floor-plan-ish drawing
    ctx.lineWidth = 2.6
    ctx.strokeStyle = "#2c5578"
    ctx.strokeRect(size * 0.12, size * 0.14, size * 0.44, size * 0.40)
    ctx.lineWidth = 1.6
    ctx.strokeRect(size * 0.16, size * 0.18, size * 0.16, size * 0.14)
    ctx.strokeRect(size * 0.36, size * 0.18, size * 0.16, size * 0.22)
    ctx.strokeRect(size * 0.16, size * 0.36, size * 0.16, size * 0.14)

    // An elevation below
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(size * 0.12, size * 0.72)
    ctx.lineTo(size * 0.12, size * 0.62)
    ctx.lineTo(size * 0.34, size * 0.56)
    ctx.lineTo(size * 0.56, size * 0.62)
    ctx.lineTo(size * 0.56, size * 0.72)
    ctx.closePath(); ctx.stroke()

    // Dimension lines
    ctx.lineWidth = 0.9
    ctx.strokeStyle = "rgba(44,85,120,0.7)"
    ctx.beginPath()
    ctx.moveTo(size * 0.12, size * 0.585); ctx.lineTo(size * 0.56, size * 0.585)
    ctx.stroke()

    // Freehand annotation squiggles
    ctx.strokeStyle = "rgba(74,74,74,0.55)"
    ctx.lineWidth = 1.2
    for (let r = 0; r < 5; r++) {
      const y = size * (0.60 + r * 0.028)
      ctx.beginPath()
      ctx.moveTo(size * 0.62, y)
      for (let x = 0.62; x < 0.94; x += 0.02) {
        ctx.lineTo(size * x, y + Math.sin(x * 90) * 1.4)
      }
      ctx.stroke()
    }

    return finish(c, 1)
  })
}

// ── Fabric / linen ───────────────────────────────────────────────────────────

export function linenTexture(base: string, seed = 21, size = 256): THREE.CanvasTexture {
  return cached(`linen-${base}-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const A = hexToRgb(base)
    const noise = makeValueNoise(seed)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Woven cross-hatch
        const weave = (Math.sin(x * 0.9) * 0.5 + 0.5) * 0.5 + (Math.sin(y * 0.9) * 0.5 + 0.5) * 0.5
        const slub = fbm(noise, (x / size) * 24, (y / size) * 24, 2)
        const t = (weave - 0.5) * 0.09 + (slub - 0.5) * 0.10
        const i = (y * size + x) * 4
        img.data[i]     = Math.max(0, Math.min(255, A[0] * (1 + t)))
        img.data[i + 1] = Math.max(0, Math.min(255, A[1] * (1 + t)))
        img.data[i + 2] = Math.max(0, Math.min(255, A[2] * (1 + t)))
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1)
  })
}

// ── Sky seen through the window ──────────────────────────────────────────────

/**
 * The same skyline as skyTexture, at night: lit windows inside each building
 * and a scatter of stars above. Added on top of the tinted sky (see M.sky) as
 * the evening comes on. The buildings are laid out by replaying skyTexture's
 * own random sequence, draw for draw, so every window lands in a building.
 */
export function nightSkyTexture(size = 512): THREE.CanvasTexture {
  return cached(`night-${size}`, () => {
    const [c, ctx] = canvas(size)
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, size, size)
    const k = size / 256
    const rnd = mulberry32(9)          // skyTexture's sequence
    const lit = mulberry32(4242)       // which windows are on
    let x = 0
    while (x < 256) {
      const w = 14 + rnd() * 26
      const h = 16 + rnd() * 30
      rnd()                            // skyTexture's roof height
      for (let wy = 256 - h + 5; wy < 256 - 4; wy += 7) {
        for (let wx = x + 3; wx < x + w - 4; wx += 6) {
          if (lit() < 0.34) {
            const warm = lit() < 0.8
            ctx.fillStyle = warm ? "rgba(255,206,120,0.95)" : "rgba(190,215,255,0.8)"
            ctx.fillRect(wx * k, wy * k, 3 * k, 3.6 * k)
          }
        }
      }
      x += w + 2 + rnd() * 6
    }
    // Stars, only in the upper sky and never over the roofs.
    const s = mulberry32(77)
    for (let i = 0; i < 110; i++) {
      const sx = s() * size, sy = s() * size * 0.62
      const b = 0.35 + s() * 0.65
      ctx.fillStyle = `rgba(230,236,255,${b})`
      ctx.fillRect(sx, sy, s() < 0.12 ? 2 * k : k, s() < 0.12 ? 2 * k : k)
    }
    return finish(c, 1)
  })
}

export function skyTexture(warm: string, cool: string, size = 256): THREE.CanvasTexture {
  return cached(`sky-${warm}-${cool}`, () => {
    const [c, ctx] = canvas(size)
    const grad = ctx.createLinearGradient(0, 0, 0, size)
    grad.addColorStop(0, cool)
    grad.addColorStop(0.55, "#d8e4e8")
    grad.addColorStop(1, warm)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    // Soft clouds
    const noise = makeValueNoise(303)
    const img = ctx.getImageData(0, 0, size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(noise, (x / size) * 3.5, (y / size) * 2.2, 4)
        const cloud = Math.max(0, n - 0.52) * 2.2
        const i = (y * size + x) * 4
        img.data[i]     = Math.min(255, img.data[i]     + cloud * 55)
        img.data[i + 1] = Math.min(255, img.data[i + 1] + cloud * 50)
        img.data[i + 2] = Math.min(255, img.data[i + 2] + cloud * 42)
      }
    }
    ctx.putImageData(img, 0, 0)

    // Distant rooftops silhouette along the bottom
    ctx.fillStyle = "rgba(90,70,55,0.45)"
    let x = 0
    const rnd = mulberry32(9)
    while (x < size) {
      const w = 14 + rnd() * 26
      const h = 16 + rnd() * 30
      ctx.fillRect(x, size - h, w, h)
      // roof
      ctx.beginPath()
      ctx.moveTo(x - 2, size - h)
      ctx.lineTo(x + w / 2, size - h - 8 - rnd() * 8)
      ctx.lineTo(x + w + 2, size - h)
      ctx.closePath(); ctx.fill()
      x += w + 2 + rnd() * 6
    }

    return finish(c, 1)
  })
}

// ── Brushed metal ────────────────────────────────────────────────────────────

export function metalRoughness(seed = 33, size = 128): THREE.CanvasTexture {
  return cached(`metalrough-${seed}`, () => {
    const [c, ctx] = canvas(size)
    const noise = makeValueNoise(seed)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const brush = fbm(noise, (x / size) * 1.5, (y / size) * 70, 2)
        const g = Math.round(70 + brush * 90)
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1, false)
  })
}

// ── Book spine strip (for the bookshelf) ─────────────────────────────────────

export function bookSpineTexture(color: string, seed: number, size = 128): THREE.CanvasTexture {
  return cached(`spine-${color}-${seed}`, () => {
    const [c, ctx] = canvas(size)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, size, size)
    const rnd = mulberry32(seed)

    // Head and tail bands
    ctx.fillStyle = "rgba(0,0,0,0.20)"
    ctx.fillRect(0, 0, size, size * 0.05)
    ctx.fillRect(0, size * 0.95, size, size * 0.05)

    // Gilt rules
    ctx.fillStyle = "rgba(200,165,90,0.85)"
    ctx.fillRect(0, size * 0.16, size, 2)
    ctx.fillRect(0, size * 0.24, size, 2)
    ctx.fillRect(0, size * 0.70, size, 2)
    ctx.fillRect(0, size * 0.78, size, 2)

    // Fake title text blocks
    ctx.fillStyle = "rgba(210,180,110,0.8)"
    const lines = 2 + Math.floor(rnd() * 2)
    for (let i = 0; i < lines; i++) {
      const w = size * (0.35 + rnd() * 0.35)
      ctx.fillRect((size - w) / 2, size * (0.34 + i * 0.09), w, 3)
    }

    // Cloth weave
    const noise = makeValueNoise(seed + 5)
    const img = ctx.getImageData(0, 0, size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = (fbm(noise, (x / size) * 40, (y / size) * 40, 2) - 0.5) * 0.16
        const i = (y * size + x) * 4
        img.data[i]     = Math.max(0, Math.min(255, img.data[i]     * (1 + n)))
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * (1 + n)))
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * (1 + n)))
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1)
  })
}


// ── Light shaft falloff ──────────────────────────────────────────────────────

/**
 * Alpha ramp for a volumetric light shaft.
 *
 * Without this a shaft is a box, and a box has a silhouette: the beams read as
 * panes of frosted glass leaning in the room rather than as light. The ramp
 * fades to nothing at every edge and thins along the shaft's length, so what
 * survives is a soft core with no boundary anywhere.
 */
export function shaftAlpha(size = 128): THREE.CanvasTexture {
  return cached("shaftAlpha", () => {
    const [c, ctx] = canvas(size)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1)          // across the beam
        const v = y / (size - 1)          // along it, 0 = window
        // Fade on ALL four edges, not just two: taperedBox maps its quads
        // independently and some faces arrive with u and v swapped, so a ramp
        // that only fades across would leave a hard edge on those.
        const across = Math.pow(Math.sin(u * Math.PI), 1.6)
        const bell   = Math.pow(Math.sin(v * Math.PI), 0.8)
        // Thin along the beam so it dissolves before reaching the far wall.
        const along  = 1 - v * 0.55
        const a = Math.max(0, Math.min(1, across * bell * along))
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255)
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return finish(c, 1, false)
  })
}

// ── Backdrop ─────────────────────────────────────────────────────────────────

/**
 * The warm pool the room sits in. Drawn once into a small canvas and used as
 * `scene.background`; three stretches it across the viewport, which is exactly
 * what a backdrop wants.
 *
 * Deliberately NOT a CSS gradient behind a transparent canvas: the
 * post-processing composer writes an opaque frame, so anything under the canvas
 * never shows.
 */
export function voidTexture(warm: string, mid: string, edge: string): THREE.CanvasTexture {
  return cached(`void-${warm}-${mid}-${edge}`, () => {
    const S = 256
    const [c, ctx] = canvas(S)
    // Centred a little above middle: the room's mass sits low in frame, so the
    // light reads as coming from behind and above it.
    const g = ctx.createRadialGradient(S * 0.5, S * 0.44, S * 0.04, S * 0.5, S * 0.44, S * 0.78)
    g.addColorStop(0.00, warm)
    g.addColorStop(0.45, mid)
    g.addColorStop(1.00, edge)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  })
}
