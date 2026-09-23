/**
 * Character.tsx — the people who work in the atelier.
 *
 * A figure 1.72 m tall, facing +Z by default. Its body is the sculpted model
 * in modeles/atelier-personnage.obj (see Sculpt.tsx and
 * scripts/retarget-personnage.mjs); this file owns the skeleton it hangs on —
 * the joints, their pivots and the poses — which every animation drives.
 *
 * Joint hierarchy — a later phase animates walking and folder handoffs, so the
 * pivots are real and every group is named for getObjectByName():
 *
 *   root → hips → spine → chest → neck → head
 *                   ├─ shoulderL → upperArmL → forearmL → handL
 *                   └─ shoulderR → upperArmR → forearmR → handR
 *          ├─ thighL → shinL → footL
 *          └─ thighR → shinR → footR
 */

import { forwardRef, useMemo } from "react"
import * as THREE from "three"
import { chamfer, rng, jitter } from "../three/kit"
import { M } from "../three/materials"
import { SculptParts, type Dress } from "./Sculpt"
import { SHOULDERS, HEAD_AT } from "../three/personnage.gen"
import { PAL } from "../three/palette"

// ── Dimensions (metres) ──────────────────────────────────────────────────────
//
// Stacked so the total is exactly 1.72:
//   shoe 0.075 · shin 0.400 · thigh 0.420 · pelvis 0.125
//   chest 0.360 · neck 0.060 · head 0.240 ≈ 1.68 + hair

export const D = {
  hipY:       0.895,

  pelvisW:    0.300, pelvisH: 0.125, pelvisD: 0.190,

  // Torso height is load-bearing for the whole figure. At 0.360 the stack
  // came to 1.52 m, not 1.72 — which is why the head read as oversized and
  // the body as stocky. 0.460 puts the shoulders at 1.38 and the crown at
  // 1.72, and drops the fingertips to mid-thigh where they belong.
  chestH:     0.460, chestW:  0.320, chestD:  0.196,

  shoulderX:  0.160,
  deltoidW:   0.108, deltoidH: 0.112, deltoidD: 0.170,

  upperArm:   0.270, upperArmW: 0.098,
  foreArm:    0.245, foreArmW:  0.086,
  handLen:    0.115, handW: 0.088, handD: 0.050,

  neckLen:    0.044, neckR: 0.058,
  headW:      0.166, headH: 0.230, headD: 0.192,

  thigh:      0.420, thighW: 0.135,
  shin:       0.400, shinW:  0.108,
  footLen:    0.250, footH:  0.075, footW: 0.100,
} as const

// ── Props ────────────────────────────────────────────────────────────────────

export type Pose = "idle" | "thinking" | "writing" | "carrying" | "walking"

/** Every joint the animation layer may drive, by name. */
export const JOINT_NAMES = [
  "spine", "chest", "neck", "head",
  "shoulderL", "upperArmL", "forearmL", "handL",
  "shoulderR", "upperArmR", "forearmR", "handR",
  "thighL", "shinL", "footL",
  "thighR", "shinR", "footR",
] as const

export interface CharacterProps {
  position?:   [number, number, number]
  rotation?:   [number, number, number]
  shirtColor?: string
  hairStyle?:  0 | 1 | 2
  skinTone?:   string
  seated?:     boolean
  pose?:       Pose
  seed?:       number
  accessory?:  Accessory
}

// ── Pose tables ──────────────────────────────────────────────────────────────
//
// Euler XYZ, radians. A limb hangs along -Y, so rotation about +X swings it
// toward -Z: FORWARD IS NEGATIVE X.

export type Joint =
  | "spine" | "chest" | "neck" | "head"
  | "shoulderL" | "upperArmL" | "forearmL" | "handL"
  | "shoulderR" | "upperArmR" | "forearmR" | "handR"
  | "thighL" | "shinL" | "footL"
  | "thighR" | "shinR" | "footR"

export type PoseMap = Partial<Record<Joint, [number, number, number]>>

