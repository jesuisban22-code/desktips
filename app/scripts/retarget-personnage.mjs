/**
 * retarget-personnage.mjs — turns the sculpted figure in
 * modeles/atelier-personnage.obj into the pieces Character.tsx hangs on
 * its joints.
 *
 * The OBJ is one frozen pose: seated, writing, bent over the page. The room
 * needs a figure that walks, sits, reaches and blinks, so every part is moved
 * into the frame of the joint that carries it, as if that joint were at rest:
 *
 *   1. find the model's own skeleton from its parts (shoulder = deltoid,
 *      wrist = cuff, knee = kneecap, the far end of each limb, …);
 *   2. give each bone a frame — its axis is local -Y, the elbow or knee hinge
 *      is local X, forward is +Z, the same convention as Character.tsx;
 *   3. express each part in its bone's frame and stretch it along the bone so
 *      its length is the app's (D in Character.tsx): the gait, the arm IK and
 *      the seated heights are all worked out from those lengths.
 *
 * Output: src/three/personnage.gen.ts — quantised geometry, merged per joint
 * and material, plus the few joint offsets taken from the model (shoulders).
 *
 *   node scripts/retarget-personnage.mjs
 */

import fs from "fs"
import {
  parseCharacter, centroid, bboxCenter, endCap, frame, toLocal, dirToLocal,
  add, sub, mul, norm, len, cross, dot,
} from "./personnage-lib.mjs"

const SRC = "modeles/atelier-personnage.obj"
const OUT = "src/three/personnage.gen.ts"

// Must match D in Character.tsx.
const D = { upperArm: 0.270, foreArm: 0.245, thigh: 0.420, shin: 0.400, pelvisH: 0.125, chestH: 0.460, neckLen: 0.044, headH: 0.230, footH: 0.075 }

const parts = parseCharacter(SRC)
const side = p => (p.c[0] >= 0 ? 1 : -1)        // model's own "L" is +x
const pick = (re, s) => parts.filter(p => re.test(p.name) && (s === undefined || side(p) === s))
const pts = ps => ps.flatMap(p => p.pos)
const X = [1, 0, 0], Y = [0, 1, 0]
const WORLD = [X, Y, [0, 0, 1]]

// ── The model's skeleton ─────────────────────────────────────────────────────

function limb(s) {
  const S = s > 0 ? "L" : "R"
  const r = n => new RegExp(`^${n}${S}`)
  const wrist = centroid(pts(pick(r("poignet"))))
  const fore  = pts(pick(r("avantbras_m")))
  const foreAxis = norm(sub(centroid(fore), wrist))
  // The far end of the forearm is the SURFACE of the elbow; the joint is a
  // forearm's radius inside it.
  const elbow = sub(endCap(fore, foreAxis), mul(foreAxis, 0.035))
  const shoulder = bboxCenter(pts(pick(r("deltoide"))))
  const tip = centroid(pts(pick(r("ongle"))))

  const knee  = bboxCenter(pts(pick(r("genou"))))
  const thigh = pts(pick(r("cuisse_m")))
  const thighAxis = norm(sub(centroid(thigh), knee))
  const hip   = sub(endCap(thigh, thighAxis), mul(thighAxis, 0.065))
  const shin  = pts(pick(r("tibia")))
  const ankle = endCap(shin, norm(sub(centroid(shin), knee)))
  return { shoulder, elbow, wrist, tip, hip, knee, ankle }
}
const L = { [1]: limb(1), [-1]: limb(-1) }

const neckPts  = pts(pick(/^cou_m/))
const neckBase = endCap(neckPts, [0, -1, 0], 0.15)
const neckTop  = endCap(neckPts, Y, 0.15)
const headC    = bboxCenter(pts(pick(/^tete_m/)))
const eyeMid   = centroid(pts(pick(/^globe/)))
const earMid   = centroid(pts(pick(/^oreille_m/)))

// Hips: upright in the model too, so they keep the world's axes. Placed so the
// model's hip joints land on the app's thigh pivots (±0.078, −0.0375).
const hipMid  = mul(add(L[1].hip, L[-1].hip), 0.5)
const hipsO   = sub(hipMid, [0, -D.pelvisH * 0.30, 0])
const chestO  = add(hipsO, [0, D.pelvisH * 0.44 + 0.030, 0])

// ── Joint frames and how each maps into the app ──────────────────────────────
//
// For a joint: origin in the model (o), frame (F), scale in the joint's local
// axes (s), and where the model's origin lands in the joint (at).

