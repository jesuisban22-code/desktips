/**
 * nav.ts — getting from one station to another without walking through the desk.
 *
 * A coarse occupancy grid over the room floor, A* across it, then a
 * string-pulling pass that collapses the staircase A* produces back into a few
 * long straight runs. Grid resolution is 0.25 m, so the whole thing is 48×48 —
 * small enough that a full search costs microseconds and can be done on demand
 * whenever an agent is dispatched somewhere.
 *
 * Obstacles are inflated by the character's radius, so a path that clears the
 * grid clears the furniture with the body, not just the centre point.
 */

const MIN = -6, MAX = 6
export const CELL = 0.25
const N = Math.round((MAX - MIN) / CELL)      // 48
const BODY_R = 0.30                            // character radius + margin

/** Axis-aligned furniture footprints, in world metres. */
type Rect = { x0: number; z0: number; x1: number; z1: number }

const OBSTACLES: Rect[] = [
  { x0:  1.70, z0:  1.18, x1:  3.50, z1:  2.22 },  // main desk
  { x0: -2.10, z0: -3.98, x1: -0.70, z1: -3.04 },  // drafting table
  { x0: -0.60, z0: -4.10, x1: -0.24, z1: -3.74 },  // lamp by the drafting table
  { x0: -5.52, z0:  0.34, x1: -4.68, z1:  2.46 },  // workbench
  { x0:  1.14, z0: -5.76, x1:  3.26, z1: -5.34 },  // bookshelf
  { x0:  4.38, z0: -4.96, x1:  5.02, z1: -4.24 },  // filing cabinet
  { x0:  4.39, z0:  2.79, x1:  4.71, z1:  3.11 },  // crate of drawings
  { x0:  4.93, z0:  1.33, x1:  5.37, z1:  1.77 },  // plant, right
  { x0: -2.83, z0:  3.52, x1: -1.77, z1:  4.58 },  // armchair
  { x0: -1.46, z0:  4.02, x1: -0.90, z1:  4.58 },  // side table
  { x0: -3.43, z0:  3.17, x1: -3.07, z1:  3.53 },  // floor lamp
  { x0: -5.48, z0: -5.08, x1: -5.12, z1: -4.72 },  // plant, back-left
  { x0:  3.48, z0:  3.33, x1:  3.92, z1:  3.77 },  // plant, near corner
  { x0:  0.72, z0: -5.58, x1:  1.08, z1: -5.22 },  // plant, back
  { x0: -2.66, z0: -3.74, x1: -1.98, z1: -3.18 },  // pile of finished drawings
]

/** The walkable floor, inset from the wall faces. */
const BOUND: Rect = { x0: -5.55, z0: -5.55, x1: 5.55, z1: 5.55 }

// ── Grid ─────────────────────────────────────────────────────────────────────

function idx(cx: number, cz: number): number { return cz * N + cx }

const blocked: Uint8Array = (() => {
  const g = new Uint8Array(N * N)
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const x = MIN + (cx + 0.5) * CELL
      const z = MIN + (cz + 0.5) * CELL
      let bad = x < BOUND.x0 + BODY_R || x > BOUND.x1 - BODY_R
             || z < BOUND.z0 + BODY_R || z > BOUND.z1 - BODY_R
      if (!bad) {
        for (const o of OBSTACLES) {
          if (x > o.x0 - BODY_R && x < o.x1 + BODY_R &&
              z > o.z0 - BODY_R && z < o.z1 + BODY_R) { bad = true; break }
        }
      }
      g[idx(cx, cz)] = bad ? 1 : 0
    }
  }
  return g
})()

function toCell(x: number, z: number): [number, number] {
  return [
    Math.max(0, Math.min(N - 1, Math.floor((x - MIN) / CELL))),
    Math.max(0, Math.min(N - 1, Math.floor((z - MIN) / CELL))),
  ]
}
function toWorld(cx: number, cz: number): [number, number] {
  return [MIN + (cx + 0.5) * CELL, MIN + (cz + 0.5) * CELL]
}

export function isBlocked(x: number, z: number): boolean {
  const [cx, cz] = toCell(x, z)
  return blocked[idx(cx, cz)] === 1
}

/**
 * Station stand points sit deliberately close to their furniture, so one can
 * land inside the inflated obstacle. Snap to the nearest free cell rather than
 * failing the search.
 */
function nearestFree(cx: number, cz: number): [number, number] {
  if (blocked[idx(cx, cz)] === 0) return [cx, cz]
  for (let r = 1; r < 12; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const nx = cx + dx, nz = cz + dz
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue
        if (blocked[idx(nx, nz)] === 0) return [nx, nz]
      }
    }
  }
  return [cx, cz]
}

// ── A* ───────────────────────────────────────────────────────────────────────

