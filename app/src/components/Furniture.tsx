/**
 * Furniture.tsx — the built pieces of the atelier.
 *
 * MainDesk      writing desk with turned legs, apron, two graduated drawers
 * DraftingTable tilting board on splayed side frames, notched adjustment strut
 * Workbench     laminated butcher-block bench, through-tenons, vise, drawer till
 * Chair         wooden side chair — back legs continue up as the back posts
 * Stool         three-legged workshop stool with a ring stretcher
 *
 * Every solid is a chamfered slab or a lathe-turned profile. Nothing here is a
 * raw box. Positions default to the shared room map; 1 unit = 1 metre.
 */

import type { Material } from "three"
import {
  chamfer, turned, bevelPanel, moulding, rolledSheet,
  LEG_TURNED, SCALE, rng, jitter, type Profile,
} from "../three/kit"
import { M } from "../three/materials"
import { PAL } from "../three/palette"

// ── Shared props ─────────────────────────────────────────────────────────────

export type PieceProps = {
  position?: [number, number, number]
  rotation?: [number, number, number]
}

// ── Lathe profiles local to this file ────────────────────────────────────────

/** Chair leg: 0.455 tall so it tenons up into the 0.405–0.450 seat frame. */
const CHAIR_LEG: Profile = [
  [0.022, 0.000], [0.026, 0.016], [0.022, 0.040],
  [0.016, 0.092], [0.019, 0.130], [0.018, 0.300],
  [0.023, 0.338], [0.017, 0.378], [0.022, 0.420],
  [0.025, 0.455],
]

/** Stool leg: 0.615 long, splayed out from under the seat. */
const STOOL_LEG: Profile = [
  [0.019, 0.000], [0.023, 0.018], [0.020, 0.046],
  [0.014, 0.104], [0.018, 0.160], [0.017, 0.352],
  [0.023, 0.398], [0.016, 0.438], [0.022, 0.492],
  [0.026, 0.556], [0.029, 0.615],
]

/** Saddle-dished round stool seat, 0.32 across, 0.041 thick at the rim. */
const STOOL_SEAT: Profile = [
  [0.000, 0.000], [0.148, 0.000], [0.158, 0.008],
  [0.160, 0.024], [0.152, 0.036], [0.130, 0.041],
  [0.080, 0.037], [0.000, 0.031],
]

/** Steel pivot bar for the drafting board — collared ends, waisted middle. */
const PIVOT_BAR: Profile = [
  [0.000, 0.000], [0.018, 0.000], [0.020, 0.006], [0.020, 0.024],
  [0.013, 0.038], [0.013, 1.062], [0.020, 1.076], [0.020, 1.094],
  [0.018, 1.100], [0.000, 1.100],
]

/** Small brass knob for the workbench drawer till. */
const KNOB: Profile = [
  [0.000, 0.000], [0.013, 0.000], [0.013, 0.006], [0.007, 0.013],
  [0.009, 0.021], [0.016, 0.029], [0.014, 0.036], [0.000, 0.038],
]

/** Vise screw: hand-wheel boss, shoulder collar, then the shaft. */
const VISE_SCREW: Profile = [
  [0.000, 0.000], [0.034, 0.000], [0.036, 0.010], [0.030, 0.020],
  [0.016, 0.028], [0.016, 0.060], [0.020, 0.072], [0.020, 0.084],
  [0.014, 0.096], [0.014, 0.300], [0.000, 0.300],
]

/** Vise handle bar with upset ends so it cannot slip through the boss. */
const VISE_HANDLE: Profile = [
  [0.000, 0.000], [0.019, 0.006], [0.021, 0.018], [0.011, 0.030],
  [0.010, 0.300], [0.021, 0.312], [0.019, 0.324], [0.000, 0.330],
]

/** Plain guide rod. */
const VISE_ROD: Profile = [
  [0.000, 0.000], [0.011, 0.000], [0.011, 0.190], [0.000, 0.190],
]

/**
 * A round-section ring, revolved: a circle offset from the lathe axis. The
 * profile starts at angle π so the one shading seam faces the axis, where no
 * one will ever see it.
 */
function ringProfile(ringR: number, tubeR: number, n = 10): Profile {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI + (i / n) * Math.PI * 2
    return [ringR + tubeR * Math.cos(a), tubeR * Math.sin(a)] as [number, number]
  })
}

const STOOL_RING: Profile = ringProfile(0.127, 0.011, 12)

// ── Deterministic variation ──────────────────────────────────────────────────

/** Which wood each butcher-block strip was cut from. Fixed at module load. */
const stripRand = rng(1173)
const BENCH_STRIP_TONE: number[] = Array.from({ length: 9 }, () =>
  Math.floor(stripRand() * 4),
)

/** Rolled sheets on the drafting table shelf — hand-set, not aligned. */
const rollRand = rng(4421)
const SHELF_ROLLS: Array<{ p: [number, number, number]; yaw: number }> = [
  { p: [-0.040, 0.384, -0.006], yaw: jitter(rollRand, 0.07) },
  { p: [-0.100, 0.384, 0.066], yaw: jitter(rollRand, 0.07) },
  { p: [-0.055, 0.446, 0.030], yaw: jitter(rollRand, 0.09) },
]

