/**
 * Scene-wide geometry audit.
 *   node scripts/audit.mjs <url> [--only Name] [--json out.json]
 *
 * Reads the live three.js graph instead of a transcription, then looks for the
 * four things that actually read as "badly made" on screen:
 *
 *   PIERCE   a part crosses clean through a thin panel and comes out the far
 *            side, inside that panel's footprint (the drafting-table bug)
 *   PROUD    a part breaks the plane of a panel's visible face without going
 *            all the way through — a post poking out of a tabletop
 *   FLOAT    a part with nothing under it and no overlap with anything
 *   SUNK     a part below the floor
 *   FACET    round geometry whose facet chord is coarse enough to read as
 *            polygonal at room scale
 *
 * Joinery — a tenon buried in a mortise — is deliberately NOT reported: every
 * leg meets every rail, and drowning the real faults in 400 lines of legitimate
 * overlap is how they get missed.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const url = process.argv[2] ?? 'http://localhost:4399/'
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const p = await b.newPage({ viewport: { width: 900, height: 700 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
const sep = url.includes('?') ? '&' : '?'
await p.goto(`${url}${sep}audit=1`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForFunction(() => !!window.__scene, null, { timeout: 60000 })
await p.waitForTimeout(4000)

const parts = await p.evaluate(() => {
  const scene = window.__scene
  scene.updateMatrixWorld(true)
  const out = []
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return
    const g = o.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    const bb = g.boundingBox
    if (!bb) return
    // nearest named ancestor gives a human label
    let owner = '?', n = o
    while (n) { if (n.name) { owner = n.name; break } n = n.parent }
    const pos = g.attributes.position
    // facet chord: widest gap between adjacent vertices around the silhouette
    let chord = 0
    const type = g.type
    if (/Lathe|Cylinder|Sphere|Torus|Circle|Cone/.test(type)) {
      const p0 = g.parameters ?? {}
      const r = Math.max(p0.radius ?? 0, p0.radiusTop ?? 0, p0.radiusBottom ?? 0, 0)
      let seg = type === 'TorusGeometry'
        ? (p0.tubularSegments ?? 0)
        : (p0.radialSegments ?? p0.segments ?? p0.widthSegments ?? 0)
      let rr = r
      if (type === 'LatheGeometry') {
        seg = p0.segments ?? 0
        rr = 0
        for (const pt of (p0.points ?? [])) rr = Math.max(rr, pt.x)
      }
      const sc = Math.max(...o.getWorldScale(new window.__THREE_V3()).toArray().map(Math.abs))
      if (seg > 0 && rr > 0) chord = (2 * Math.PI * rr * sc) / seg
    }
    out.push({
      owner, type,
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
      m: o.matrixWorld.elements.slice(),
      chord,
      vis: o.visible,
      tri: pos ? pos.count : 0,
    })
  })
  return out
})
await b.close()
console.log(`page errors: ${errs.length}  meshes: ${parts.length}`)

// ── OBB helpers ──────────────────────────────────────────────────────────────
const V = (x, y, z) => ({ x, y, z })
function xf(m, v) {
  return V(
    m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
    m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
    m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
  )
}
function axis(m, i) {
  const a = V(m[i * 4], m[i * 4 + 1], m[i * 4 + 2])
  const L = Math.hypot(a.x, a.y, a.z) || 1
  return { v: V(a.x / L, a.y / L, a.z / L), s: L }
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)

/** Is this point buried inside that part? Used to tell a tenon (hidden inside
 *  the piece it joins) from a member that actually breaks a visible surface. */
function inside(pt, q, slack = 0.002) {
  const d = sub(pt, q.C)
  for (let i = 0; i < 3; i++) if (Math.abs(dot(d, q.A[i])) > q.h[i] + slack) return false
  return true
}

