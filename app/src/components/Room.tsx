/**
 * Room.tsx — the architectural shell of the atelier.
 *
 * Everything the furniture sits inside: a real plank floor (staggered boards
 * over a dark sub-floor so the joints read as shadow), two plastered walls
 * with wainscot / chair rail / picture rail / cornice, a beamed ceiling,
 * three tall windows with deep reveals and soft afternoon light shafts, a
 * four-panel door standing ajar, and the persian rug with its linen fringe.
 *
 * Only the back wall (inner face Z = -5.90) and the left wall (inner face
 * X = -5.90) are built — the camera looks in across the open +X / +Z corner.
 *
 * Wall geometry is authored in a LOCAL frame (wall runs along local X,
 * thickness along local Z, room side at +Z) and then placed:
 *   back wall — group at z = -5.96, no rotation   → local X  =  world X
 *   left wall — group at x = -5.96, rotY = +90°   → local X  = -world Z
 */

import { useMemo, useRef, type ReactNode } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { mergeBufferGeometries } from "three-stdlib"

import {
  chamfer, taperedBox, moulding, framePanelParts, turned, rng, SCALE,
  type Profile,
} from "../three/kit"
import { M } from "../three/materials"
import { PAL } from "../three/palette"
import { door, doorWanted } from "../anim/stage"
import { wake } from "../anim/activity"
import { useWeld } from "./StaticBatch"

// ── Shell constants ──────────────────────────────────────────────────────────

const CEIL      = SCALE.ceiling      // 3.40
const HALF      = SCALE.roomHalf     // 6.00
const WALL_T    = 0.12
const FACE      = WALL_T / 2         // local z of the inner (room) face
const WALL_IN   = -(HALF - 0.10)     // -5.90, the inner face everyone builds against
const WALL_MID  = WALL_IN - WALL_T / 2   // -5.96, wall centre-line
const WALL_OUT  = WALL_MID - WALL_T / 2  // -6.02, outer face

/** Outer edge of the boarded floor — the walls' outer face is at -6.02. */
const EDGE      = HALF + 0.08        // 6.08

const WAINSCOT  = 0.95               // chair-rail height
const PIC_RAIL  = 2.50
const SKIRT_H   = 0.145

const WIN_W     = 1.30
const WIN_H     = 2.00
const WIN_SILL  = 0.85

const DOOR_W    = SCALE.doorWidth    // 0.92
const DOOR_H    = SCALE.doorHeight   // 2.10
const DOOR_T    = 0.045
const DOOR_AJAR = 0.209              // ~12°, the resting state
const DOOR_OPEN = 1.32               // ~76°, enough for someone to walk through

// Low afternoon sun: local +Y of a shaft group points along (0, -0.62, +0.78).
const SHAFT_TILT = Math.acos(-0.62)  // ≈ 2.24 rad
const SHAFT_YAW  = 0.16

// ── Turned brass profiles ────────────────────────────────────────────────────

const HANDLE_ROSE: Profile = [
  [0.000, 0.000], [0.030, 0.000], [0.032, 0.005], [0.029, 0.012],
  [0.014, 0.017], [0.013, 0.030], [0.000, 0.030],
]

const ESCUTCHEON: Profile = [
  [0.000, 0.000], [0.019, 0.000], [0.020, 0.004],
  [0.016, 0.009], [0.006, 0.011], [0.000, 0.011],
]

const HINGE_KNUCKLE: Profile = [
  [0.000, 0.000], [0.012, 0.000], [0.013, 0.005],
  [0.013, 0.095], [0.012, 0.100], [0.000, 0.100],
]

// ── Plank floor ──────────────────────────────────────────────────────────────

/**
 * Boards laid along X, 0.22 wide with an 0.008 shadow gap, broken by staggered
 * butt joints. Three tone buckets are merged into three geometries so the
 * whole floor is three draw calls instead of ~250.
 */