// ── Small shared parts ───────────────────────────────────────────────────────

/**
 * Brass cup pull. The moulding profile is exactly the right silhouette: full
 * projection at the bottom lip, tucking back in toward the top.
 */
function CupPull({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh
        geometry={chamfer(0.106, 0.050, 0.005, 0.002)}
        material={M.brass()}
        position={[0, 0, 0.0025]}
        castShadow
      />
      <mesh
        geometry={moulding(0.096, 0.040, 0.020)}
        material={M.brass()}
        rotation={[0, Math.PI, 0]}
        position={[0, -0.002, 0.015]}
        castShadow
      />
    </group>
  )
}

/**
 * A gently bowed rail — a chair slat is never dead flat. Built from a few
 * short chamfered segments set on a shallow parabola and rotated to the
 * local tangent, which reads as a curve from any sane viewing distance.
 */
function CurvedSlat({
  width, height, thickness, bow, material, position, segments = 5, chamferR = 0.003,
}: {
  width: number
  height: number
  thickness: number
  bow: number
  material: Material
  position: [number, number, number]
  segments?: number
  chamferR?: number
}) {
  const segW = (width / segments) * 1.09
  return (
    <group position={position}>
      {Array.from({ length: segments }, (_, i) => {
        const t = (i + 0.5) / segments - 0.5
        const x = t * width
        const u = t * 2
        const z = -bow * (1 - u * u)
        const slope = (8 * bow * x) / (width * width)
        return (
          <mesh
            key={i}
            geometry={chamfer(segW, height, thickness, chamferR)}
            position={[x, 0, z]}
            rotation={[0, -Math.atan(slope), 0]}
            material={material}
            castShadow
            receiveShadow
          />
        )
      })}
    </group>
  )
}

/** Slatted softwood crate for the workbench shelf. */
function Crate({ position, rotation }: PieceProps) {
  const W = 0.34, D = 0.26, H = 0.22
  return (
    <group position={position} rotation={rotation}>
      <mesh
        geometry={chamfer(W, 0.014, D, 0.004)}
        material={M.birch()}
        position={[0, 0.007, 0]}
        castShadow
        receiveShadow
      />
      {[-1, 1].map(sx =>
        [-1, 1].map(sz => (
          <mesh
            key={`p${sx}${sz}`}
            geometry={chamfer(0.026, H, 0.026, 0.004)}
            material={M.walnut()}
            position={[sx * (W / 2 - 0.013), H / 2, sz * (D / 2 - 0.013)]}
            castShadow
          />
        )),
      )}
      {[0.056, 0.156].map((y, i) => (
        <group key={`s${i}`}>
          {[-1, 1].map(sz => (
            <mesh
              key={sz}
              geometry={chamfer(W, 0.070, 0.012, 0.003)}
              material={M.oakPanel()}
              position={[0, y, sz * (D / 2 - 0.006)]}
              castShadow
            />
          ))}
          {[-1, 1].map(sx => (
            <mesh
              key={`e${sx}`}
              geometry={chamfer(0.012, 0.070, D - 0.026, 0.003)}
              material={M.oakPanel()}
              position={[sx * (W / 2 - 0.006), y, 0]}
              castShadow
            />
          ))}
        </group>
      ))}
    </group>
  )
}

// ── Main desk ────────────────────────────────────────────────────────────────

const DESK_W = 1.70
const DESK_D = 0.82
const DESK_TOP = SCALE.deskTop          // 0.75 — finished surface height
const DESK_LEG_X = 0.740                // legs inset → the top overhangs 0.074
const DESK_LEG_Z = 0.300
const DESK_APRON_Y = 0.6725             // apron spans 0.635 → 0.710

/** Drawer carcass on the right-hand side. It has to die inside the leg
 *  envelope: the legs stand at x ±0.740 with a 0.036 radius, so anything past
 *  x 0.704 is inside the leg, and a 0.560-deep box overshoots the 0.264 inner
 *  face of the leg pair. The old box did both and the legs came up through
 *  the drawer bottom. */
const DRW_X0 = 0.255, DRW_X1 = 0.704
const DRW_CX = (DRW_X0 + DRW_X1) / 2
const DRW_W = DRW_X1 - DRW_X0
const DRW_FRONT_Z = 0.300

