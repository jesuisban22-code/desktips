/**
 * scripts/gait-probe.ts — does the walk actually walk?
 *
 * Bundled and run in node by scripts/gait.mjs. It solves the gait at 96 points
 * of the cycle and re-derives, from THE ANGLES THE SOLVER RETURNED, where the
 * heel, ball and toe of each foot end up. Then it checks the three faults the
 * first walk shipped with, none of which a screenshot would have shown:
 *
 *   SINK   any part of a sole below the floor
 *   SLIP   a foot the solver claims is planted, moving against the ground
 *   LIFT   a swing phase that never clears the floor
 *
 * The check is deliberately adversarial about SLIP: it takes the solver's own
 * word for which foot is down and which part of it is the pivot, and then
 * measures whether that pivot actually stays put. Believing the claim without
 * measuring it is exactly how the old walk passed review.
 */
import { solveGait, footStep, STRIDE, type SubStep } from "../src/anim/motion"
import { D, SEATED, SEATED_HIP_Y } from "../src/components/Character"
import { SCALE } from "../src/three/kit"

const HIP_Y = D.hipY - D.pelvisH * 0.30

/** +X rotation swings +Z toward -Y. */
function turn(y: number, z: number, a: number): [number, number] {
  return [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]
}

/** The sole, in the foot's own frame. Matches Foot() in Character.tsx. */
const SOLE: Record<string, [number, number]> = {
  heel: [-D.footH, -0.060],
  ball: [-D.footH, 0.075],
  toe:  [-D.footH, 0.170],
}

function soleWorld(thigh: number, shin: number, foot: number, hipY: number) {
  const [ky, kz] = turn(-D.thigh, 0, thigh)
  const [ay, az] = turn(-D.shin, 0, thigh + shin)
  const ankleY = hipY + ky + ay
  const ankleZ = kz + az
  const total = thigh + shin + foot
  const out: Record<string, { y: number; z: number }> = {}
  for (const [k, [py, pz]] of Object.entries(SOLE)) {
    const [wy, wz] = turn(py, pz, total)
    out[k] = { y: ankleY + wy, z: ankleZ + wz }
  }
  return out
}

/** Which point of the sole the solver says is carrying the figure. */
const PIVOT: Record<SubStep, string | null> = {
  strike: "heel", flat: "ball", off: "toe", swing: null,
}

const N = 96
const fail: string[] = []

let deepest = 0, deepestAt = 0
let worstSlip = 0, worstSlipAt = 0, worstSlipSub: SubStep = "flat"
let clearance = Infinity
const rows: string[] = []

type Prev = { sub: SubStep; pts: Record<string, { y: number; z: number }> }
const prev: Record<"L" | "R", Prev | null> = { L: null, R: null }

for (let i = 0; i <= N; i++) {
  const t = i / N
  const phase = t * Math.PI * 2
  const g = solveGait(phase)
  const p = g.pose
  const hip = HIP_Y + g.bob

  const feet = {
    L: soleWorld(p.thighL![0], p.shinL![0], p.footL![0], hip),
    R: soleWorld(p.thighR![0], p.shinR![0], p.footR![0], hip),
  }

  for (const side of ["L", "R"] as const) {
    const step = footStep(phase, side)
    const pts = feet[side]

    for (const k of Object.keys(SOLE)) {
      if (pts[k].y < deepest) { deepest = pts[k].y; deepestAt = t }
    }

    // Swing: how much room is there under the whole foot at its highest?
    if (step.sub === "swing") {
      const low = Math.min(pts.heel.y, pts.ball.y, pts.toe.y)
      // the clearance that matters is the WORST moment of the swing's middle
      const u = 0
      void u
      if (low < clearance && t > 0) clearance = Math.min(clearance, low)
    }

    const pivot = PIVOT[step.sub]
    const before = prev[side]
    if (pivot && before && before.sub === step.sub) {
      const slip = pts[pivot].z - before.pts[pivot].z + STRIDE / N
      if (Math.abs(slip) > Math.abs(worstSlip)) {
        worstSlip = slip; worstSlipAt = t; worstSlipSub = step.sub
      }
    }
    prev[side] = { sub: step.sub, pts }
  }

  if (i % 8 === 0) {
    const L = feet.L, R = feet.R
    rows.push(
      `${t.toFixed(3)}  bob ${g.bob.toFixed(3)}  ` +
      `L ${footStep(phase, "L").sub.padEnd(6)} heel ${L.heel.y.toFixed(3)} toe ${L.toe.y.toFixed(3)}  ` +
      `R ${footStep(phase, "R").sub.padEnd(6)} heel ${R.heel.y.toFixed(3)} toe ${R.toe.y.toFixed(3)}`,
    )
  }
}

