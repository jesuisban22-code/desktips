// Shared by retarget-personnage.mjs: OBJ parsing and small vector maths.
import fs from "fs"

export function parseCharacter(file, firstPart = "bassin") {
  const V = [], N = []
  const parts = []
  let cur = null, on = false
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.split(/\s+/)
    switch (t[0]) {
      case "v":  V.push([+t[1], +t[2], +t[3]]); break
      case "vn": N.push([+t[1], +t[2], +t[3]]); break
      case "o":
        if (t[1] === firstPart) on = true
        cur = on ? { name: t[1], mtl: "", faces: [] } : null
        if (cur) parts.push(cur)
        break
      case "usemtl": if (cur) cur.mtl = t[1]; break
      case "f":
        if (!cur) break
        {
          const idx = t.slice(1).filter(Boolean).map(s => { const [v, , n] = s.split("/"); return [+v - 1, n ? +n - 1 : -1] })
          for (let i = 1; i + 1 < idx.length; i++) cur.faces.push(idx[0], idx[i], idx[i + 1])
        }
        break
    }
  }
  // Unique vertices per part.
  for (const p of parts) {
    const map = new Map(); p.pos = []; p.nrm = []; p.idx = []
    for (const [v, n] of p.faces) {
      const k = v + "/" + n
      let i = map.get(k)
      if (i === undefined) { i = p.pos.length; map.set(k, i); p.pos.push(V[v]); p.nrm.push(n >= 0 ? N[n] : [0, 1, 0]) }
      p.idx.push(i)
    }
    delete p.faces
    p.c = centroid(p.pos)
  }
  return parts
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = a => Math.hypot(a[0], a[1], a[2])
export const norm = a => mul(a, 1 / len(a))
export function centroid(pts) { let s = [0, 0, 0]; for (const p of pts) s = add(s, p); return mul(s, 1 / pts.length) }
export function bboxCenter(pts) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
  return mul(add(lo, hi), 0.5)
}
/** Centroid of the points in the far `frac` of the extent along `dir`. */
export function endCap(pts, dir, frac = 0.12) {
  const d = pts.map(p => dot(p, dir)); const hi = Math.max(...d), lo = Math.min(...d)
  const cut = hi - (hi - lo) * frac
  return centroid(pts.filter((_, i) => d[i] >= cut))
}
/** Orthonormal frame from a bone axis Y and a hint for X. Columns X, Y, Z. */
export function frame(y, xHint) {
  const Y = norm(y)
  const X = norm(sub(xHint, mul(Y, dot(xHint, Y))))
  const Z = cross(X, Y)
  return [X, Y, Z]
}
/** World point → frame-local. */
export const toLocal = (F, o, p) => { const d = sub(p, o); return [dot(d, F[0]), dot(d, F[1]), dot(d, F[2])] }
export const dirToLocal = (F, d) => [dot(d, F[0]), dot(d, F[1]), dot(d, F[2])]