export function MainDesk({
  position = [2.6, 0, 1.7],
  rotation = [0, 0, 0],
}: PieceProps) {
  const leg = turned(LEG_TURNED)
  return (
    <group name="MainDesk" position={position} rotation={rotation}>
      {/* Top: the overhang is what makes it read as furniture, not a slab */}
      <mesh
        geometry={chamfer(DESK_W, 0.040, DESK_D, 0.008)}
        material={M.oakTop()}
        position={[0, DESK_TOP - 0.020, 0]}
        castShadow
        receiveShadow
      />
      {/* Sub-top bead: a small reveal under the edge so the top reads moulded */}
      <mesh
        geometry={chamfer(DESK_W - 0.060, 0.012, DESK_D - 0.060, 0.004)}
        material={M.oakPanel()}
        position={[0, 0.705, 0]}
        castShadow
      />

      {/* Turned legs, tenoned up into the top */}
      {[-1, 1].map(sx =>
        [-1, 1].map(sz => (
          <mesh
            key={`l${sx}${sz}`}
            geometry={leg}
            material={M.walnutLeg()}
            position={[sx * DESK_LEG_X, 0, sz * DESK_LEG_Z]}
            castShadow
            receiveShadow
          />
        )),
      )}

      {/* Apron — shallower than the drawer box, set back from the leg faces */}
      <mesh
        geometry={chamfer(DESK_LEG_X * 2, 0.075, 0.024, 0.004)}
        material={M.oakPanel()}
        position={[0, DESK_APRON_Y, -DESK_LEG_Z]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.995, 0.075, 0.024, 0.004)}
        material={M.oakPanel()}
        position={[-0.2425, DESK_APRON_Y, DESK_LEG_Z]}
        castShadow
      />
      {[-1, 1].map(sx => (
        <mesh
          key={`a${sx}`}
          geometry={chamfer(0.024, 0.075, DESK_LEG_Z * 2, 0.004)}
          material={M.oakPanel()}
          position={[sx * DESK_LEG_X, DESK_APRON_Y, 0]}
          castShadow
        />
      ))}

      {/* Modesty panel */}
      <mesh
        geometry={bevelPanel(1.420, 0.290, 0.014, 0.004)}
        material={M.oakPanel()}
        position={[0, 0.540, -0.282]}
        castShadow
      />

      {/* Drawer carcass */}
      <mesh
        geometry={chamfer(0.016, 0.260, 0.516, 0.004)}
        material={M.oakPanel()}
        position={[DRW_X0 + 0.008, 0.580, 0]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.016, 0.260, 0.516, 0.004)}
        material={M.oakPanel()}
        position={[DRW_X1 - 0.008, 0.580, 0]}
        castShadow
      />
      <mesh
        geometry={chamfer(DRW_W, 0.016, 0.516, 0.004)}
        material={M.oakPanel()}
        position={[DRW_CX, 0.458, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(DRW_W, 0.260, 0.012, 0.004)}
        material={M.oakPanel()}
        position={[DRW_CX, 0.580, -0.252]}
        castShadow
      />
      {/* Divider rail between the two drawers */}
      <mesh
        geometry={chamfer(DRW_W - 0.032, 0.014, 0.516, 0.003)}
        material={M.oakPanel()}
        position={[DRW_CX, 0.600, 0]}
        castShadow
        receiveShadow
      />

      {/* Graduated drawer fronts — the lower drawer is the deeper one */}
      <mesh
        geometry={bevelPanel(0.425, 0.094, 0.018, 0.004)}
        material={M.birch()}
        position={[DRW_CX, 0.6585, DRW_FRONT_Z]}
        castShadow
      />
      <mesh
        geometry={bevelPanel(0.425, 0.118, 0.018, 0.004)}
        material={M.birch()}
        position={[DRW_CX, 0.5295, DRW_FRONT_Z]}
        castShadow
      />
      <CupPull position={[DRW_CX, 0.6585, DRW_FRONT_Z + 0.009]} />
      <CupPull position={[DRW_CX, 0.5295, DRW_FRONT_Z + 0.009]} />
    </group>
  )
}

// ── Drafting table ───────────────────────────────────────────────────────────

const TILT = 0.35            // ≈ 20°
const PIVOT_Y = 0.880
const PIVOT_Z = -0.180
const FRAME_X = 0.500
const SPLAY = 0.060          // feet kick out from under the pivot

/** Where the drawing surface is, for the sheet pinned to it (Workshop.tsx):
 *  the board group's pivot and tilt, and the top face in that group's frame. */
export const DRAFTING_BOARD = { tilt: TILT, pivotY: PIVOT_Y, pivotZ: PIVOT_Z, topY: 0.048, centerZ: 0.140 }

/**
 * Place a linear member between two points of the table's side elevation.
 * Points are given as [z, y]; the returned rotation puts the member's local
 * +Y along z→y, so a chamfer(w, length, t) lands exactly on both ends.
 *
 * Hand-authored Euler angles are how the brace and the prop ended up rotated
 * a quarter-turn the wrong way and stabbing up through the drawing board.
 * Deriving them from the endpoints removes that whole class of mistake.
 */
function span(from: [number, number], to: [number, number]) {
  const dz = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dy, dz)
  return {
    length,
    position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as [number, number],
    rotX: Math.atan2(dz / length, dy / length),
  }
}

/** The board's underside, as a plane over z. Every fixed part must stay under
 *  it: y = 0.8356 − 0.365·z, valid for z in −0.441 … 0.367. */

// Knee brace, back post → head of the front post.
const BRACE = span([-0.185, -0.472], [0.255, -0.190])   // frame-local y
// Prop strut, board underside → its notch on the rack.
const STRUT = span([0.231, 0.612], [0.020, 0.800])      // table-local y
const STRUT_DIR: [number, number] = [
  (0.231 - 0.020) / STRUT.length,
  (0.612 - 0.800) / STRUT.length,
]