for (const q of parts) {
  const c = V((q.min[0] + q.max[0]) / 2, (q.min[1] + q.max[1]) / 2, (q.min[2] + q.max[2]) / 2)
  q.C = xf(q.m, c)
  const ax = axis(q.m, 0), ay = axis(q.m, 1), az = axis(q.m, 2)
  q.A = [ax.v, ay.v, az.v]
  q.h = [
    ((q.max[0] - q.min[0]) / 2) * ax.s,
    ((q.max[1] - q.min[1]) / 2) * ay.s,
    ((q.max[2] - q.min[2]) / 2) * az.s,
  ]
  q.corners = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    q.corners.push(V(
      q.C.x + q.A[0].x * q.h[0] * sx + q.A[1].x * q.h[1] * sy + q.A[2].x * q.h[2] * sz,
      q.C.y + q.A[0].y * q.h[0] * sx + q.A[1].y * q.h[1] * sy + q.A[2].y * q.h[2] * sz,
      q.C.z + q.A[0].z * q.h[0] * sx + q.A[1].z * q.h[1] * sy + q.A[2].z * q.h[2] * sz,
    ))
  }
  q.aabb = { lo: V(Infinity, Infinity, Infinity), hi: V(-Infinity, -Infinity, -Infinity) }
  for (const k of q.corners) {
    q.aabb.lo.x = Math.min(q.aabb.lo.x, k.x); q.aabb.hi.x = Math.max(q.aabb.hi.x, k.x)
    q.aabb.lo.y = Math.min(q.aabb.lo.y, k.y); q.aabb.hi.y = Math.max(q.aabb.hi.y, k.y)
    q.aabb.lo.z = Math.min(q.aabb.lo.z, k.z); q.aabb.hi.z = Math.max(q.aabb.hi.z, k.z)
  }
}

const live = parts.filter(q => q.vis && q.h.every(v => v > 0.0002))
const findings = []
const box = q => `[${q.aabb.lo.x.toFixed(2)}..${q.aabb.hi.x.toFixed(2)} x, ` +
  `${q.aabb.lo.y.toFixed(2)}..${q.aabb.hi.y.toFixed(2)} y, ` +
  `${q.aabb.lo.z.toFixed(2)}..${q.aabb.hi.z.toFixed(2)} z]`
const add = (kind, owner, detail, mm = 0, where = '') => findings.push({ kind, owner, detail, mm, where })

// ── PIERCE / PROUD ───────────────────────────────────────────────────────────
// A panel: thin in one axis, broad in the other two. Only two verdicts are
// worth reporting. PIERCE — a part crosses clean through and comes out the far
// side. PROUD — a part whose bulk is under a roughly horizontal panel pokes up
// out of its working face. Everything else (a tenon in a mortise, a leg passing
// below a top) is how furniture is built and is deliberately not reported.
const PANEL_T = 0.075, PANEL_W = 0.22
for (const pan of live) {
  if (pan.owner === 'Room') continue
  const i = pan.h.indexOf(Math.min(...pan.h))
  const t = pan.h[i], o1 = pan.h[(i + 1) % 3], o2 = pan.h[(i + 2) % 3]
  if (t > PANEL_T / 2 || o1 < PANEL_W || o2 < PANEL_W) continue
  const n = pan.A[i], u = pan.A[(i + 1) % 3], v = pan.A[(i + 2) % 3]
  const dn = dot(n, pan.C), du = dot(u, pan.C), dv = dot(v, pan.C)
  const upSign = n.y > 0.55 ? 1 : n.y < -0.55 ? -1 : 0   // 0 = a vertical panel
  for (const q of live) {
    if (q === pan || q.owner !== pan.owner) continue
    if (q.aabb.hi.x < pan.aabb.lo.x || q.aabb.lo.x > pan.aabb.hi.x) continue
    if (q.aabb.hi.y < pan.aabb.lo.y || q.aabb.lo.y > pan.aabb.hi.y) continue
    if (q.aabb.hi.z < pan.aabb.lo.z || q.aabb.lo.z > pan.aabb.hi.z) continue
    let above = 0, below = 0, hiIn = -Infinity, loIn = Infinity, inCount = 0
    const tips = { up: [], down: [] }
    for (const k of q.corners) {
      const cu = Math.abs(dot(u, k) - du), cv = Math.abs(dot(v, k) - dv)
      if (cu > o1 - 0.004 || cv > o2 - 0.004) continue
      inCount++
      const h = dot(n, k) - dn
      hiIn = Math.max(hiIn, h); loIn = Math.min(loIn, h)
      if (h > t) { above++; tips.up.push(k) }
      if (h < -t) { below++; tips.down.push(k) }
    }
    if (!inCount) continue
    // A tenon crosses its rail and is then swallowed by the piece above. That
    // is joinery, not a fault, so a protrusion whose every corner is buried
    // inside another solid does not count.
    const buried = ts => ts.length > 0 && ts.every(k =>
      live.some(r => r !== q && r !== pan && inside(k, r)))
    const upHidden = buried(tips.up), downHidden = buried(tips.down)
    if (above && below && upHidden && downHidden) continue
    if (above && below && (upHidden || downHidden)) continue
    if (above && below) {
      add('PIERCE', pan.owner, `${q.type} crosses clean through a ${(t * 2000) | 0} mm panel`,
        Math.min(hiIn - t, -loIn - t) * 1000, `part ${box(q)} panel ${box(pan)}`)
      continue
    }
    if (!upSign) continue
    if (upSign > 0 ? upHidden : downHidden) continue
    const hC = (dot(n, q.C) - dn) * upSign
    const out = (upSign > 0 ? hiIn - t : -loIn - t)
    if (hC < -t && out > 0.004) {
      add('PROUD', pan.owner, `${q.type} pokes up out of the working face`, out * 1000, `part ${box(q)} panel ${box(pan)}`)
    }
  }
}