const J = {}
J.hips  = { o: hipsO, F: WORLD, s: [1, 1, 1] }
{
  const F = frame(sub(neckBase, chestO), X)
  const sy = (D.chestH * 0.985) / len(sub(neckBase, chestO))
  J.chest = { o: chestO, F, s: [1, sy, 1] }
}
J.neck = { o: neckBase, F: frame(sub(neckTop, neckBase), X), s: [1, 1, 1] }
{
  // The head is bowed over the page. Its own "forward" is ears → eyes, with
  // the eyes a touch above the ears' centre on an upright head.
  const fwd = norm(sub(eyeMid, earMid))
  const up0 = norm(cross(fwd, X))                 // perpendicular to fwd, in the sagittal plane
  const up = dot(up0, Y) < 0 ? mul(up0, -1) : up0
  const F = frame(up, X)
  // The model's ears sit high, so "ears → eyes" still points at the floor:
  // lifted by HEAD_LIFT, found by eye on the test bench (?debug=chars).
  const HEAD_LIFT = 0.42
  const tilt = Math.atan2(0.02, len(sub(eyeMid, earMid))) - HEAD_LIFT
  const c = Math.cos(tilt), sn = Math.sin(tilt)
  const Yr = add(mul(F[1], c), mul(F[2], -sn)), Zr = add(mul(F[1], sn), mul(F[2], c))
  J.head = { o: headC, F: [F[0], Yr, Zr], s: [1, 1, 1] }
}

for (const s of [1, -1]) {
  const A = s > 0 ? "R" : "L"          // app: x < 0 is "L"
  const l = L[s]
  const up = norm(sub(l.shoulder, l.elbow)), fore = norm(sub(l.wrist, l.elbow))
  const zU = norm(sub(fore, mul(mul(up, -1), dot(fore, mul(up, -1)))))
  const xU = cross(up, zU)
  J[`upperArm${A}`] = { o: l.shoulder, F: [xU, up, zU], s: [1, D.upperArm / len(sub(l.shoulder, l.elbow)), 1] }
  const Fa = frame(sub(l.elbow, l.wrist), xU)
  J[`forearm${A}`] = { o: l.elbow, F: Fa, s: [1, (D.foreArm - 0.014) / len(sub(l.elbow, l.wrist)), 1] }
  J[`hand${A}`] = { o: l.wrist, F: frame(sub(l.wrist, l.tip), Fa[0]), s: [1, 1, 1] }

  J[`thigh${A}`] = { o: l.hip,   F: frame(sub(l.hip, l.knee), X),   s: [1, D.thigh / len(sub(l.hip, l.knee)), 1] }
  J[`shin${A}`]  = { o: l.knee,  F: frame(sub(l.knee, l.ankle), X), s: [1, (D.shin - 0.006) / len(sub(l.knee, l.ankle)), 1] }
  // The foot is flat on the floor in the model: world axes, sole on the app's.
  J[`foot${A}`]  = { o: l.ankle, F: WORLD, s: [1, D.footH / l.ankle[1], 1] }
}

// ── Which part goes on which joint ───────────────────────────────────────────

function jointFor(p) {
  const n = p.name, A = side(p) > 0 ? "R" : "L"
  if (/^(bassin|ceinture|boucle|braguette|poche_arriere|passant)$/.test(n)) return "hips"
  if (/^(ventre|patte_bas|bouton_bas|torse|patte_haut|bouton|poche|rabat|crayon_poche|col_pied|col_pointe)$/.test(n)) return "chest"
  if (/^cou_m$/.test(n)) return "neck"
  if (/^(tete_m|globe|iris|pupille|reflet|paupiere_m|paupiere_inf|sourcil|oreille_m|oreille_bord|oreille_creux|bouche_int|levre_sup|levre_inf|cheveux_m)$/.test(n)) return "head"
  if (/^(deltoide|manche|revers|biceps)[LR]$/.test(n)) return `upperArm${A}`
  if (/^(avantbras_m[LR]|montre_.*|poignet[LR])$/.test(n)) return `forearm${A}`
  if (/^(paume|eminence|dos_main|jointures|phalange|ongle|pouce)/.test(n)) return `hand${A}`
  if (/^cuisse_m[LR]$/.test(n)) return `thigh${A}`
  if (/^(genou|tibia|ourlet|pli)[LR]$/.test(n)) return `shin${A}`
  if (/^(chaussure|bout|semelle|talon|lacet)/.test(n)) return `foot${A}`
  throw new Error("pièce sans articulation : " + n)
}

/** Sub-groups the face animation drives by name (Character.tsx: x<0 is "R"). */
function subFor(p) {
  const S = p.c[0] < 0 ? "R" : "L"
  if (/^(globe|iris|pupille|reflet)$/.test(p.name)) return `eye${S}`
  if (p.name === "sourcil") return `brow${S}`
  if (/^(bouche_int|levre_sup|levre_inf)$/.test(p.name)) return "mouth"
  return null
}

// ── Transform, merge, quantise ───────────────────────────────────────────────