export function DraftingTable({
  position = [-1.4, 0, -3.5],
  rotation = [0, 0, 0],
}: PieceProps) {
  return (
    <group name="DraftingTable" position={position} rotation={rotation}>
      {/* ── Splayed side frames ────────────────────────────────────────── */}
      {[-1, 1].map(sx => (
        <group
          key={`f${sx}`}
          position={[sx * FRAME_X, PIVOT_Y, 0]}
          rotation={[0, 0, sx * SPLAY]}
        >
          <mesh
            geometry={chamfer(0.058, 0.880, 0.052, 0.006)}
            material={M.walnut()}
            position={[0, -0.440, -0.200]}
            castShadow
            receiveShadow
          />
          {/* The board tilts down toward the front, so its underside at this
              post's z sits at 0.731. A full-height post came up through the
              drawing surface; this one stops 13 mm clear of it. */}
          <mesh
            geometry={chamfer(0.058, 0.718, 0.052, 0.006)}
            material={M.walnut()}
            position={[0, -0.521, 0.260]}
            castShadow
            receiveShadow
          />
          {/* Bearing block on the head of the back post, and the steel saddle
              strapping the pivot bar into it. The rail that used to sit here
              cantilevered 74 mm off the back of the frame with nothing under
              it — from the room camera it read as a stray offcut. The strap
              wraps the block at the bar's centreline; anything higher fouls
              the board, which rakes up to 0.909 at this z. */}
          <mesh
            geometry={chamfer(0.062, 0.040, 0.096, 0.006)}
            material={M.walnut()}
            position={[0, -0.020, -0.200]}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={chamfer(0.070, 0.026, 0.038, 0.004)}
            material={M.steel()}
            position={[0, -0.006, -0.200]}
            castShadow
          />
          {/* Knee brace triangulating the frame — dies into the back post at
              mid height, lands on the head of the short front post. Clears
              the shelf below and the board above. */}
          <mesh
            geometry={chamfer(0.040, BRACE.length, 0.038, 0.006)}
            material={M.walnut()}
            position={[0, BRACE.position[1], BRACE.position[0]]}
            rotation={[BRACE.rotX, 0, 0]}
            castShadow
            receiveShadow
          />
          {/* Foot runner */}
          <mesh
            geometry={chamfer(0.078, 0.050, 0.660, 0.008)}
            material={M.walnut()}
            position={[0, -0.855, 0.030]}
            castShadow
            receiveShadow
          />
        </group>
      ))}

      {/* ── Steel pivot bar the board swings about ─────────────────────── */}
      <mesh
        geometry={turned(PIVOT_BAR, 14)}
        material={M.steel()}
        position={[-0.550, PIVOT_Y, PIVOT_Z]}
        rotation={[0, 0, -Math.PI / 2]}
        castShadow
      />

      {/* ── The board, hinged on that bar ──────────────────────────────── */}
      <group position={[0, PIVOT_Y, PIVOT_Z]} rotation={[TILT, 0, 0]}>
        <mesh
          geometry={chamfer(1.250, 0.028, 0.850, 0.005)}
          material={M.oakPanel()}
          position={[0, 0.034, 0.140]}
          castShadow
          receiveShadow
        />
        {/* Cleats clamping the board to the bar */}
        {[-1, 1].map(sx => (
          <mesh
            key={`c${sx}`}
            geometry={chamfer(0.060, 0.022, 0.800, 0.004)}
            material={M.walnut()}
            position={[sx * 0.500, 0.009, 0.140]}
            castShadow
          />
        ))}
        {/* Steel bracket the prop strut is pinned to, under the board. */}
        <mesh
          geometry={chamfer(0.032, 0.040, 0.028, 0.004)}
          material={M.steel()}
          position={[0.440, 0.004, 0.215]}
          castShadow
        />
        {/* Pencil ledge along the low edge */}
        <mesh
          geometry={chamfer(1.250, 0.030, 0.032, 0.005)}
          material={M.walnut()}
          position={[0, 0.062, 0.548]}
          castShadow
          receiveShadow
        />
      </group>

      {/* ── Adjustment strut and its notched rack ──────────────────────── */}
      {/* Rack sits inboard of the right frame, spanning post to post — it used
          to cantilever 83 mm past the front of the table with nothing under
          it. The strut runs in the other plane so the two never meet. */}
      <mesh
        geometry={chamfer(0.090, 0.030, 0.470, 0.005)}
        material={M.walnut()}
        position={[0.420, 0.575, 0.045]}
        castShadow
        receiveShadow
      />
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={`n${i}`}
          geometry={chamfer(0.028, 0.020, 0.020, 0.003)}
          material={M.walnut()}
          position={[0.420, 0.600, -0.120 + i * 0.078]}
          castShadow
        />
      ))}
      <mesh
        geometry={chamfer(0.028, STRUT.length, 0.024, 0.004)}
        material={M.walnut()}
        position={[0.440, STRUT.position[1], STRUT.position[0]]}
        rotation={[STRUT.rotX, 0, 0]}
        castShadow
      />
      {/* Steel shoe on the foot of the strut, standing on the rack between
          the fifth and sixth notch. */}
      <mesh
        geometry={chamfer(0.036, 0.018, 0.030, 0.003)}
        material={M.steel()}
        position={[
          0.440,
          0.612 + STRUT_DIR[1] * 0.006,
          0.231 + STRUT_DIR[0] * 0.006,
        ]}
        rotation={[STRUT.rotX, 0, 0]}
        castShadow
      />

      {/* ── Stretcher shelf ────────────────────────────────────────────── */}
      {[-0.190, 0.280].map((z, i) => (
        <mesh
          key={`b${i}`}
          geometry={chamfer(1.030, 0.055, 0.048, 0.006)}
          material={M.walnut()}
          position={[0, 0.300, z]}
          castShadow
          receiveShadow
        />
      ))}
      <mesh
        geometry={chamfer(0.980, 0.020, 0.460, 0.005)}
        material={M.oakPanel()}
        position={[0, 0.338, 0.045]}
        castShadow
        receiveShadow
      />
      {SHELF_ROLLS.map((r, i) => (
        <mesh
          key={`r${i}`}
          geometry={rolledSheet(0.680, 0.036)}
          material={M.blueprint()}
          position={r.p}
          rotation={[0, r.yaw, Math.PI / 2]}
          castShadow
        />
      ))}
    </group>
  )
}