export const POSES: Record<Pose, PoseMap> = {
  idle: {
    spine:     [ 0.02,  0.03,  0.00],
    chest:     [ 0.00, -0.02,  0.00],
    head:      [ 0.02,  0.07,  0.01],
    upperArmL: [ 0.04,  0.00,  0.10],
    forearmL:  [-0.34,  0.00,  0.04],
    upperArmR: [ 0.09,  0.00, -0.08],
    forearmR:  [-0.29,  0.00, -0.03],
    thighL:    [-0.02,  0.00,  0.015],
    thighR:    [ 0.03,  0.00, -0.015],
    shinR:     [-0.05,  0.00,  0.00],
  },

  thinking: {
    spine:     [ 0.04, -0.05,  0.00],
    chest:     [ 0.02,  0.00,  0.00],
    neck:      [-0.08,  0.00,  0.00],
    head:      [ 0.20, -0.17,  0.07],
    shoulderR: [ 0.00, -0.38,  0.00],
    upperArmR: [-0.88,  0.00,  0.00],
    forearmR:  [-2.52,  0.00,  0.00],
    handR:     [-0.10,  0.00,  0.00],
    // The free arm hangs. It used to be posed out in front at hip height,
    // which read as a broken limb from every angle; a relaxed arm never does,
    // and it keeps all the attention on the hand at the chin.
    upperArmL: [-0.12,  0.00,  0.13],
    forearmL:  [-0.34,  0.00,  0.05],
    handL:     [-0.06,  0.00,  0.02],
    thighL:    [-0.03,  0.00,  0.015],
    thighR:    [ 0.02,  0.00, -0.015],
  },

  writing: {
    spine:     [-0.20,  0.06,  0.00],
    chest:     [-0.06,  0.04,  0.00],
    neck:      [-0.12,  0.00,  0.00],
    head:      [ 0.32, -0.06,  0.00],
    upperArmR: [-0.80, -0.22, -0.16],
    forearmR:  [-0.86,  0.46,  0.10],
    handR:     [-0.16,  0.00,  0.06],
    upperArmL: [-0.64,  0.28,  0.22],
    forearmL:  [-0.78, -0.32, -0.08],
    handL:     [-0.12,  0.00, -0.04],
  },

  carrying: {
    // Elbows in at the waist, forearms tilted UP about 15°, hands turned in.
    // The old pose held both forearms dead level like a waiter's tray, and the
    // folder stack was authored 130 mm lower still, so it floated under the
    // hands instead of resting in them.
    spine:     [ 0.05,  0.00,  0.00],
    head:      [ 0.06,  0.00,  0.00],
    upperArmL: [-0.35,  0.10,  0.17],
    forearmL:  [-1.50, -0.26, -0.20],
    handL:     [ 0.10, -0.10, -0.22],
    upperArmR: [-0.35, -0.10, -0.17],
    forearmR:  [-1.50,  0.26,  0.20],
    handR:     [ 0.10,  0.10,  0.22],
  },

  walking: {
    spine:     [ 0.04,  0.08,  0.00],
    chest:     [ 0.00, -0.12,  0.00],
    head:      [ 0.02,  0.04,  0.00],
    upperArmL: [-0.50,  0.00,  0.08],
    forearmL:  [-0.36,  0.00,  0.00],
    upperArmR: [ 0.44,  0.00, -0.08],
    forearmR:  [-0.24,  0.00,  0.00],
    thighL:    [-0.46,  0.00,  0.015],
    shinL:     [-0.12,  0.00,  0.00],
    footL:     [ 0.18,  0.00,  0.00],
    thighR:    [ 0.34,  0.00, -0.015],
    shinR:     [-0.62,  0.00,  0.00],
    footR:     [ 0.40,  0.00,  0.00],
  },
}

/** Thighs horizontal, shins vertical — composed over the active pose. */
export const SEATED: PoseMap = {
  thighL: [-1.50,  0.00,  0.04],
  shinL:  [ 1.46,  0.00,  0.00],
  footL:  [ 0.04,  0.00,  0.00],
  thighR: [-1.50,  0.00, -0.04],
  shinR:  [ 1.46,  0.00,  0.00],
  footR:  [ 0.04,  0.00,  0.00],
}

function rot(map: PoseMap, j: Joint): [number, number, number] {
  return map[j] ?? [0, 0, 0]
}

// ── Arm ──────────────────────────────────────────────────────────────────────

function Arm({ side, map, dress }: { side: 1 | -1; map: PoseMap; dress: Dress }) {
  const S  = side === -1 ? "L" : "R"
  const sh = `shoulder${S}` as Joint
  const ua = `upperArm${S}` as Joint
  const fa = `forearm${S}`  as Joint
  const hd = `hand${S}`     as Joint

  return (
    <group name={sh} position={SHOULDERS[S]} rotation={rot(map, sh)}>
      <group name={ua} rotation={rot(map, ua)}>
        <SculptParts joint={ua} dress={dress} />
        <group name={fa} position={[0, -D.upperArm, 0]} rotation={rot(map, fa)}>
          <SculptParts joint={fa} dress={dress} />
          <group name={hd} position={[0, -D.foreArm + 0.014, 0]} rotation={rot(map, hd)}>
            <SculptParts joint={hd} dress={dress} />
          </group>
        </group>
      </group>
    </group>
  )
}

// ── Leg ──────────────────────────────────────────────────────────────────────

