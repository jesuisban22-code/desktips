/**
 * motion.ts — the pose generators.
 *
 * Everything here is a pure function from (phase or progress) to a PoseMap.
 * Keeping them pure means the actor can blend freely between them, and a pose
 * can be inspected in the character test harness without running the whole
 * event pipeline.
 *
 * Convention inherited from Character.tsx: a limb hangs along -Y, so rotation
 * about +X swings it toward -Z. FORWARD IS NEGATIVE X.
 */

import { D, PoseMap } from "../components/Character"
import { ActionKind } from "./stations"

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Blend two pose maps. Joints absent from either side fall back to neutral. */
export function blendPose(a: PoseMap, b: PoseMap, t: number): PoseMap {
  const out: PoseMap = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PoseMap>
  for (const k of keys) {
    const va = a[k] ?? [0, 0, 0]
    const vb = b[k] ?? [0, 0, 0]
    out[k] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t), lerp(va[2], vb[2], t)]
  }
  return out
}

// ── Walk cycle ───────────────────────────────────────────────────────────────
//
// The first version of this was two sine waves: a thigh swinging one way, a
// knee bending the other. It typechecked, it animated, and it was wrong in
// three ways at once, none of which are visible in a still frame and all three
// of which are obvious the moment you lay the cycle out phase by phase
// (?debug=gait):
//
//   • the soles dipped 37 mm BELOW the floor at the ends of the stride;
//   • no foot was ever still — measured against the ground the figure covered,
//     both feet slid in every single frame. It was skating, not walking;
//   • the "lift" peaked while the leg was behind the body, so there was no
//     swing phase to speak of.
//
// So the legs are no longer posed. A FOOT PATH is specified — where the sole
// must actually be, in metres, relative to the hip — and the thigh and shin
// angles are solved from it. A stance foot is then still by construction,
// because being still is what the path says, and the leg cannot punch through
// the floor because the floor is where the path puts it.
//
// The distances come from Character.tsx itself, not from a copy of them here.
// A transcription is how the drafting table shipped with two members rotated
// the wrong way; a walk solved against limb lengths the figure does not have
// would be the same mistake, and would silently come back the first time
// anyone changed the figure's proportions.

const L_THIGH = D.thigh
const L_SHIN  = D.shin
/** Never fully locked: a leg at exactly its full length has no knee at all. */
const L_MAX   = (L_THIGH + L_SHIN) * 0.992
const L_MIN   = 0.34

/** Height of the hip joint (the thigh pivot) when standing — `hipY` plus the
 *  offset the Leg component places the thigh group at inside the hips. */
const HIP_Y   = D.hipY - D.pelvisH * 0.30
/** Sole to ankle, foot flat. */
const ANKLE_H = D.footH

/** Ground covered by one full cycle — two steps. */
export const STRIDE = 0.74
/** Fraction of the cycle each foot spends on the ground. ~0.6 is walking; at
 *  0.5 it becomes a run, with both feet airborne between steps. */
const DUTY = 0.62
/** Half the ground each foot covers while it is down. */
const HALF = (STRIDE * DUTY) / 2
const LIFT = 0.098

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (u: number) => u * u * (3 - 2 * u)

// The sole, in the foot's own frame: where the heel, the ball and the toe sit
// relative to the ankle. These are what touch the ground, so they are what the
// step has to be built around.
const SOLE_Y = -ANKLE_H
const HEEL_Z = -0.060
/** Just inside the toe, so the rounded tip is never the thing on the floor. */
const TOE_Z  = 0.170

/** Fractions of the stance at which the foot goes flat, and starts to roll off. */
const S_FLAT = 0.15
const S_OFF  = 0.78
const HEEL_ROLL = -0.15   // toe up, at the moment of contact
const TOE_ROLL  = 0.46    // heel up, pushing off

/** Rotate a point of the foot about the ankle. +X swings +Z toward -Y. */
function turn(y: number, z: number, a: number): [number, number] {
  return [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]
}

/**
 * Put the ankle wherever it must be for `pivotZ` — a named point of the sole —
 * to rest on the floor at `contactZ`, with the foot rolled by `roll`.
 *
 * This is the whole trick. Rolling the foot about the ANKLE, which is the
 * obvious thing to do, drags the contact point along the ground: that is
 * where the old walk's slide came from. Rolling about the contact point
 * instead makes a planted foot planted by construction.
 */
