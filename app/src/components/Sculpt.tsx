/**
 * Sculpt.tsx — the sculpted figure's pieces, hung on Character.tsx's joints.
 *
 * The geometry comes from modeles/atelier-personnage.obj, already moved
 * into each joint's frame by scripts/retarget-personnage.mjs. Here it is only
 * decoded (once, shared by every figure in the room) and dressed: the shirt,
 * skin and hair take each agent's own colours, so the figures still tell apart
 * at a glance; everything else keeps the model's material.
 */

import * as THREE from "three"
import { M } from "../three/materials"
import { MESHES, POS, NRM, IDX, SUB_ORIGIN, type PersoMesh } from "../three/personnage.gen"

function bytes(b64: string): ArrayBuffer {
  const s = atob(b64)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u.buffer
}

let decoded: { pos: Int16Array; nrm: Int8Array; idx: Uint16Array } | null = null
const geoms = new Map<PersoMesh, THREE.BufferGeometry>()

function geometryOf(m: PersoMesh): THREE.BufferGeometry {
  let g = geoms.get(m)
  if (g) return g
  decoded ??= { pos: new Int16Array(bytes(POS)), nrm: new Int8Array(bytes(NRM)), idx: new Uint16Array(bytes(IDX)) }
  const [v0, vn] = m.v, [i0, iN] = m.i
  const pos = new Float32Array(vn * 3), nrm = new Float32Array(vn * 3)
  for (let k = 0; k < vn * 3; k++) {
    const a = k % 3
    pos[k] = m.lo[a] + (decoded.pos[v0 * 3 + k] + 32768) * m.sc[a]
    nrm[k] = decoded.nrm[v0 * 3 + k] / 127
  }
  g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3))
  g.setIndex(new THREE.BufferAttribute(decoded.idx.slice(i0, i0 + iN), 1))
  g.computeBoundingSphere()
  geoms.set(m, g)
  return g
}

/** Colours from the model's .mtl, for what no agent varies. Linear RGB. */
const KD: Record<string, [number, number, number, number]> = {
  boutons:          [0.8632, 0.8148, 0.7231, 0.40],
  pantalon_couture: [0.0328, 0.0396, 0.0602, 0.86],
  laiton:           [0.5841, 0.3712, 0.1119, 0.35],
  bracelet:         [0.0437, 0.0194, 0.0091, 0.55],
  cadran:           [0.9047, 0.8632, 0.7758, 0.30],
  pupille:          [0.0044, 0.0030, 0.0024, 0.20],
  levres:           [0.4793, 0.1441, 0.1070, 0.60],
  lacets:           [0.0232, 0.0144, 0.0103, 0.80],
  peau_ombre:       [0.6388, 0.3647, 0.2203, 0.80],
}
const own = new Map<string, THREE.Material>()
function ownMaterial(name: string): THREE.Material {
  let m = own.get(name)
  if (!m) {
    const [r, g, b, rough] = KD[name] ?? [0.5, 0.5, 0.5, 0.8]
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(r, g, b), roughness: rough })
    if (name === "laiton") (m as THREE.MeshStandardMaterial).metalness = 0.6
    own.set(name, m)
  }
  return m
}

export interface Dress { shirt: string; skin: THREE.Material; hair: THREE.Material }

function materialFor(mtl: string, d: Dress): THREE.Material {
  switch (mtl) {
    case "chemise":     return M.shirt(d.shirt)
    case "chemise_col": return M.shirtPlacket(d.shirt)
    case "pantalon":    return M.denim()
    case "ceinture":    return M.belt()
    case "peau":        return d.skin
    case "cheveux":     return d.hair
    case "oeil_blanc":  return M.eyeWhite()
    case "iris":        return M.eye()
    case "bouche":      return M.mouth()
    case "chaussure":   return M.shoe()
    case "semelle":     return M.shoeSole()
    default:            return ownMaterial(mtl)
  }
}

const BY_JOINT = new Map<string, PersoMesh[]>()
for (const m of MESHES) BY_JOINT.set(m.joint, [...(BY_JOINT.get(m.joint) ?? []), m])

/** Tiny pieces cast no shadow worth the cost: eyes, buttons, laces, the mouth. */
const NO_SHADOW = new Set(["oeil_blanc", "iris", "pupille", "boutons", "lacets", "bouche", "levres", "cadran", "bracelet", "laiton"])

/**
 * Everything the model hangs on one joint. The shirt on the chest is named
 * "torso" (the breathing), and the face's parts sit in groups named for the
 * blink, the brows and the mouth.
 */
export function SculptParts({ joint, dress }: { joint: string; dress: Dress }) {
  const list = BY_JOINT.get(joint) ?? []
  const loose = list.filter(m => !m.sub)
  const subs = [...new Set(list.filter(m => m.sub).map(m => m.sub!))]
  return (
    <>
      {loose.map((m, i) => (
        <mesh
          key={i}
          name={joint === "chest" && m.mtl === "chemise" ? "torso" : undefined}
          geometry={geometryOf(m)}
          material={materialFor(m.mtl, dress)}
          castShadow={!NO_SHADOW.has(m.mtl)}
        />
      ))}
      {subs.map(s => (
        <group key={s} name={s} position={SUB_ORIGIN[s]}>
          {list.filter(m => m.sub === s).map((m, i) => (
            <mesh key={i} geometry={geometryOf(m)} material={materialFor(m.mtl, dress)} />
          ))}
        </group>
      ))}
    </>
  )
}