function Leg({ side, map, dress }: { side: 1 | -1; map: PoseMap; dress: Dress }) {
  const S  = side === -1 ? "L" : "R"
  const th = `thigh${S}` as Joint
  const sn = `shin${S}`  as Joint
  const ft = `foot${S}`  as Joint

  return (
    <group name={th} position={[side * 0.078, -D.pelvisH * 0.30, 0]} rotation={rot(map, th)}>
      <SculptParts joint={th} dress={dress} />
      <group name={sn} position={[0, -D.thigh, 0]} rotation={rot(map, sn)}>
        <SculptParts joint={sn} dress={dress} />
        <group name={ft} position={[0, -D.shin + 0.006, 0]} rotation={rot(map, ft)}>
          <SculptParts joint={ft} dress={dress} />
        </group>
      </group>
    </group>
  )
}

// ── Head ─────────────────────────────────────────────────────────────────────

/** Five hair colours, by seed: at room scale, hair and skin are what tell the
 *  figures apart before their shirts do. */
const HAIR_TONES = ["#3a2a20", "#171312", "#6b3a22", "#8a6a3e", "#5f5b57"] as const
function hairFor(seed: number): THREE.Material {
  if (seed % 5 === 0) return M.hair()
  return M.hairTone(HAIR_TONES[seed % HAIR_TONES.length])
}

/** What a figure wears on its head besides hair. */
export type Accessory = 0 | 1 | 2 | 3    // none, glasses, headphones, pencil behind the ear

function Head({
  map, dress, seed, accessory = 0,
}: {
  map: PoseMap; dress: Dress; seed: number; accessory?: Accessory
}) {
  const r    = useMemo(() => rng(seed + 91), [seed])
  const tilt = useMemo(() => jitter(r, 0.035), [r])

  return (
    <group
      name="head"
      position={HEAD_AT}
      rotation={[
        rot(map, "head")[0],
        rot(map, "head")[1] + tilt,
        rot(map, "head")[2] + tilt * 0.3,
      ]}
    >
      {/* Skull, face, ears and hair from the sculpted model. The eyes, brows
          and mouth come in groups named for the animation (blink, frown,
          talk). */}
      <SculptParts joint="head" dress={dress} />
      <HeadAccessory kind={accessory} seed={seed} />
    </group>
  )
}

/** One spectacle rim: a rounded rectangle with a hole, a few millimetres deep. */
let rim: THREE.BufferGeometry | null = null
function rimGeometry(): THREE.BufferGeometry {
  if (rim) return rim
  const rr = (s: THREE.Shape | THREE.Path, w: number, h: number, r: number) => {
    s.moveTo(-w / 2 + r, -h / 2)
    s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
    s.lineTo(w / 2, h / 2 - r);  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
    s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
    s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  }
  const outer = new THREE.Shape()
  rr(outer, 0.050, 0.035, 0.010)
  const hole = new THREE.Path()
  rr(hole, 0.041, 0.026, 0.007)
  outer.holes.push(hole)
  rim = new THREE.ExtrudeGeometry(outer, { depth: 0.004, bevelEnabled: false, curveSegments: 3 })
  rim.translate(0, 0, -0.002)
  return rim
}

/**
 * Glasses, headphones, or a pencil tucked behind an ear. A few pieces each,
 * so a room of four figures is four people and not one person four times.
 */
function HeadAccessory({ kind, seed }: { kind: Accessory; seed: number }) {
  if (kind === 1) {
    // Glasses: two rims — rings, not plates, or they read as sunglasses and
    // hide the eyes — a bridge, and the arms back to the ears.
    const z = D.headD * 0.505
    return (
      <group>
        {[-1, 1].map(s => (
          <group key={s} position={[s * 0.043, 0.024, z]}>
            <mesh geometry={rimGeometry()} material={M.frame()} />
            <mesh geometry={chamfer(0.040, 0.026, 0.002, 0.001)} material={M.lens()} position={[0, 0, 0.001]} />
          </group>
        ))}
        <mesh geometry={chamfer(0.022, 0.006, 0.006, 0.002)} material={M.frame()} position={[0, 0.030, z]} />
        {[-1, 1].map(s => (
          <mesh key={`a${s}`} geometry={chamfer(0.006, 0.006, D.headD * 0.50, 0.002)} material={M.frame()}
                position={[s * D.headW * 0.505, 0.028, D.headD * 0.24]} />
        ))}
      </group>
    )
  }
  if (kind === 2) {
    // Headphones: a band over the crown and two cups over the ears.
    return (
      <group>
        <mesh position={[0, 0.030, -0.004]} material={M.frame()} castShadow>
          <torusGeometry args={[D.headW * 0.60, 0.010, 6, 18, Math.PI]} />
        </mesh>
        {[-1, 1].map(s => (
          <mesh key={s} geometry={chamfer(0.030, 0.064, 0.058, 0.014)} material={M.frame()}
                position={[s * D.headW * 0.56, 0.004, -0.004]} castShadow />
        ))}
      </group>
    )
  }
  if (kind === 3) {
    // A pencil behind the right ear, point forward.
    const woods = ["#c98f4e", "#d4a668", "#9a6b3f"]
    return (
      <group position={[-D.headW * 0.53, 0.046, 0.010]} rotation={[Math.PI / 2 - 0.25, 0, 0.18]}>
        <mesh material={M.pencil(woods[seed % woods.length])}>
          <cylinderGeometry args={[0.0048, 0.0048, 0.150, 6]} />
        </mesh>
        <mesh material={M.pencilTip()} position={[0, 0.082, 0]}>
          <coneGeometry args={[0.0048, 0.016, 6]} />
        </mesh>
      </group>
    )
  }
  return null
}