// ── Workbench ────────────────────────────────────────────────────────────────

export const BENCH_TOP_Y = 0.900
const BENCH_SLAB = 0.075
const BENCH_UNDER = BENCH_TOP_Y - BENCH_SLAB    // 0.825
const BENCH_LEG_X = 0.820
const BENCH_LEG_Z = 0.250
const VISE_X = -0.620

const STRIP_TONES = () => [M.benchTop(), M.benchTop(), M.oakPanel(), M.oakTop()]

/**
 * Built with its length along local X so the lamination runs the way the task
 * describes; the default rotation stands it against the left wall, front
 * face out into the room.
 */
export function Workbench({
  position = [-5.1, 0, 1.4],
  rotation = [0, Math.PI / 2, 0],
}: PieceProps) {
  const tones = STRIP_TONES()
  return (
    <group name="Workbench" position={position} rotation={rotation}>
      {/* ── Laminated butcher-block top ────────────────────────────────── */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh
          key={`st${i}`}
          geometry={chamfer(1.900, BENCH_SLAB, 0.079, 0.004)}
          material={tones[BENCH_STRIP_TONE[i]]}
          position={[0, BENCH_TOP_Y - BENCH_SLAB / 2, -0.320 + i * 0.080]}
          castShadow
          receiveShadow
        />
      ))}
      {/* Breadboard ends capping the strip end-grain */}
      {[-1, 1].map(sx => (
        <mesh
          key={`bb${sx}`}
          geometry={chamfer(0.050, BENCH_SLAB + 0.002, 0.720, 0.006)}
          material={M.walnut()}
          position={[sx * 0.975, BENCH_TOP_Y - BENCH_SLAB / 2, 0]}
          castShadow
          receiveShadow
        />
      ))}

      {/* ── Chunky legs ────────────────────────────────────────────────── */}
      {[-1, 1].map(sx =>
        [-1, 1].map(sz => (
          <mesh
            key={`bl${sx}${sz}`}
            geometry={chamfer(0.092, BENCH_UNDER, 0.092, 0.010)}
            material={M.walnut()}
            position={[sx * BENCH_LEG_X, BENCH_UNDER / 2, sz * BENCH_LEG_Z]}
            castShadow
            receiveShadow
          />
        )),
      )}

      {/* ── Stretchers, staggered so the mortises miss each other ──────── */}
      {[-1, 1].map(sz => (
        <mesh
          key={`ls${sz}`}
          geometry={chamfer(1.700, 0.095, 0.048, 0.006)}
          material={M.walnut()}
          position={[0, 0.235, sz * BENCH_LEG_Z]}
          castShadow
          receiveShadow
        />
      ))}
      {[-1, 1].map(sx => (
        <mesh
          key={`cs${sx}`}
          geometry={chamfer(0.050, 0.085, 0.440, 0.006)}
          material={M.walnut()}
          position={[sx * BENCH_LEG_X, 0.115, 0]}
          castShadow
          receiveShadow
        />
      ))}
      {/* Through-tenons, left proud and in a contrasting wood */}
      {[-1, 1].map(sx =>
        [-1, 1].map(sz => (
          <mesh
            key={`t1${sx}${sz}`}
            geometry={chamfer(0.030, 0.046, 0.040, 0.004)}
            material={M.mahogany()}
            position={[sx * 0.876, 0.235, sz * BENCH_LEG_Z]}
            castShadow
          />
        )),
      )}
      {[-1, 1].map(sx =>
        [-1, 1].map(sz => (
          <mesh
            key={`t2${sx}${sz}`}
            geometry={chamfer(0.040, 0.044, 0.026, 0.004)}
            material={M.mahogany()}
            position={[sx * BENCH_LEG_X, 0.115, sz * 0.302]}
            castShadow
          />
        )),
      )}

      {/* ── Shelf and crates ───────────────────────────────────────────── */}
      {/* Stops 4 mm inside the legs. At 1.680 its ends ran 66 mm into them. */}
      <mesh
        geometry={chamfer(1.540, 0.022, 0.520, 0.005)}
        material={M.oakPanel()}
        position={[0, 0.294, 0]}
        castShadow
        receiveShadow
      />
      <Crate position={[-0.450, 0.305, -0.010]} rotation={[0, 0.06, 0]} />
      <Crate position={[0.110, 0.305, 0.020]} rotation={[0, -0.10, 0]} />

      {/* ── Till of shallow drawers under the right of the top ─────────── */}
      <mesh
        geometry={chamfer(0.016, 0.170, 0.480, 0.004)}
        material={M.oakPanel()}
        position={[0.148, 0.740, 0.100]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.016, 0.170, 0.480, 0.004)}
        material={M.oakPanel()}
        position={[0.752, 0.740, 0.100]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.620, 0.016, 0.480, 0.004)}
        material={M.oakPanel()}
        position={[0.450, 0.663, 0.100]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(0.620, 0.170, 0.012, 0.004)}
        material={M.oakPanel()}
        position={[0.450, 0.740, -0.134]}
        castShadow
      />
      {[0.3497, 0.5503].map((x, i) => (
        <mesh
          key={`dv${i}`}
          geometry={chamfer(0.014, 0.154, 0.480, 0.003)}
          material={M.oakPanel()}
          position={[x, 0.748, 0.100]}
          castShadow
        />
      ))}
      {[0.2493, 0.4500, 0.6507].map((x, i) => (
        <group key={`dw${i}`}>
          <mesh
            geometry={bevelPanel(0.178, 0.144, 0.018, 0.004)}
            material={M.birch()}
            position={[x, 0.748, 0.348]}
            castShadow
          />
          <mesh
            geometry={turned(KNOB, 12)}
            material={M.brass()}
            position={[x, 0.748, 0.357]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          />
        </group>
      ))}

      {/* ── Front vise on the near-left corner ─────────────────────────── */}
      <mesh
        geometry={chamfer(0.300, 0.052, 0.160, 0.005)}
        material={M.steelDark()}
        position={[VISE_X, 0.797, 0.300]}
        castShadow
      />
      {/* Fixed jaw, bolted to the bench edge */}
      <mesh
        geometry={chamfer(0.260, 0.170, 0.028, 0.004)}
        material={M.steel()}
        position={[VISE_X, 0.740, 0.352]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.250, 0.150, 0.020, 0.004)}
        material={M.walnut()}
        position={[VISE_X, 0.745, 0.376]}
        castShadow
      />
      {/* Movable jaw, wound open a couple of centimetres */}
      <mesh
        geometry={chamfer(0.250, 0.155, 0.020, 0.004)}
        material={M.walnut()}
        position={[VISE_X, 0.740, 0.418]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.260, 0.180, 0.030, 0.004)}
        material={M.steel()}
        position={[VISE_X, 0.735, 0.443]}
        castShadow
      />
      {/* Screw and guide rods */}
      <mesh
        geometry={turned(VISE_SCREW, 14)}
        material={M.steel()}
        position={[VISE_X, 0.745, 0.500]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow
      />
      {[-1, 1].map(sx => (
        <mesh
          key={`vr${sx}`}
          geometry={turned(VISE_ROD, 10)}
          material={M.steelDark()}
          position={[VISE_X + sx * 0.088, 0.700, 0.455]}
          rotation={[-Math.PI / 2, 0, 0]}
          castShadow
        />
      ))}
      {/* Handle bar through the boss */}
      <mesh
        geometry={turned(VISE_HANDLE, 10)}
        material={M.steel()}
        position={[VISE_X - 0.165, 0.745, 0.508]}
        rotation={[0, 0, -Math.PI / 2]}
        castShadow
      />
    </group>
  )
}