// The lowest point during swing, sampled across the whole swing, includes the
// moments right after lift-off and right before landing — so the useful figure
// is the peak, not the minimum.
let peak = 0
for (let i = 0; i <= N; i++) {
  const phase = (i / N) * Math.PI * 2
  const g = solveGait(phase)
  const p = g.pose
  const hip = HIP_Y + g.bob
  for (const side of ["L", "R"] as const) {
    if (footStep(phase, side).sub !== "swing") continue
    const pts = side === "L"
      ? soleWorld(p.thighL![0], p.shinL![0], p.footL![0], hip)
      : soleWorld(p.thighR![0], p.shinR![0], p.footR![0], hip)
    peak = Math.max(peak, Math.min(pts.heel.y, pts.ball.y, pts.toe.y))
  }
}

console.log(rows.join("\n"))
console.log()
console.log(`stride               ${STRIDE.toFixed(3)} m per cycle`)
console.log(`deepest sole point   ${(deepest * 1000).toFixed(1)} mm  (t=${deepestAt.toFixed(3)})`)
console.log(`worst planted slip   ${(worstSlip * 1000).toFixed(1)} mm/frame  (${worstSlipSub}, t=${worstSlipAt.toFixed(3)})`)
console.log(`peak swing clearance ${(peak * 1000).toFixed(0)} mm`)

if (deepest < -0.005) fail.push(`a sole goes ${(-deepest * 1000).toFixed(0)} mm through the floor`)
if (Math.abs(worstSlip) > 0.004) fail.push(`a planted foot slides ${(worstSlip * 1000).toFixed(1)} mm per frame`)
if (peak < 0.045) fail.push(`the swing foot only clears ${(peak * 1000).toFixed(0)} mm`)

// ── Seated ───────────────────────────────────────────────────────────────────
//
// The same question, asked of the chair: does the figure's weight land on the
// seat, and do its feet land on the floor? Both were wrong, in opposite
// directions, and both are a couple of pixels at room scale — which is exactly
// why they survived four rounds of looking at screenshots.

const seatPivot = SEATED_HIP_Y - D.pelvisH * 0.30
const seatSole = soleWorld(SEATED.thighL![0], SEATED.shinL![0], SEATED.footL![0], seatPivot)
const lowestSeated = Math.min(seatSole.heel.y, seatSole.ball.y, seatSole.toe.y)

// Thigh underside where it crosses the front edge of the seat.
const kneeDrop = D.thigh * Math.cos(Math.abs(SEATED.thighL![0]))
const thighUnderKnee = seatPivot - kneeDrop - D.thighW / 2
const seatTop = SCALE.seatHeight + 0.028

console.log()
console.log(`seated sole         ${(lowestSeated * 1000).toFixed(1)} mm above the floor`)
console.log(`thigh under knee    ${(thighUnderKnee * 1000).toFixed(0)} mm   seat top ${(seatTop * 1000).toFixed(0)} mm`)

if (Math.abs(lowestSeated) > 0.008) {
  fail.push(`seated feet are ${(lowestSeated * 1000).toFixed(0)} mm off the floor`)
}
if (seatTop - thighUnderKnee > 0.035) {
  fail.push(
    `the seat is ${((seatTop - thighUnderKnee) * 1000).toFixed(0)} mm into the thigh — ` +
    `the chair is too high for these legs`,
  )
}

if (fail.length) {
  console.log("\nFAIL\n  " + fail.join("\n  "))
  process.exit(1)
}
console.log("\nOK — soles stay on the floor, planted feet stay put, the swing clears,")
console.log("     and the seated figure sits on the chair rather than in it.")