// ── The figure ───────────────────────────────────────────────────────────────

/** Hip height standing. */
export const HIP_Y = 0.895

/**
 * Where the hips go when the figure sits.
 *
 * Not a guess. With the thighs at SEATED's -1.50 and the shins at +1.46, the
 * sole ends up exactly 0.5044 below the thigh pivot, and the thigh pivot is
 * 0.0375 below the hips. So hips at 0.5419 put the soles on the floor — and
 * the previous 0.505 put them 37 mm THROUGH it, which is the sort of thing
 * nobody sees and everybody feels.
 */
export const SEATED_HIP_Y  = 0.5419
export const SEATED_ROOT_Y = SEATED_HIP_Y - 0.895

/**
 * And back, onto the seat. The figure used to sit at the very front edge of
 * the chair with a hand's width of empty seat behind it, because the station's
 * stand point is where you STAND to use a chair, not where your hips end up
 * once you are in it.
 */
export const SEATED_ROOT_Z = -0.125

export const Character = forwardRef<THREE.Group, CharacterProps>(function Character(
  {
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    shirtColor = PAL.agentMain,
    hairStyle = 0,
    skinTone,
    seated = false,
    pose = "idle",
    seed = 1,
    accessory = 0,
  },
  ref,
) {
  const map = useMemo<PoseMap>(
    () => (seated ? { ...POSES[pose], ...SEATED } : POSES[pose]),
    [pose, seated],
  )

  const r         = useMemo(() => rng(seed), [seed])
  const scaleJit  = useMemo(() => 1 + jitter(r, 0.016), [r])
  const yawJit    = useMemo(() => jitter(r, 0.045), [r])

  const skin  = skinTone ? M.skinTone(skinTone) : M.skin()
  const dress = useMemo<Dress>(
    () => ({ shirt: shirtColor, skin, hair: hairFor(seed) }),
    [shirtColor, skin, seed],
  )

  const rootY = seated ? SEATED_ROOT_Y : 0
  const rootZ = seated ? SEATED_ROOT_Z : 0

  return (
    <group
      ref={ref}
      position={position}
      rotation={[rotation[0], rotation[1] + yawJit, rotation[2]]}
      scale={scaleJit}
    >
      <group name="bodyRoot" position={[0, rootY, rootZ]}>
        <group name="hips" position={[0, D.hipY, 0]}>
          <SculptParts joint="hips" dress={dress} />

          <group name="spine" position={[0, D.pelvisH * 0.44, 0]} rotation={rot(map, "spine")}>
            <group name="chest" position={[0, 0.030, 0]} rotation={rot(map, "chest")}>
              <SculptParts joint="chest" dress={dress} />

              <Arm side={-1} map={map} dress={dress} />
              <Arm side={1}  map={map} dress={dress} />

              <group name="neck" position={[0, D.chestH * 0.985, 0]} rotation={rot(map, "neck")}>
                <SculptParts joint="neck" dress={dress} />
                <Head map={map} dress={dress} seed={seed} accessory={accessory} />
              </group>
            </group>
          </group>

          <Leg side={-1} map={map} dress={dress} />
          <Leg side={1}  map={map} dress={dress} />
        </group>
      </group>
    </group>
  )
})

// ── Status halo ──────────────────────────────────────────────────────────────

/**
 * A ring above the head saying what this figure is doing.
 *
 * It used to be a saturated blue torus with three beads, emissive at 1.8 and
 * excluded from tone mapping — so it clipped to pure cyan, bloomed, and was
 * the brightest object in a room lit by two table lamps. Seen full-screen it
 * was the first thing your eye went to and the last thing worth looking at.
 *
 * Now it is a thin ring, tone-mapped like everything else, glowing just enough
 * to be found: the same information, at the volume the information deserves.
 */
export function StatusHalo({ color, y = 1.94 }: { color: string; y?: number }) {
  return (
    <group position={[0, y, 0]}>
      <mesh material={M.status(color, 0.55)} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.118, 0.0075, 8, 30]} />
      </mesh>
    </group>
  )
}