// ── Chair ────────────────────────────────────────────────────────────────────

const SEAT_Y = SCALE.seatHeight     // 0.45
const POST_X = 0.195
const POST_Z = -0.185
const RAKE = 0.070                  // back posts lean back above the seat

/** z of the back-post centre line at a given height. */
const postZ = (y: number) => POST_Z - y * Math.tan(RAKE)

export function Chair({
  position = [2.6, 0, 2.55],
  rotation = [0, Math.PI, 0],
}: PieceProps) {
  return (
    <group name="Chair" position={position} rotation={rotation}>
      {/* ── Back legs, continuing up as the back posts (one piece) ─────── */}
      {[-1, 1].map(sx => (
        <group
          key={`bp${sx}`}
          position={[sx * POST_X, 0, POST_Z]}
          rotation={[-RAKE, 0, 0]}
        >
          <mesh
            geometry={chamfer(0.036, 0.910, 0.040, 0.005)}
            material={M.walnut()}
            position={[0, 0.455, 0]}
            castShadow
            receiveShadow
          />
        </group>
      ))}

      {/* ── Turned front legs ──────────────────────────────────────────── */}
      {[-1, 1].map(sx => (
        <mesh
          key={`fl${sx}`}
          geometry={turned(CHAIR_LEG)}
          material={M.walnutLeg()}
          position={[sx * POST_X, 0, 0.175]}
          castShadow
          receiveShadow
        />
      ))}

      {/* ── Stretchers, staggered in height ────────────────────────────── */}
      {[-1, 1].map(sx => (
        <mesh
          key={`ss${sx}`}
          geometry={chamfer(0.026, 0.030, 0.370, 0.004)}
          material={M.walnut()}
          position={[sx * POST_X, 0.190, -0.010]}
          castShadow
        />
      ))}
      <mesh
        geometry={chamfer(0.360, 0.028, 0.026, 0.004)}
        material={M.walnut()}
        position={[0, 0.155, 0.175]}
        castShadow
      />
      <mesh
        geometry={chamfer(0.360, 0.028, 0.026, 0.004)}
        material={M.walnut()}
        position={[0, 0.235, postZ(0.235)]}
        castShadow
      />

      {/* ── Seat: main slab plus a heavily rounded front nosing ────────── */}
      <mesh
        geometry={chamfer(0.440, 0.045, 0.360, 0.006)}
        material={M.oakPanel()}
        position={[0, SEAT_Y - 0.0225, -0.030]}
        castShadow
        receiveShadow
      />
      {/* 20 mm roundover — a real chair's front edge really is this soft */}
      <mesh
        geometry={chamfer(0.440, 0.045, 0.075, 0.020)}
        material={M.oakPanel()}
        position={[0, SEAT_Y - 0.0225, 0.1875]}
        castShadow
        receiveShadow
      />
      {/* Leather pad, proud of the frame */}
      <mesh
        geometry={chamfer(0.400, 0.028, 0.385, 0.012)}
        material={M.leather()}
        position={[0, SEAT_Y + 0.014, -0.005]}
        castShadow
        receiveShadow
      />

      {/* ── Back: two bowed slats and a crest rail ─────────────────────── */}
      <CurvedSlat
        width={0.362}
        height={0.075}
        thickness={0.016}
        bow={0.016}
        material={M.oakPanel()}
        position={[0, 0.590, postZ(0.590)]}
      />
      <CurvedSlat
        width={0.362}
        height={0.075}
        thickness={0.016}
        bow={0.016}
        material={M.oakPanel()}
        position={[0, 0.730, postZ(0.730)]}
      />
      <CurvedSlat
        width={0.452}
        height={0.062}
        thickness={0.030}
        bow={0.022}
        chamferR={0.005}
        material={M.walnut()}
        position={[0, 0.870, postZ(0.870)]}
      />
    </group>
  )
}