function place(pivotZ: number, contactZ: number, roll: number) {
  const [py, pz] = turn(SOLE_Y, pivotZ, roll)
  return { y: -py, z: contactZ - pz, roll }
}

/** Which part of the step this is — the probe checks each one differently. */
export type SubStep = "strike" | "flat" | "off" | "swing"

export interface Step {
  /** Ankle height above the floor, and its position along the walk, relative
   *  to the hips. */
  y: number
  z: number
  roll: number
  stance: boolean
  sub: SubStep
}

/** Half the ground a foot covers while it is down, measured at the ankle. */
const A_AT = (s: number) => HALF - 2 * HALF * s

/** The ankle and the foot angle at cycle fraction `t`, relative to the hips. */
function footPath(t: number): Step {
  const p = ((t % 1) + 1) % 1

  if (p < DUTY) {
    const s = p / DUTY

    if (s < S_FLAT) {
      // Heel down, toe still up, rolling flat about the heel.
      const roll = HEEL_ROLL * (1 - smooth(s / S_FLAT))
      const heel = A_AT(S_FLAT) + HEEL_Z + 2 * HALF * (S_FLAT - s)
      return { ...place(HEEL_Z, heel, roll), stance: true, sub: "strike" }
    }
    if (s > S_OFF) {
      // Heel off, pivoting on the toe. Pivoting on the BALL — which is what a
      // foot with toes does — drove the rigid toe 47 mm into the floor at full
      // push-off. This foot has no toe joint, so the toe is the pivot.
      const roll = TOE_ROLL * smooth((s - S_OFF) / (1 - S_OFF))
      const toe = A_AT(S_OFF) + TOE_Z + 2 * HALF * (S_OFF - s)
      return { ...place(TOE_Z, toe, roll), stance: true, sub: "off" }
    }
    // Flat on the floor, sliding backward at exactly the speed the body moves.
    return { y: ANKLE_H, z: A_AT(s), roll: 0, stance: true, sub: "flat" }
  }

  // In the air. Both ends are matched to the stance — position, and the rate
  // the foot is travelling at — so the foot is already moving backward at
  // ground speed when it lands. That is what stops a walk from scrubbing;
  // the shape of the arc between the two is only decoration.
  const u = (p - DUTY) / (1 - DUTY)
  const from = footPath(DUTY - 1e-6)
  const to   = footPath(0)
  const m = -(2 * HALF / DUTY) * (1 - DUTY)
  const u2 = u * u
  const u3 = u2 * u
  const z =
    (2 * u3 - 3 * u2 + 1) * from.z +
    (u3 - 2 * u2 + u) * m +
    (-2 * u3 + 3 * u2) * to.z +
    (u3 - u2) * m
  const y =
    from.y + (to.y - from.y) * smooth(u) +
    LIFT * Math.pow(Math.sin(Math.PI * u), 0.85)
  const roll =
    from.roll + (to.roll - from.roll) * smooth(u) - 0.10 * Math.sin(Math.PI * u)
  return { y, z, roll, stance: false, sub: "swing" }
}

/**
 * Where one foot is at a given moment. Exported for scripts/gait-probe.ts,
 * which checks the claim "this foot is on the floor and not moving" against
 * the geometry it produces.
 */
export function footStep(phase: number, side: "L" | "R"): Step {
  return footPath(phase / (Math.PI * 2) + (side === "R" ? 0.5 : 0))
}