// ── FLOAT / SUNK ─────────────────────────────────────────────────────────────
// A part floats only if nothing at all is near it — a stretcher is held by its
// legs sideways, not from below, so a purely downward support test is wrong.
for (const q of live) {
  if (q.owner === 'Room') continue
  if (q.aabb.hi.y < -0.006) { add('SUNK', q.owner, `${q.type} is entirely below the floor`, -q.aabb.hi.y * 1000); continue }
  if (q.aabb.lo.y < -0.012 && q.aabb.hi.y > 0.02) add('SUNK', q.owner, `${q.type} dips through the floor`, -q.aabb.lo.y * 1000)
  if (q.aabb.lo.y < 0.02) continue
  if (Math.max(...q.h) < 0.03) continue
  const G = 0.018
  let touched = false
  for (const r of live) {
    if (r === q || r.owner === 'Room') continue
    if (r.aabb.hi.x < q.aabb.lo.x - G || r.aabb.lo.x > q.aabb.hi.x + G) continue
    if (r.aabb.hi.y < q.aabb.lo.y - G || r.aabb.lo.y > q.aabb.hi.y + G) continue
    if (r.aabb.hi.z < q.aabb.lo.z - G || r.aabb.lo.z > q.aabb.hi.z + G) continue
    touched = true; break
  }
  const nearWall = Math.abs(Math.abs(q.C.x) - 5.6) < 0.4 || Math.abs(Math.abs(q.C.z) - 5.6) < 0.4
  if (!touched && !nearWall) add('FLOAT', q.owner, `${q.type} at y ${q.aabb.lo.y.toFixed(3)} touches nothing`, 0)
}

// ── FACET ────────────────────────────────────────────────────────────────────
for (const q of live) if (q.chord > 0.030) add('FACET', q.owner, `${q.type} facet chord ${(q.chord * 1000) | 0} mm`, q.chord * 1000, box(q))

// ── report ───────────────────────────────────────────────────────────────────
const byOwner = new Map()
for (const f of findings) {
  if (only && f.owner !== only) continue
  if (!byOwner.has(f.owner)) byOwner.set(f.owner, [])
  byOwner.get(f.owner).push(f)
}
const order = ['PIERCE', 'PROUD', 'SUNK', 'FLOAT', 'FACET']
let total = 0
for (const [owner, list] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
  // collapse identical findings
  const seen = new Map()
  for (const f of list) {
    const k = `${f.kind}|${f.detail.replace(/\d+/g, '#')}`
    const e = seen.get(k)
    if (!e || f.mm > e.mm) seen.set(k, { ...f, n: (e?.n ?? 0) + 1 })
    else e.n++
  }
  const rows = [...seen.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.mm - a.mm)
  total += rows.length
  console.log(`\n${owner}`)
  for (const r of rows) {
    console.log(`  ${r.kind.padEnd(7)} ${r.mm ? String(Math.round(r.mm)).padStart(4) + ' mm  ' : '         '}${r.detail}${r.n > 1 ? `  (×${r.n})` : ''}`)
    if (r.where) console.log(`          ${r.where}`)
  }
}
console.log(`\n${total} distinct findings across ${byOwner.size} objects`)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(findings, null, 1))