// ── Stool ────────────────────────────────────────────────────────────────────

const STOOL_SPLAY = 0.320
const STOOL_HUB_Y = 0.584          // where the leg tops meet the seat underside

export function Stool({
  position = [-4.32, 0, 0.85],
  rotation = [0, 0.4, 0],
}: PieceProps) {
  return (
    <group name="Stool" position={position} rotation={rotation}>
      {/* Dished round seat at 0.62 — bench height, not desk height */}
      <mesh
        geometry={turned(STOOL_SEAT, 24)}
        material={M.oakTop()}
        position={[0, 0.579, 0]}
        castShadow
        receiveShadow
      />

      {/* Three splayed turned legs */}
      {[0, 1, 2].map(i => (
        <group key={`sl${i}`} rotation={[0, (i * Math.PI * 2) / 3, 0]}>
          <group position={[0, STOOL_HUB_Y, 0]} rotation={[STOOL_SPLAY, 0, 0]}>
            <mesh
              geometry={turned(STOOL_LEG)}
              material={M.walnutLeg()}
              position={[0, -0.615, 0]}
              castShadow
              receiveShadow
            />
          </group>
        </group>
      ))}

      {/* Single ring stretcher, let into all three legs */}
      <mesh
        geometry={turned(STOOL_RING, 20)}
        material={M.walnutLeg()}
        position={[0, 0.200, 0]}
        castShadow
      />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Armchair and side table — the foreground nook
// ═══════════════════════════════════════════════════════════════════════════
//
// The room is twelve metres across and every working surface sits in the back
// half, which left the whole near corner as bare floor. An isometric view puts
// that emptiness front and centre. A seat, a small table and a lamp fill it,
// and give an idle agent somewhere to be that is not a desk.

const ARM_LEG: Profile = [
  [0.026, 0.000], [0.030, 0.018], [0.024, 0.060],
  [0.026, 0.180], [0.030, 0.215],
]

export function Armchair({ position = [3.55, 0, 3.60], rotation = [0, -2.35, 0] }: PieceProps) {
  const frame = M.walnut()
  const pad   = M.leather()

  return (
    <group name="Armchair" position={position} rotation={rotation}>
      {/* turned legs */}
      {[-1, 1].flatMap(sx => [-1, 1].map(sz => (
        <mesh
          key={`${sx}${sz}`}
          geometry={turned(ARM_LEG, 10)}
          material={M.walnutLeg()}
          position={[sx * 0.32, 0, sz * 0.28]}
          castShadow
        />
      )))}

      {/* ── Seat: frame, squab, domed top and a rolled front edge ───────── */}
      <mesh
        geometry={chamfer(0.78, 0.070, 0.70, 0.016)}
        material={frame}
        position={[0, 0.250, 0]}
        castShadow receiveShadow
      />
      <mesh
        geometry={chamfer(0.700, 0.090, 0.620, 0.030)}
        material={pad}
        position={[0, 0.325, 0.012]}
        castShadow receiveShadow
      />
      {/* A cushion is not a slab: the crown sits proud of the squab and the
          front edge rolls over. Without these the chair read as a cut block
          from the room camera, which only ever sees it from behind. */}
      <mesh
        geometry={chamfer(0.636, 0.044, 0.556, 0.021)}
        material={pad}
        position={[0, 0.368, 0.008]}
        castShadow receiveShadow
      />
      <mesh
        geometry={chamfer(0.700, 0.092, 0.092, 0.045)}
        material={pad}
        position={[0, 0.334, 0.286]}
        castShadow
      />

      {/* ── Back: a slatted frame with two cushions laid against it ─────── */}
      <group position={[0, 0.545, -0.315]} rotation={[-0.10, 0, 0]}>
        {[-1, 1].map(sx => (
          <mesh
            key={sx}
            geometry={chamfer(0.062, 0.520, 0.070, 0.020)}
            material={frame}
            position={[sx * 0.345, 0, 0]}
            castShadow
          />
        ))}
        <mesh
          geometry={chamfer(0.760, 0.070, 0.090, 0.026)}
          material={frame}
          position={[0, 0.255, -0.012]}
          castShadow
        />
        <mesh
          geometry={chamfer(0.700, 0.055, 0.070, 0.020)}
          material={frame}
          position={[0, -0.225, 0]}
          castShadow
        />
        {Array.from({ length: 5 }, (_, i) => (
          <mesh
            key={`sl${i}`}
            geometry={chamfer(0.054, 0.440, 0.022, 0.006)}
            material={frame}
            position={[-0.24 + i * 0.12, 0.010, -0.020]}
            castShadow receiveShadow
          />
        ))}
        <mesh
          geometry={chamfer(0.620, 0.230, 0.090, 0.036)}
          material={pad}
          position={[0, -0.080, 0.052]}
          castShadow
        />
        <mesh
          geometry={chamfer(0.620, 0.180, 0.078, 0.034)}
          material={pad}
          position={[0, 0.150, 0.046]}
          castShadow
        />
      </group>

      {/* ── Arms: rail, padded top, front support ───────────────────────── */}
      {[-1, 1].map(sx => (
        <group key={sx}>
          <mesh
            geometry={chamfer(0.080, 0.058, 0.640, 0.026)}
            material={frame}
            position={[sx * 0.345, 0.505, -0.010]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.086, 0.038, 0.600, 0.018)}
            material={pad}
            position={[sx * 0.345, 0.549, -0.010]}
            castShadow
          />
          {/* Stands on the seat frame. It used to start 5 mm above it. */}
          <mesh
            geometry={turned(ARM_LEG, 10)}
            material={M.walnutLeg()}
            position={[sx * 0.345, 0.278, 0.245]}
            scale={[1, 1.02, 1]}
            castShadow
          />
        </group>
      ))}
    </group>
  )
}

export function SideTable({ position = [4.45, 0, 2.78], rotation = [0, 0.4, 0] }: PieceProps) {
  return (
    <group name="SideTable" position={position} rotation={rotation}>
      <mesh
        geometry={chamfer(0.50, 0.038, 0.50, 0.012)}
        material={M.oakTop()}
        position={[0, 0.500, 0]}
        castShadow receiveShadow
      />
      {/* a shallow apron under the top, so the edge is not a bare slab */}
      <mesh
        geometry={chamfer(0.44, 0.045, 0.44, 0.008)}
        material={M.walnut()}
        position={[0, 0.458, 0]}
        castShadow
      />
      {[-1, 1].flatMap(sx => [-1, 1].map(sz => (
        <mesh
          key={`${sx}${sz}`}
          geometry={taperedBoxLeg()}
          material={M.walnutLeg()}
          position={[sx * 0.205, 0.218, sz * 0.205]}
          castShadow
        />
      )))}
      {/* under-shelf with a couple of books left on it */}
      <mesh
        geometry={chamfer(0.38, 0.022, 0.38, 0.008)}
        material={M.oakPanel()}
        position={[0, 0.170, 0]}
        castShadow receiveShadow
      />
      {[0, 1].map(i => (
        <mesh
          key={i}
          geometry={chamfer(0.22, 0.035, 0.16, 0.005)}
          material={M.bookSpine(PAL.books[i * 3], 40 + i)}
          position={[0.01, 0.200 + i * 0.037, -0.02 + i * 0.012]}
          rotation={[0, 0.08 - i * 0.15, 0]}
          castShadow
        />
      ))}
    </group>
  )
}

/** Square tapered leg, used by the side table. */
function taperedBoxLeg() {
  return chamfer(0.042, 0.436, 0.042, 0.010)
}