/** Two-link solve in the sagittal plane. Returns [thigh, shin] rotations. */
function legIK(tz: number, ty: number): [number, number] {
  let z = tz
  let y = ty
  let d = Math.hypot(z, y)
  if (d > L_MAX) { const s = L_MAX / d; z *= s; y *= s; d = L_MAX }
  if (d < L_MIN) { const s = L_MIN / Math.max(d, 1e-5); z *= s; y *= s; d = L_MIN }

  // A limb hangs along -Y and a positive X rotation swings its tip toward -Z,
  // so a tip at (z, y) sits at angle atan2(-z, -y).
  const dir = Math.atan2(-z, -y)
  const beta = Math.acos(
    clamp((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1),
  )
  const gamma = Math.acos(
    clamp((L_THIGH * L_THIGH + L_SHIN * L_SHIN - d * d) / (2 * L_THIGH * L_SHIN), -1, 1),
  )
  // Knee forward of the hip-to-ankle line: the only way a human knee bends.
  return [dir - beta, Math.PI - gamma]
}

export interface Gait {
  pose: PoseMap
  /** Vertical offset of the whole body — never positive: the pelvis can only
   *  drop below standing height, and it does so when the legs are spread. */
  bob: number
}

/**
 * The whole gait for one moment of the cycle.
 *
 * The pelvis height is not decoration. It dips twice per cycle because that is
 * where the bounce in a walk comes from — and then it is clamped, because at
 * the ends of the stride the leg is simply not long enough to reach the floor
 * from standing height. Clamping it there is the same thing a real pelvis does,
 * and it is what guarantees the leg is never asked for a length it has not got.
 */
export function solveGait(phase: number, effort = 1): Gait {
  const t = phase / (Math.PI * 2)
  const fL = footPath(t)
  const fR = footPath(t + 0.5)

  const reach = (f: Step) =>
    f.y + Math.sqrt(Math.max(0, L_MAX * L_MAX - f.z * f.z))
  const wanted = HIP_Y - 0.020 * (0.5 + 0.5 * Math.cos(2 * phase))
  const hip = Math.min(wanted, reach(fL), reach(fR))

  const [thighL, shinL] = legIK(fL.z, fL.y - hip)
  const [thighR, shinR] = legIK(fR.z, fR.y - hip)

  // Arms swing opposite the same-side leg. The left foot is furthest forward
  // at t = 0, so cos(phase) is how far forward the left leg is.
  //
  // The shoulder swing is small and the ELBOW carries the difference. Swinging
  // the shoulder hard and then flexing the elbow the same way just adds the two
  // angles together: the arm comes out straight and reaching, which is what the
  // first attempt looked like — a sleepwalker. A bent elbow only reads as bent
  // when the two segments disagree.
  const a = Math.cos(phase)
  const amp = 0.20 + 0.07 * clamp(effort, 0.6, 1.8)
  const armR = -a * amp
  const armL = a * amp
  // Shoulder plus elbow must not add up past about 40° forward, or the arm
  // reads as reaching for something rather than swinging.
  const bend = (theta: number) =>
    -0.17 - Math.max(0, -theta / amp) * 0.27

  const s = Math.sin(phase)

  return {
    bob: hip - HIP_Y,
    pose: {
      spine: [0.045, s * 0.05, a * 0.022],
      chest: [0.00, -s * 0.10, 0],
      head:  [0.02, -s * 0.035, 0],

      thighL: [thighL, 0, 0.018],
      shinL:  [shinL, 0, 0],
      footL:  [-(thighL + shinL) + fL.roll, 0, 0],

      thighR: [thighR, 0, -0.018],
      shinR:  [shinR, 0, 0],
      footR:  [-(thighR + shinR) + fR.roll, 0, 0],

      upperArmL: [armL, 0, 0.055],
      forearmL:  [bend(armL), 0, 0.02],
      handL:     [-0.10, 0, 0],
      upperArmR: [armR, 0, -0.055],
      forearmR:  [bend(armR), 0, -0.02],
      handR:     [-0.10, 0, 0],
    },
  }
}

export function walkPose(phase: number, effort = 1): PoseMap {
  return solveGait(phase, effort).pose
}

/** Vertical offset of the body through the cycle. */
export function walkBob(phase: number, effort = 1): number {
  return solveGait(phase, effort).bob
}

/**
 * An armful held against the body.
 *
 * Both forearms used to be posed at -1.18 on top of a -0.44 shoulder, which
 * adds up to 93°: arms straight out, palms up, at full stretch. Nobody carries
 * anything that way — the elbows go to the ribs and the load comes IN. The
 * hands are aimed at where the folder stack actually is, 1.176 up and 0.238
 * out, so the stack sits in them instead of hovering near them.
 */
export function carryPose(): PoseMap {
  return {
    spine: [-0.03, 0, 0],
    head:  [0.06, 0, 0],
    ...reach("L", 0.245, -0.170, 0.13, 0.10),
    ...reach("R", 0.245, -0.170, -0.13, -0.10),
  }
}

/** Carrying something changes the whole upper body, so it overrides the arms. */
export function walkCarryPose(phase: number, effort = 1): PoseMap {
  const base = walkPose(phase, effort)
  return {
    ...base,
    ...carryPose(),
    // Weight in front means leaning back a little, not forward — but the walk
    // still owns the torso, so its twist survives the carry.
    spine: [-0.03, (base.spine?.[1] ?? 0) * 0.6, (base.spine?.[2] ?? 0) * 0.5],
    chest: [0.00, -Math.sin(phase) * 0.045, 0],
    head:  base.head ?? [0.04, 0, 0],
  }
}

// ── Arms ─────────────────────────────────────────────────────────────────────
//
// The work poses had the same fault the walk did, and it is worth naming once:
// a forearm rotation is RELATIVE to the upper arm, so posing the shoulder
// forward and then the elbow forward as well just adds the two angles. Every
// station pose ended up with both arms straight out at shoulder height — five
// different actions, one silhouette, and that silhouette a sleepwalker's.
//
// So arms are solved the same way legs are: say where the HAND goes, and let
// the shoulder and elbow follow. A hand at a drawer, a hand on a shelf and a
// hand on the desk are three different things to say, and they now produce
// three different shapes without anyone having to guess an angle.

const L_UPPER = D.upperArm
/** To the middle of the palm, which is what actually touches things. */
const L_FORE  = D.foreArm + D.handLen * 0.45
const ARM_MAX = (L_UPPER + L_FORE) * 0.985
const ARM_MIN = 0.17

/**
 * Two-link solve for an arm. Same geometry as the leg, mirrored: a knee bends
 * so the joint leads, an elbow bends so the joint trails.
 */
function armIK(tz: number, ty: number): [number, number] {
  let z = tz
  let y = ty
  let d = Math.hypot(z, y)
  if (d > ARM_MAX) { const k = ARM_MAX / d; z *= k; y *= k; d = ARM_MAX }
  if (d < ARM_MIN) { const k = ARM_MIN / Math.max(d, 1e-5); z *= k; y *= k; d = ARM_MIN }

  const dir = Math.atan2(-z, -y)
  const beta = Math.acos(
    clamp((L_UPPER * L_UPPER + d * d - L_FORE * L_FORE) / (2 * L_UPPER * d), -1, 1),
  )
  const gamma = Math.acos(
    clamp((L_UPPER * L_UPPER + L_FORE * L_FORE - d * d) / (2 * L_UPPER * L_FORE), -1, 1),
  )
  // Elbow behind the shoulder-to-hand line: the only way a human elbow bends.
  return [dir + beta, -(Math.PI - gamma)]
}

/**
 * Put one hand at (z forward, y up) relative to its own shoulder, measured in
 * the chest's frame — so a leaning spine carries the whole arm with it.
 * `out` swings the shoulder sideways, `twist` turns the forearm.
 */
function reach(
  side: "L" | "R", z: number, y: number, out = 0, twist = 0,
): PoseMap {
  const [upper, fore] = armIK(z, y)
  const sgn = side === "L" ? 1 : -1
  return {
    [`upperArm${side}`]: [upper, twist * sgn, out * sgn],
    [`forearm${side}`]:  [fore, -twist * 0.5 * sgn, 0],
    [`hand${side}`]:     [-0.12, 0, 0],
  } as PoseMap
}

/** An arm left to hang, with enough elbow in it to read as an arm. */
function hang(side: "L" | "R", out = 0.10): PoseMap {
  const sgn = side === "L" ? 1 : -1
  return {
    [`upperArm${side}`]: [0.05, 0, out * sgn],
    [`forearm${side}`]:  [-0.32, 0, 0.03 * sgn],
    [`hand${side}`]:     [-0.08, 0, 0],
  } as PoseMap
}

// ── Working at a station ─────────────────────────────────────────────────────

/**
 * `t` is seconds since the beat started. Each action has its own rhythm, and
 * they are deliberately different lengths so two agents working side by side
 * never fall into lockstep.
 *
 * `variant` (from the beat's id) picks a second way of doing the same job, so
 * the tenth trip to the cabinet does not look exactly like the first.
 */
export function workPose(action: ActionKind, t: number, variant = 0): PoseMap {
  if (variant % 2 === 1) {
    const alt = workVariant(action, t)
    if (alt) return alt
  }
  switch (action) {
    // Pulling files out of a drawer: lean in, reach, draw the hand back.
    case "search": {
      const reachT = (Math.sin(t * 3.2) + 1) / 2
      return {
        spine: [-0.22, 0.10, 0],
        chest: [-0.05, 0.06, 0],
        neck:  [-0.10, 0, 0],
        head:  [0.30, 0.06, 0],
        thighL: [-0.12, 0, 0.055],
        shinL:  [0.14, 0, 0],
        footL:  [-0.02, 0, 0],
        thighR: [0.05, 0, -0.055],
        ...reach("R", 0.20 + reachT * 0.17, -0.38 - reachT * 0.06, -0.14, -0.10),
        ...hang("L", 0.14),
      }
    }

    // Scanning a shelf: hand up among the spines, tracking along them.
    case "browse": {
      const track = Math.sin(t * 1.9)
      return {
        spine: [-0.03, 0.06, 0],
        neck:  [-0.14, 0, 0],
        head:  [-0.16, track * 0.22, 0],
        thighL: [-0.03, 0, 0.05],
        thighR: [0.03, 0, -0.05],
        // Out at the shelf, not up at the chin: a hand 0.24 in front of the
        // shoulder and above it is, geometrically, a hand on your own face.
        ...reach("R", 0.37 + track * 0.04, 0.26 + track * 0.05, -0.24, -0.16),
        ...hang("L", 0.12),
      }
    }

    // At the board: weight forward, short strokes across the sheet.
    case "draw": {
      const stroke = Math.sin(t * 4.6)
      const cross  = Math.cos(t * 2.3)
      return {
        spine: [-0.24, 0.08, 0],
        chest: [-0.06, 0.04, 0],
        neck:  [-0.13, 0, 0],
        head:  [0.32, -0.04, 0],
        thighL: [-0.07, 0, 0.055],
        thighR: [0.03, 0, -0.055],
        ...reach("R", 0.31 + stroke * 0.035, -0.31 + cross * 0.03, -0.16, -0.22),
        // The other hand holds the sheet flat, further in and lower.
        ...reach("L", 0.24, -0.36, 0.20, 0.16),
      }
    }

    // At the bench: both hands low and busy, alternating.
    case "operate": {
      const a = Math.sin(t * 3.8)
      return {
        spine: [-0.16, 0.02, 0],
        neck:  [-0.08, 0, 0],
        head:  [0.26, 0, 0],
        thighL: [-0.06, 0, 0.055],
        thighR: [-0.02, 0, -0.055],
        ...reach("R", 0.27 + a * 0.05, -0.36 - a * 0.03, -0.18, -0.20),
        ...reach("L", 0.27 - a * 0.05, -0.36 + a * 0.03, 0.18, 0.20),
      }
    }

    // At the door: half-turned, holding it, one hand raised in greeting.
    case "greet": {
      const wave = Math.sin(t * 2.6)
      return {
        spine: [0.02, 0.16, 0],
        head:  [0.04, 0.26, 0],
        thighL: [-0.04, 0, 0.06],
        thighR: [0.06, 0, -0.06],
        ...reach("R", 0.30 + wave * 0.05, 0.22 + wave * 0.04, -0.30, -0.14),
        ...hang("L", 0.10),
      }
    }

    // Seated at the desk.
    case "sit":
    default:
      return writePose(t)
  }
}

/** The second way of doing each job. */
function workVariant(action: ActionKind, t: number): PoseMap | null {
  switch (action) {
    // Standing at the cabinet leafing through a folder held in both hands.
    case "search": {
      const flip = Math.max(0, Math.sin(t * 4.1))
      return {
        spine: [-0.10, 0.04, 0],
        neck:  [-0.10, 0, 0],
        head:  [0.40, -0.04, 0],
        thighL: [-0.03, 0, 0.04],
        thighR: [0.04, 0, -0.04],
        ...reach("R", 0.28, -0.20 + flip * 0.05, -0.22, -0.20),
        ...reach("L", 0.27, -0.23, -0.20, 0.18),
      }
    }
    // A book off the shelf, open, being read.
    case "browse": {
      const page = Math.max(0, Math.sin(t * 1.3))
      return {
        spine: [0.02, 0.05, 0],
        neck:  [-0.08, 0, 0],
        head:  [0.34, 0.03, 0.03],
        thighL: [-0.02, 0, 0.04],
        thighR: [0.04, 0, -0.04],
        ...reach("R", 0.25, -0.13 + page * 0.04, -0.24, -0.24),
        ...reach("L", 0.25, -0.15, -0.22, 0.24),
      }
    }
    // Hammering: a slow lift, a quick strike, the other hand steadying.
    case "operate": {
      const p = (t * 1.6) % 1
      const lift = p < 0.7 ? p / 0.7 : 1 - (p - 0.7) / 0.3
      return {
        spine: [-0.18, -0.04, 0],
        neck:  [-0.06, 0, 0],
        head:  [0.30, 0.04, 0],
        thighL: [-0.08, 0, 0.06],
        thighR: [0.02, 0, -0.06],
        ...reach("R", 0.24 + lift * 0.06, -0.36 + lift * 0.40, -0.10, -0.10),
        ...reach("L", 0.30, -0.38, 0.12, 0.20),
      }
    }
    // Sweeping the rule across the sheet with both hands.
    case "draw": {
      const sweep = Math.sin(t * 2.2)
      return {
        spine: [-0.26, 0.04 + sweep * 0.05, 0],
        chest: [-0.06, sweep * 0.04, 0],
        neck:  [-0.12, 0, 0],
        head:  [0.34, sweep * 0.10, 0],
        thighL: [-0.07, 0, 0.055],
        thighR: [0.03, 0, -0.055],
        ...reach("R", 0.33, -0.32, -0.10 + sweep * 0.18, -0.20),
        ...reach("L", 0.30, -0.34, 0.08 - sweep * 0.14, 0.16),
      }
    }
    default:
      return null
  }
}

/** Both hands busy on the desk, alternating: typing rather than writing. */
export function typePose(t: number): PoseMap {
  const a = Math.sin(t * 9.0)
  const b = Math.sin(t * 9.0 + 1.9)
  return {
    spine: [-0.15, 0.02, 0],
    chest: [-0.04, 0, 0],
    neck:  [-0.10, 0, 0],
    head:  [0.26, 0.02, 0],
    ...reach("R", 0.37, -0.21 + Math.max(0, a) * 0.025, -0.10, -0.18),
    ...reach("L", 0.37, -0.21 + Math.max(0, b) * 0.025, -0.10, 0.18),
  }
}

// ── Reactions and fidgets ────────────────────────────────────────────────────
//
// Upper body only: seated or standing, the legs keep whatever the figure is
// doing below the waist (SEATED is laid over the top when sitting). `t` runs
// from 0 over `dur`; each one eases in and out so it can start from any pose.

const envelope = (t: number, dur: number, edge = 0.35) =>
  Math.min(1, t / edge, (dur - t) / edge)

/** Something failed: a hand to the back of the head, a look down. */
export function scratchPose(t: number, dur: number): PoseMap {
  const k = Math.max(0, envelope(t, dur, 0.4))
  const rub = Math.sin(t * 13) * 0.05 * k
  return {
    spine: [0.04 * k, -0.06 * k, 0],
    neck:  [0.06 * k, 0, 0],
    head:  [0.26 * k, -0.12 * k, -0.10 * k],
    ...reach("R", 0.04, 0.30 * k - 0.32 * (1 - k), -0.40 * k + rub, 0.30),
    ...hang("L", 0.12),
  }
}

/** A request arrived: look out at the person, nod twice. */
export function nodPose(t: number, dur: number): PoseMap {
  const k = Math.max(0, envelope(t, dur, 0.3))
  const nod = Math.max(0, Math.sin(Math.min(t, dur - 0.3) * 8.5)) * 0.20 * k
  return {
    spine: [0.03 * k, 0, 0],
    neck:  [-0.06 * k, 0, 0],
    head:  [-0.16 * k + nod, 0, 0],
    ...hang("L", 0.10),
    ...hang("R", 0.10),
  }
}

/** Done, or stiff from sitting: arms up and back, head tipped. */
export function stretchPose(t: number, dur: number): PoseMap {
  const k = Math.max(0, envelope(t, dur, 0.55))
  return {
    spine: [0.14 * k, 0, 0],
    chest: [0.06 * k, 0, 0],
    neck:  [-0.10 * k, 0, 0],
    head:  [-0.22 * k, 0, 0],
    ...reach("R", 0.04, -0.34 + 0.86 * k, 0.10 + 0.14 * k, 0),
    ...reach("L", 0.04, -0.34 + 0.86 * k, 0.10 + 0.14 * k, 0),
  }
}

/** Idle: a slow look to one side, then the other. */
export function lookAroundPose(t: number, dur: number): PoseMap {
  const k = Math.max(0, envelope(t, dur, 0.6))
  const yaw = Math.sin((t / dur) * Math.PI * 2) * 0.62 * k
  return {
    spine: [0.02, yaw * 0.25, 0],
    head:  [0.02, yaw, 0.02],
    ...hang("L", 0.10),
    ...hang("R", 0.10),
  }
}

/** Idle, standing: arms folded, weight on one leg. */
export function armsFoldedPose(t: number, dur: number): PoseMap {
  const k = Math.max(0, envelope(t, dur, 0.5))
  const w = Math.sin(t * 0.5) * 0.02
  return {
    spine: [0.03, 0.04, w],
    head:  [0.06, 0.10 * Math.sin(t * 0.6), 0.03],
    thighL: [-0.02, 0, 0.03],
    thighR: [0.05, 0, -0.03],
    ...reach("R", 0.14 * k + 0.02, -0.24 * k - 0.30 * (1 - k), -0.52 * k + 0.08, -0.30 * k),
    ...reach("L", 0.16 * k + 0.02, -0.21 * k - 0.30 * (1 - k), -0.52 * k + 0.08, 0.30 * k),
  }
}

/** Idle sway so a waiting figure is never perfectly still. */
export function idlePose(t: number): PoseMap {
  const s = Math.sin(t * 0.8)
  // A slow weight shift from one foot to the other, so a figure standing
  // about does not read as a statue with a wobbling head.
  const w = Math.sin(t * 0.37)
  return {
    spine: [0.02 + s * 0.012, 0.03 + s * 0.03, w * 0.020],
    chest: [0, -0.02, -w * 0.010],
    head:  [0.02 + s * 0.02, 0.07 + s * 0.05, 0.01],
    thighL: [-0.02 - Math.max(0, w) * 0.05, 0, 0.015],
    thighR: [0.03 + Math.max(0, -w) * 0.05, 0, -0.015],
    shinR:  [-0.05, 0, 0],
    ...hang("L", 0.10 + s * 0.012),
    ...hang("R", 0.09 - s * 0.012),
  }
}

/**
 * Asking for the person: turned out of the room, looking up at the viewer,
 * one hand high and waving. Only ever played while Claude is blocked on a
 * permission or a question — the one moment worth interrupting someone for.
 */
export function callPose(t: number): PoseMap {
  const wave = Math.sin(t * 6.2)
  const lift = Math.sin(t * 1.3) * 0.02
  return {
    spine: [0.02, 0.05, 0.03],
    chest: [-0.03, 0.02, 0.02],
    neck:  [-0.06, 0, 0],
    // The camera sits well above the room: a figure looking straight ahead
    // reads as looking at the wall behind you.
    head:  [-0.20, 0.06, 0.05 * wave],
    thighL: [-0.02, 0, 0.035],
    thighR: [0.04, 0, -0.035],
    shinR:  [-0.04, 0, 0],
    ...reach("R", 0.13, 0.47 + lift, -0.36 - wave * 0.17, -0.12),
    ...hang("L", 0.12),
  }
}

/** Thinking: a hand at the chin, the other hanging. */
export function thinkPose(t: number): PoseMap {
  const s = Math.sin(t * 0.9)
  return {
    spine: [0.04, -0.05, 0],
    chest: [0.02, 0, 0],
    neck:  [-0.08, 0, 0],
    head:  [0.20 + s * 0.03, -0.17 + s * 0.05, 0.07],
    thighL: [-0.03, 0, 0.015],
    thighR: [0.02, 0, -0.015],
    // The hand goes to the chin — which is a POSITION, not a pile of angles.
    // Posed by hand it came out as a fist saluting somewhere near the ear.
    ...reach("R", 0.085 + s * 0.012, 0.285, -0.30, -0.34),
    ...hang("L", 0.13),
  }
}

/**
 * Working at a desk: both hands on the top, the right one moving.
 *
 * Seated, the shoulder sits about 0.97 m up and the desk is at 0.75, so the
 * hands belong roughly 0.20 below the shoulder and 0.40 in front of it. Saying
 * that outright is the whole difference between a figure writing and a figure
 * holding its arms out at a desk it cannot reach.
 */
export function writePose(t: number): PoseMap {
  const stroke = Math.sin(t * 5.2)
  return {
    spine: [-0.17, 0.05, 0],
    chest: [-0.05, 0.03, 0],
    neck:  [-0.11, 0, 0],
    head:  [0.30, -0.05, 0],
    ...reach("R", 0.38 + stroke * 0.035, -0.20 + stroke * 0.012, -0.13, -0.20),
    ...reach("L", 0.33, -0.22, 0.17, 0.18),
  }
}