const groups = new Map()     // key joint|sub|mtl → { joint, sub, mtl, pos[], nrm[], idx[] }
const subPts = new Map()     // sub → local points, for its origin

for (const p of parts) {
  const joint = jointFor(p), j = J[joint], sub_ = subFor(p)
  const P = p.pos.map(v => { const l = toLocal(j.F, j.o, v); return [l[0] * j.s[0], l[1] * j.s[1], l[2] * j.s[2]] })
  const N = p.nrm.map(n => { const l = dirToLocal(j.F, n); return norm([l[0] / j.s[0], l[1] / j.s[1], l[2] / j.s[2]]) })
  const key = `${joint}|${sub_ ?? ""}|${p.mtl}`
  let g = groups.get(key)
  if (!g) groups.set(key, g = { joint, sub: sub_, mtl: p.mtl, pos: [], nrm: [], idx: [] })
  const base = g.pos.length
  g.pos.push(...P); g.nrm.push(...N); g.idx.push(...p.idx.map(i => i + base))
  if (sub_) subPts.set(sub_, [...(subPts.get(sub_) ?? []), ...P])
}

const subOrigin = {}
for (const [k, v] of subPts) subOrigin[k] = centroid(v).map(x => +x.toFixed(5))

const posQ = [], nrmQ = [], idxQ = [], meshes = []
let vAt = 0, iAt = 0
for (const g of groups.values()) {
  if (g.pos.length > 65535) throw new Error("trop de sommets : " + g.joint + " " + g.mtl)
  const o = g.sub ? subOrigin[g.sub] : [0, 0, 0]
  const P = g.pos.map(v => sub(v, o))
  const lo = [0, 1, 2].map(i => Math.min(...P.map(v => v[i])))
  const hi = [0, 1, 2].map(i => Math.max(...P.map(v => v[i])))
  const sc = hi.map((h, i) => Math.max(h - lo[i], 1e-6) / 65535)
  for (const v of P) for (let i = 0; i < 3; i++) posQ.push(Math.round((v[i] - lo[i]) / sc[i]) - 32768)
  for (const n of g.nrm) for (let i = 0; i < 3; i++) nrmQ.push(Math.round(n[i] * 127))
  idxQ.push(...g.idx)
  meshes.push({
    joint: g.joint, sub: g.sub, mtl: g.mtl,
    v: [vAt, g.pos.length], i: [iAt, g.idx.length],
    lo: lo.map(x => +x.toFixed(6)), sc: sc.map(x => +x.toExponential(6)),
  })
  vAt += g.pos.length; iAt += g.idx.length
}

const b64 = (Arr, data) => Buffer.from(new Arr(data).buffer).toString("base64")

// Where the arms hang from, in the chest's frame: the model's own shoulders,
// not the old figure's, which were built for a broader chest.
const shoulders = {}
for (const s of [1, -1]) {
  const A = s > 0 ? "R" : "L"
  const l = toLocal(J.chest.F, J.chest.o, L[s].shoulder)
  shoulders[A] = [l[0], l[1] * J.chest.s[1], l[2]].map(x => +x.toFixed(4))
}

const out = `// GENERATED by scripts/retarget-personnage.mjs from modeles/atelier-personnage.obj.
// Do not edit: change the model or the script, and run it again.

export interface PersoMesh {
  joint: string
  /** A named group inside the joint the face animation drives (eyeL, browR, mouth). */
  sub:   string | null
  /** The material's name in the model's .mtl. */
  mtl:   string
  /** [first vertex, count], [first index, count]. */
  v:     [number, number]
  i:     [number, number]
  /** Dequantisation: position = lo + (q + 32768) * sc. */
  lo:    [number, number, number]
  sc:    [number, number, number]
}

/** Upper-arm pivots in the chest's frame, where the model's shoulders are. */
export const SHOULDERS = ${JSON.stringify(shoulders)} as const
/** The head's pivot in the neck's frame, where the model's skull sits. */
export const HEAD_AT = ${JSON.stringify(toLocal(J.neck.F, J.neck.o, headC).map(x => +x.toFixed(4)))} as const
/** Origins of the face's sub-groups in the head's frame. */
export const SUB_ORIGIN: Record<string, [number, number, number]> = ${JSON.stringify(subOrigin)}
export const MESHES: PersoMesh[] = ${JSON.stringify(meshes)}
export const POS = "${b64(Int16Array, posQ)}"
export const NRM = "${b64(Int8Array, nrmQ)}"
export const IDX = "${b64(Uint16Array, idxQ)}"
`
fs.writeFileSync(OUT, out)
console.log(`${OUT}: ${meshes.length} maillages, ${vAt} sommets, ${iAt / 3} triangles, ${(out.length / 1024).toFixed(0)} Ko`)
console.log("épaules", shoulders)