function PlankFloor() {
  const boards = useMemo(() => {
    const rand = rng(0x5eed17)
    const PLANK_W = 0.22
    const GAP = 0.008
    const THICK = 0.018
    const PITCH = PLANK_W + GAP
    const LENGTHS = [1.55, 1.95, 2.40, 2.85, 3.25]

    const buckets: THREE.BufferGeometry[][] = [[], [], []]
    const rows = Math.ceil((EDGE * 2) / PITCH) + 1

    for (let i = 0; i < rows; i++) {
      const z = -EDGE + PLANK_W / 2 + i * PITCH
      // Every row starts mid-board so the butt joints never line up.
      let x = -EDGE - LENGTHS[Math.floor(rand() * LENGTHS.length)] * (0.2 + rand() * 0.75)
      while (x < EDGE) {
        let len = LENGTHS[Math.floor(rand() * LENGTHS.length)]
        // Never leave a stub at the perimeter. Dropping boards narrower than
        // 24 cm used to bite notches out of the floor's outer edge, and with a
        // plinth underneath every notch showed as a dark tooth.
        if (x + len + 0.006 > EDGE - 0.24) len = EDGE - x
        const a = Math.max(x, -EDGE)
        const b = Math.min(x + len, EDGE)
        const w = Math.round((b - a) * 100) / 100
        if (w > 0.02) {
          const t = rand()
          const bucket = t < 0.40 ? 0 : t < 0.76 ? 1 : 2
          buckets[bucket].push(
            chamfer(w, THICK, PLANK_W, 0.004, 1)
              .clone()
              .translate((a + b) / 2, THICK / 2, z),
          )
        }
        x = x + len + 0.006
      }
    }

    return buckets.map((b) => (b.length > 0 ? mergeBufferGeometries(b, false) : null))
  }, [])

  const mats = [M.floorLight(), M.floorMid(), M.floorDark()]

  return (
    <group>
      {/* The slab the whole room stands on.
          Without it the floor ended in a hard line with 18 mm of plank edge
          behind it — at room scale, two pixels — and the atelier read as a
          photograph lying flat rather than as something built. A visible base
          course, a little proud of the walls, turns the same geometry into an
          architect's model sitting on a table, which is what this room is. */}
      <mesh
        geometry={chamfer(EDGE * 2, 0.20, EDGE * 2, 0.012)}
        material={M.plinth()}
        position={[0, -0.10, 0]}
        receiveShadow
        castShadow={false}
      />

      {/* Dark sub-floor so the 8 mm gaps read as shadow, not as holes. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        material={M.mahogany()}
        receiveShadow
      >
        <planeGeometry args={[HALF * 2 + 0.3, HALF * 2 + 0.3]} />
      </mesh>

      {boards.map((g, i) =>
        g ? (
          <mesh key={i} geometry={g} material={mats[i]} receiveShadow castShadow={false} />
        ) : null,
      )}
    </group>
  )
}

// ── Wall shell ───────────────────────────────────────────────────────────────

type Opening = { x: number; w: number; y0: number; y1: number }

/** Spans of wall that are solid at height `h`, in local X. */
function spansAt(x0: number, x1: number, openings: Opening[], h: number): Array<[number, number]> {
  const blocking = openings
    .filter((o) => h > o.y0 - 1e-4 && h < o.y1 + 1e-4)
    .sort((a, b) => a.x - b.x)

  const out: Array<[number, number]> = []
  let cur = x0
  for (const o of blocking) {
    const a = o.x - o.w / 2
    const b = o.x + o.w / 2
    if (a - cur > 0.02) out.push([cur, a])
    cur = Math.max(cur, b)
  }
  if (x1 - cur > 0.02) out.push([cur, x1])
  return out
}

/**
 * A plastered wall with openings punched through it, plus the joinery that
 * makes a room feel built: skirting, wainscot, chair rail, picture rail and
 * a run of cornice where it meets the ceiling.
 */
function WallShell({
  x0, x1, openings, children,
}: {
  x0: number
  x1: number
  openings: Opening[]
  children?: ReactNode
}) {
  const plaster = M.plaster()
  const lower = M.plasterLower()
  const skirtMat = M.skirting()
  const trim = M.trim()

  const piers = spansAt(x0, x1, openings, CEIL * 0.45)
  const railRun = spansAt(x0, x1, openings, WAINSCOT - 0.01)
  const skirtRun = spansAt(x0, x1, openings, SKIRT_H * 0.5)
  const picRun = spansAt(x0, x1, openings, PIC_RAIL)

  const len = x1 - x0
  const mid = (x0 + x1) / 2

  return (
    <group>
      {/* ── Wall body: full-height piers ───────────────────────────────── */}
      {piers.map(([a, b], i) => (
        <mesh
          key={`p${i}`}
          geometry={chamfer(b - a, CEIL, WALL_T, 0.006)}
          material={plaster}
          position={[(a + b) / 2, CEIL / 2, 0]}
          castShadow
          receiveShadow
        />
      ))}

      {/* ── Wall body: spandrels under and over each opening ───────────── */}
      {openings.map((o, i) => (
        <group key={`o${i}`}>
          {o.y0 > 0.02 && (
            <mesh
              geometry={chamfer(o.w, o.y0, WALL_T, 0.006)}
              material={plaster}
              position={[o.x, o.y0 / 2, 0]}
              castShadow
              receiveShadow
            />
          )}
          {o.y1 < CEIL - 0.02 && (
            <mesh
              geometry={chamfer(o.w, CEIL - o.y1, WALL_T, 0.006)}
              material={plaster}
              position={[o.x, (CEIL + o.y1) / 2, 0]}
              castShadow
              receiveShadow
            />
          )}
        </group>
      ))}

      {/* ── Wainscot: darker plaster band up to the chair rail ─────────── */}
      {railRun.map(([a, b], i) => (
        <group key={`w${i}`}>
          <mesh
            geometry={chamfer(b - a, WAINSCOT, 0.014, 0.004)}
            material={lower}
            position={[(a + b) / 2, WAINSCOT / 2, FACE + 0.007]}
            receiveShadow
          />
          <mesh
            geometry={chamfer(b - a, 0.055, 0.032, 0.004)}
            material={skirtMat}
            position={[(a + b) / 2, WAINSCOT - 0.005, FACE + 0.016]}
            castShadow
            receiveShadow
          />
        </group>
      ))}

      {/* Under a window the wainscot runs up to the sill; the sill is its rail. */}
      {openings
        .filter((o) => o.y0 > 0.5)
        .map((o, i) => (
          <mesh
            key={`uw${i}`}
            geometry={chamfer(o.w, o.y0, 0.014, 0.004)}
            material={lower}
            position={[o.x, o.y0 / 2, FACE + 0.007]}
            receiveShadow
          />
        ))}

      {/* ── Skirting board ─────────────────────────────────────────────── */}
      {skirtRun.map(([a, b], i) => (
        <mesh
          key={`s${i}`}
          geometry={chamfer(b - a, SKIRT_H, 0.024, 0.004)}
          material={skirtMat}
          position={[(a + b) / 2, SKIRT_H / 2, FACE + 0.012]}
          castShadow
          receiveShadow
        />
      ))}

      {/* ── Picture rail ───────────────────────────────────────────────── */}
      {picRun.map(([a, b], i) => (
        <mesh
          key={`r${i}`}
          geometry={chamfer(b - a, 0.042, 0.028, 0.004)}
          material={trim}
          position={[(a + b) / 2, PIC_RAIL, FACE + 0.014]}
          castShadow
          receiveShadow
        />
      ))}

      {/* ── Cornice ────────────────────────────────────────────────────── */}
      <mesh
        geometry={moulding(len, 0.11, 0.085)}
        material={trim}
        position={[mid, CEIL - 0.055, FACE + 0.0425]}
        rotation={[Math.PI, 0, 0]}
        castShadow
        receiveShadow
      />

      {children}
    </group>
  )
}

// ── Tall window ──────────────────────────────────────────────────────────────

/**
 * Built in the wall's local frame. Deep reveal with painted linings, a moulded
 * sash frame set back near the outer face, six panes divided by glazing bars,
 * a projecting stone sill, and a sky backdrop 0.4 m behind the opening.
 */
function TallWindow({
  x, w = WIN_W, h = WIN_H, sill = WIN_SILL, shaft = false,
}: {
  x: number
  w?: number
  h?: number
  sill?: number
  shaft?: boolean
}) {
  const trim = M.trim()
  const top = sill + h

  // Sash frame, recessed into the reveal.
  const FZ = -0.014
  const FD = 0.052
  const stile = 0.050
  const headR = 0.055
  const footR = 0.075

  // Daylight opening inside the sash.
  const ix = w / 2 - stile
  const iy0 = sill + footR
  const iy1 = top - headR
  const ih = iy1 - iy0

  const paneW = ix - 0.030
  const paneH = ih / 3 - 0.024

  const rows = [iy0 + ih / 6, iy0 + ih / 2, iy0 + (5 * ih) / 6]
  const cols = [-ix / 2, ix / 2]

  const sillD = WALL_T + 0.11

  return (
    <group position={[x, 0, 0]}>
      {/* ── Reveal linings — painted boards lining the 0.12 m cut ───────── */}
      <mesh
        geometry={chamfer(0.018, h, WALL_T - 0.008, 0.003)}
        material={trim}
        position={[-w / 2 + 0.009, sill + h / 2, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(0.018, h, WALL_T - 0.008, 0.003)}
        material={trim}
        position={[w / 2 - 0.009, sill + h / 2, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(w - 0.036, 0.018, WALL_T - 0.008, 0.003)}
        material={trim}
        position={[0, top - 0.009, 0]}
        castShadow
        receiveShadow
      />

      {/* ── Stone sill projecting into the room, on a small apron ───────── */}
      <mesh
        geometry={chamfer(w + 0.20, 0.042, sillD, 0.006)}
        material={trim}
        position={[0, sill - 0.021, sillD / 2 - WALL_T / 2]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(w + 0.13, 0.030, 0.095, 0.004)}
        material={trim}
        position={[0, sill - 0.057, FACE + 0.020]}
        castShadow
        receiveShadow
      />

      {/* ── Sash frame ──────────────────────────────────────────────────── */}
      <mesh
        geometry={chamfer(stile, h, FD, 0.004)}
        material={trim}
        position={[-w / 2 + stile / 2, sill + h / 2, FZ]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(stile, h, FD, 0.004)}
        material={trim}
        position={[w / 2 - stile / 2, sill + h / 2, FZ]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(w - stile * 2, headR, FD, 0.004)}
        material={trim}
        position={[0, top - headR / 2, FZ]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(w - stile * 2, footR, FD, 0.004)}
        material={trim}
        position={[0, sill + footR / 2, FZ]}
        castShadow
        receiveShadow
      />

      {/* ── Glazing bars: two columns, three rows ───────────────────────── */}
      <mesh
        geometry={chamfer(0.026, ih, 0.038, 0.003)}
        material={trim}
        position={[0, (iy0 + iy1) / 2, FZ]}
        castShadow
        receiveShadow
      />
      {[iy0 + ih / 3, iy0 + (2 * ih) / 3].map((y, i) => (
        <mesh
          key={`gb${i}`}
          geometry={chamfer(ix * 2, 0.024, 0.038, 0.003)}
          material={trim}
          position={[0, y, FZ]}
          castShadow
          receiveShadow
        />
      ))}

      {/* ── Glass ───────────────────────────────────────────────────────── */}
      {rows.map((y, ri) =>
        cols.map((cx, ci) => (
          <mesh key={`g${ri}-${ci}`} position={[cx, y, FZ - 0.024]} material={M.glass()}>
            <planeGeometry args={[paneW, paneH]} />
          </mesh>
        )),
      )}

      {/* ── Outside, set back so it reads as distance ───────────────────── */}
      <mesh position={[0, sill + h / 2, -0.28]} material={M.sky()}>
        <planeGeometry args={[w + 0.34, h + 0.26]} />
      </mesh>

      {/* ── Afternoon light falling into the room ───────────────────────── */}
      {shaft && <LightShaft w={w} h={h} y={sill + h * 0.55} />}
    </group>
  )
}

/** Three nested, barely-there additive volumes. Subtle or it ruins the shot. */
function LightShaft({ w, h, y }: { w: number; h: number; y: number }) {
  // Wider and fainter than before. With the alpha ramp doing the edge work the
  // beams can afford to be large, and low opacity is what keeps them reading as
  // air rather than as a surface.
  const layers: Array<[number, number, number, number, number, number]> = [
    [w * 1.30, w * 1.95, 3.60, h * 0.92, h * 1.30, 0.050],
    [w * 0.92, w * 1.34, 3.45, h * 0.66, h * 0.92, 0.055],
    [w * 0.52, w * 0.78, 3.25, h * 0.40, h * 0.56, 0.060],
  ]

  return (
    <group position={[0, y, -0.02]} rotation={[0, SHAFT_YAW, 0]}>
      <group rotation={[SHAFT_TILT, 0, 0]}>
        {layers.map(([wb, wt, len, db, dt, op], i) => (
          <mesh
            key={i}
            geometry={taperedBox(wb, wt, len, db, dt)}
            material={M.lightShaft(PAL.skyWarm, op)}
            position={[0, len / 2, 0]}
            renderOrder={20 + i}
            castShadow={false}
            receiveShadow={false}
          />
        ))}
      </group>
    </group>
  )
}

// ── Door ─────────────────────────────────────────────────────────────────────

/** One frame-and-panel cell of the leaf. Four of them make a four-panel door. */
function PanelCell({ cx, cy, w, h }: { cx: number; cy: number; w: number; h: number }) {
  const p = framePanelParts(w, h, 0.075, DOOR_T)
  const oak = M.oakPanel()
  const members = [p.frameTop, p.frameBot, p.frameLeft, p.frameRight]

  return (
    <group position={[cx, cy, 0]}>
      {members.map((m, i) => (
        <mesh
          key={i}
          geometry={m.geo}
          material={oak}
          position={[m.pos[0], m.pos[1], m.pos[2]]}
          castShadow
          receiveShadow
        />
      ))}
      <mesh
        geometry={p.inset.geo}
        material={oak}
        position={[p.inset.pos[0], p.inset.pos[1], p.inset.pos[2]]}
        castShadow
        receiveShadow
      />
    </group>
  )
}

/**
 * Four-panel door in the wall's local frame, hinged on its +local-X edge
 * (world Z-negative) and standing about 12° open into the room.
 */
function PanelDoor({ x }: { x: number }) {
  const leafRef = useRef<THREE.Group>(null)
  // The leaf swings as one piece: weld it in its own frame.
  useWeld(leafRef)

  useFrame((_, dt) => {
    if (!leafRef.current) return
    const want = DOOR_AJAR + doorWanted() * (DOOR_OPEN - DOOR_AJAR)
    door.open += (want - door.open) * Math.min(1, 3.4 * dt)
    leafRef.current.rotation.y = door.open
    // Still swinging: keep the frames (and its shadow) coming until it settles,
    // even after the figure that opened it has gone.
    if (Math.abs(want - door.open) > 0.002) wake(150)
  })

  const trim = M.trim()
  const brass = M.brass()

  const w = DOOR_W
  const h = DOOR_H
  const hingeX = x + w / 2

  // Classic proportions: tall panels above a lock rail, short ones below.
  const upperH = 1.18
  const lowerH = h - upperH
  const cellW = w / 2

  return (
    <group>
      {/* ── Jamb linings inside the reveal ──────────────────────────────── */}
      <mesh
        geometry={chamfer(0.020, h + 0.02, WALL_T - 0.008, 0.003)}
        material={trim}
        position={[x - w / 2 + 0.010, (h + 0.02) / 2, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(0.020, h + 0.02, WALL_T - 0.008, 0.003)}
        material={trim}
        position={[x + w / 2 - 0.010, (h + 0.02) / 2, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={chamfer(w - 0.04, 0.020, WALL_T - 0.008, 0.003)}
        material={trim}
        position={[x, h - 0.010, 0]}
        castShadow
        receiveShadow
      />

      {/* ── Architrave surround ─────────────────────────────────────────── */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={chamfer(0.085, h + 0.085, 0.026, 0.004)}
          material={trim}
          position={[x + s * (w / 2 + 0.0425), (h + 0.085) / 2, FACE + 0.013]}
          castShadow
          receiveShadow
        />
      ))}
      <mesh
        geometry={chamfer(w + 0.17, 0.085, 0.026, 0.004)}
        material={trim}
        position={[x, h + 0.0425, FACE + 0.013]}
        castShadow
        receiveShadow
      />

      {/* ── Threshold ───────────────────────────────────────────────────── */}
      <mesh
        geometry={chamfer(w + 0.02, 0.018, WALL_T + 0.03, 0.004)}
        material={M.skirting()}
        position={[x, 0.009, 0.015]}
        castShadow
        receiveShadow
      />

      {/* ── The leaf, pivoting on the hinge line ────────────────────────── */}
      {/* Driven from anim/stage: an agent arriving or leaving holds the door
          open, and the swing eases rather than snapping. Refcounted there, so
          two sub-agents overlapping cannot slam it on each other. */}
      {/* userData.dynamic keeps StaticBatch from welding the leaf to the wall. */}
      <group ref={leafRef} position={[hingeX, 0, 0.022]} rotation={[0, DOOR_AJAR, 0]}
             userData={{ dynamic: true }}>
        {/* Butt hinges: leaf mortised into the door edge, knuckle proud of it */}
        {[0.30, 1.05, 1.80].map((hy) => (
          <group key={hy}>
            <mesh
              geometry={chamfer(0.005, 0.100, 0.042, 0.002)}
              material={brass}
              position={[-0.0026, hy, 0]}
              castShadow
            />
            <mesh
              geometry={turned(HINGE_KNUCKLE, 10)}
              material={M.brassDark()}
              position={[0.004, hy - 0.05, 0]}
              castShadow
            />
          </group>
        ))}

        <group position={[-w / 2, h / 2, 0]}>
          <PanelCell cx={-cellW / 2} cy={h / 2 - upperH / 2} w={cellW} h={upperH} />
          <PanelCell cx={cellW / 2} cy={h / 2 - upperH / 2} w={cellW} h={upperH} />
          <PanelCell cx={-cellW / 2} cy={-h / 2 + lowerH / 2} w={cellW} h={lowerH} />
          <PanelCell cx={cellW / 2} cy={-h / 2 + lowerH / 2} w={cellW} h={lowerH} />
        </group>

        {/* ── Brass lever, rose and escutcheon ─────────────────────────── */}
        <group position={[-w + 0.075, 1.02, DOOR_T / 2]}>
          <mesh
            geometry={turned(HANDLE_ROSE, 16)}
            material={brass}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.105, 0.020, 0.024, 0.008)}
            material={brass}
            position={[0.052, -0.004, 0.036]}
            castShadow
          />
        </group>
        <mesh
          geometry={turned(ESCUTCHEON, 14)}
          material={brass}
          rotation={[Math.PI / 2, 0, 0]}
          position={[-w + 0.075, 0.895, DOOR_T / 2]}
          castShadow
        />
      </group>
    </group>
  )
}

// ── Ceiling ──────────────────────────────────────────────────────────────────

function Ceiling() {
  const beamMat = M.beam()

  // An isometric cutaway has no visible ceiling: the ceiling plane is
  // backface-culled from above, but solid beams are not — full-span beams
  // hang in empty space over the open half of the room and slash across the
  // whole composition. So only the wall plate survives, running along the two
  // walls that actually exist, where it reads as the top of the structure.
  return (
    <group>
      {/* Wall plate along the back wall */}
      <mesh
        geometry={chamfer(HALF * 2, 0.18, 0.20, 0.016)}
        material={beamMat}
        position={[0, CEIL - 0.09, WALL_IN + 0.10]}
        castShadow={false}
        receiveShadow
      />
      {/* Wall plate along the left wall */}
      <mesh
        geometry={chamfer(0.20, 0.18, HALF * 2, 0.016)}
        material={beamMat}
        position={[WALL_IN + 0.10, CEIL - 0.09, 0]}
        castShadow={false}
        receiveShadow
      />
      {/* Short joist stubs projecting from the back plate — they imply the
          ceiling that the cutaway removed, without occluding anything. */}
      {[-4.8, -2.4, 0, 2.4, 4.8].map((bx) => (
        <mesh
          key={bx}
          geometry={chamfer(0.15, 0.20, 0.62, 0.016)}
          material={beamMat}
          position={[bx, CEIL - 0.10, WALL_IN + 0.48]}
          castShadow={false}
          receiveShadow
        />
      ))}
      {[-4.4, -2.0, 0.4, 2.8].map((bz) => (
        <mesh
          key={bz}
          geometry={chamfer(0.62, 0.20, 0.15, 0.016)}
          material={beamMat}
          position={[WALL_IN + 0.48, CEIL - 0.10, bz]}
          castShadow={false}
          receiveShadow
        />
      ))}
    </group>
  )
}

// ── Rug ──────────────────────────────────────────────────────────────────────

const RUG_W = 4.4
const RUG_D = 3.4

function Rug() {
  const fringe = useMemo(() => {
    const rand = rng(9182)
    const parts: THREE.BufferGeometry[] = []
    const step = 0.062
    const count = Math.floor((RUG_D - 0.10) / step)
    const z0 = -((count - 1) * step) / 2

    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const len = 0.075 + rand() * 0.028
        const g = new THREE.CylinderGeometry(0.0045, 0.0032, len, 5, 1)
        g.rotateZ(Math.PI / 2)
        g.rotateY((rand() - 0.5) * 0.22)
        g.translate(
          side * (RUG_W / 2 + len / 2 - 0.008),
          0.009,
          z0 + i * step + (rand() - 0.5) * 0.012,
        )
        parts.push(g)
      }
    }
    return parts.length > 0 ? mergeBufferGeometries(parts, false) : null
  }, [])

  return (
    <group position={[0.3, 0, 0.4]} rotation={[0, -0.022, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow material={M.rug()}>
        <planeGeometry args={[RUG_W, RUG_D]} />
      </mesh>
      {fringe && <mesh geometry={fringe} material={M.linen()} receiveShadow castShadow={false} />}
    </group>
  )
}

// ── The room ─────────────────────────────────────────────────────────────────

const BACK_OPENINGS: Opening[] = [
  { x: -4.20, w: WIN_W, y0: WIN_SILL, y1: WIN_SILL + WIN_H },
  { x: -1.60, w: WIN_W, y0: WIN_SILL, y1: WIN_SILL + WIN_H },
]

// Left wall local X = -world Z: side window at world z -1.2, door at world z +4.0.
const LEFT_OPENINGS: Opening[] = [
  { x: 1.20, w: WIN_W, y0: WIN_SILL, y1: WIN_SILL + WIN_H },
  { x: -4.00, w: DOOR_W, y0: 0, y1: DOOR_H },
]

export function Room() {
  return (
    <group name="Room">
      <PlankFloor />
      <Ceiling />
      <Rug />

      {/* Back wall — Z = -5.96, inner face -5.90 */}
      <group position={[0, 0, WALL_MID]}>
        <WallShell x0={WALL_OUT} x1={-WALL_OUT} openings={BACK_OPENINGS}>
          <TallWindow x={-4.20} shaft />
          <TallWindow x={-1.60} shaft />
        </WallShell>
      </group>

      {/* Left wall — X = -5.96, inner face -5.90, local +Z faces into the room */}
      <group position={[WALL_MID, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WallShell x0={WALL_OUT} x1={-WALL_IN} openings={LEFT_OPENINGS}>
          <TallWindow x={1.20} />
          <PanelDoor x={-4.00} />
        </WallShell>
      </group>
    </group>
  )
}