const DIRS: Array<[number, number, number]> = [
  [ 1,  0, 1], [-1,  0, 1], [ 0,  1, 1], [ 0, -1, 1],
  [ 1,  1, Math.SQRT2], [ 1, -1, Math.SQRT2],
  [-1,  1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

export type Path = Array<[number, number]>

function astar(sx: number, sz: number, gx: number, gz: number): Path | null {
  const start = idx(sx, sz), goal = idx(gx, gz)
  if (start === goal) return [toWorld(gx, gz)]

  const g = new Float32Array(N * N).fill(Infinity)
  const f = new Float32Array(N * N).fill(Infinity)
  const prev = new Int32Array(N * N).fill(-1)
  const open: number[] = [start]
  const inOpen = new Uint8Array(N * N)
  const closed = new Uint8Array(N * N)

  const h = (cx: number, cz: number) => Math.hypot(cx - gx, cz - gz)
  g[start] = 0
  f[start] = h(sx, sz)
  inOpen[start] = 1

  while (open.length) {
    // Small grid, so a linear scan beats the bookkeeping of a real heap.
    let bi = 0
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i
    const cur = open.splice(bi, 1)[0]
    inOpen[cur] = 0
    if (cur === goal) break
    closed[cur] = 1

    const cx = cur % N, cz = (cur / N) | 0
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx, nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue
      const ni = idx(nx, nz)
      if (blocked[ni] || closed[ni]) continue
      // Do not cut diagonally through a blocked corner
      if (dx !== 0 && dz !== 0) {
        if (blocked[idx(cx + dx, cz)] || blocked[idx(cx, cz + dz)]) continue
      }
      const tentative = g[cur] + cost
      if (tentative < g[ni]) {
        g[ni] = tentative
        f[ni] = tentative + h(nx, nz)
        prev[ni] = cur
        if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1 }
      }
    }
  }

  if (prev[goal] === -1 && goal !== start) return null
  const out: Path = []
  let c = goal
  let guard = 0
  while (c !== -1 && guard++ < N * N) {
    out.push(toWorld(c % N, (c / N) | 0))
    if (c === start) break
    c = prev[c]
  }
  return out.reverse()
}

// ── Smoothing ────────────────────────────────────────────────────────────────

function lineClear(ax: number, az: number, bx: number, bz: number): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (isBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false
  }
  return true
}

/** String-pulling: collapse the A* staircase into the fewest straight runs. */
function smooth(path: Path): Path {
  if (path.length <= 2) return path
  const out: Path = [path[0]]
  let i = 0
  while (i < path.length - 1) {
    let j = path.length - 1
    while (j > i + 1 && !lineClear(path[i][0], path[i][1], path[j][0], path[j][1])) j--
    out.push(path[j])
    i = j
  }
  return out
}

// ── Public ───────────────────────────────────────────────────────────────────

const cache = new Map<string, Path>()

/**
 * A walkable path from → to, in world (x, z). Returns a straight line when one
 * exists, and null only if the goal is genuinely unreachable.
 */
export function findPath(
  from: [number, number], to: [number, number],
): Path | null {
  if (lineClear(from[0], from[1], to[0], to[1])) return [from, to]

  const key = `${from[0].toFixed(2)},${from[1].toFixed(2)}>${to[0].toFixed(2)},${to[1].toFixed(2)}`
  const hit = cache.get(key)
  if (hit) return hit

  const [sx0, sz0] = toCell(from[0], from[1])
  const [gx0, gz0] = toCell(to[0], to[1])
  const [sx, sz] = nearestFree(sx0, sz0)
  const [gx, gz] = nearestFree(gx0, gz0)

  const raw = astar(sx, sz, gx, gz)
  if (!raw) return null

  // Keep the true endpoints — the grid centres are only a routing scaffold.
  const path = smooth([from, ...raw, to])
  cache.set(key, path)
  return path
}

/** Total length of a path, for timing the walk. */
export function pathLength(p: Path): number {
  let d = 0
  for (let i = 1; i < p.length; i++) {
    d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
  }
  return d
}

/** Point and heading at distance `s` along a path. */
export function samplePath(
  p: Path, s: number,
): { x: number; z: number; heading: number; done: boolean } {
  if (p.length === 0) return { x: 0, z: 0, heading: 0, done: true }
  if (p.length === 1) return { x: p[0][0], z: p[0][1], heading: 0, done: true }

  let acc = 0
  for (let i = 1; i < p.length; i++) {
    const dx = p[i][0] - p[i - 1][0]
    const dz = p[i][1] - p[i - 1][1]
    const seg = Math.hypot(dx, dz)
    if (acc + seg >= s || i === p.length - 1) {
      const t = seg > 0 ? Math.min(1, (s - acc) / seg) : 1
      return {
        x: p[i - 1][0] + dx * t,
        z: p[i - 1][1] + dz * t,
        heading: Math.atan2(dx, dz),
        done: i === p.length - 1 && t >= 1,
      }
    }
    acc += seg
  }
  const last = p[p.length - 1]
  return { x: last[0], z: last[1], heading: 0, done: true }
}
