/**
 * Props.tsx — the small things that make a room look lived in.
 *
 * Nothing here is load-bearing architecturally, and all of it is load-bearing
 * emotionally. An empty room with perfect furniture reads as a showroom; a
 * half-drunk mug and a pencil lying at an angle read as somebody's workshop.
 *
 * Everything gets a jitter. Perfect alignment is the single clearest tell of
 * generated geometry.
 */

import { useMemo } from "react"
import * as THREE from "three"
import {
  chamfer, turned, bevelPanel, leaf, sagCable, rolledSheet,
  LAMP_STEM, POT_PROFILE, MUG_PROFILE, rng, jitter, type Profile,
} from "../three/kit"
import { M } from "../three/materials"
import { PAL } from "../three/palette"

type Vec3 = [number, number, number]

// ── Local profiles ───────────────────────────────────────────────────────────

// A real anglepoise shade is ~0.17 across, not 0.29 — at the larger size it
// reads as a dark ball on a stick rather than a lamp.
const SHADE_CONE: Profile = [
  [0.044, 0.000], [0.050, 0.008], [0.122, 0.118], [0.128, 0.128],
]

const DISH_SHADE: Profile = [
  [0.022, 0.000], [0.026, 0.010], [0.150, 0.090], [0.168, 0.112], [0.170, 0.120],
]

const CLOCK_BODY: Profile = [
  [0.000, 0.000], [0.048, 0.000], [0.052, 0.008], [0.052, 0.030],
  [0.048, 0.038], [0.000, 0.038],
]

const PIVOT_BOSS: Profile = [
  [0.000, 0.000], [0.018, 0.000], [0.018, 0.016], [0.000, 0.016],
]

// ═══════════════════════════════════════════════════════════════════════════
// Desk lamp — anglepoise
// ═══════════════════════════════════════════════════════════════════════════

export interface DeskLampProps {
  position?: Vec3
  rotation?: Vec3
  armAngle?: number
}

export function DeskLamp({
  position = [0, 0, 0], rotation = [0, 0, 0], armAngle = -0.62,
}: DeskLampProps) {
  const lowerA = armAngle
  const upperA = -armAngle * 1.55 - 0.30

  return (
    <group name="DeskLamp" position={position} rotation={rotation}>
      {/* weighted base */}
      <mesh geometry={turned(LAMP_STEM, 16)} material={M.brassDark()} castShadow receiveShadow />

      {/* lower arm, pivoting from the base boss */}
      <group position={[0, 0.052, 0]} rotation={[lowerA, 0, 0]}>
        <mesh
          geometry={turned(PIVOT_BOSS, 10)}
          material={M.brass()}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        />
        <mesh
          geometry={chamfer(0.021, 0.300, 0.021, 0.008)}
          material={M.brass()}
          position={[0, 0.150, 0]}
          castShadow
        />
        {/* tension spring alongside the arm */}
        <mesh
          geometry={sagCable([-0.020, 0.055, 0], [-0.020, 0.245, 0], 0.0, 0.0055, 14)}
          material={M.steel()}
          castShadow={false}
        />

        {/* elbow → upper arm */}
        <group position={[0, 0.300, 0]} rotation={[upperA, 0, 0]}>
          <mesh
            geometry={turned(PIVOT_BOSS, 10)}
            material={M.brass()}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.020, 0.270, 0.020, 0.008)}
            material={M.brass()}
            position={[0, 0.135, 0]}
            castShadow
          />
          <mesh
            geometry={sagCable([0.018, 0.050, 0], [0.018, 0.220, 0], 0.0, 0.005, 12)}
            material={M.steel()}
            castShadow={false}
          />

          {/* shade head, tipped down toward the work */}
          <group position={[0, 0.270, 0]} rotation={[2.35, 0, 0]}>
            <mesh
              geometry={turned(PIVOT_BOSS, 10)}
              material={M.brass()}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            />
            <mesh geometry={turned(SHADE_CONE, 18)} material={M.shadeOuter()} castShadow />
            {/* lit interior */}
            <mesh
              geometry={turned(SHADE_CONE, 18)}
              material={M.shadeInner()}
              scale={0.96}
              position={[0, 0.004, 0]}
            />
            <mesh position={[0, 0.040, 0]} material={M.bulb()}>
              <sphereGeometry args={[0.028, 16, 12]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pendant lamp
// ═══════════════════════════════════════════════════════════════════════════

export function PendantLamp({
  position = [0, 3.3, 0], cordLength = 0.85,
}: { position?: Vec3; cordLength?: number }) {
  return (
    <group name="PendantLamp" position={position}>
      {/* ceiling rose */}
      <mesh
        geometry={turned([[0, 0], [0.062, 0], [0.066, 0.008], [0.050, 0.026], [0, 0.030]], 14)}
        material={M.brassDark()}
        rotation={[Math.PI, 0, 0]}
        castShadow
      />
      {/* cord — nearly straight, a touch of sag */}
      <mesh
        geometry={sagCable([0, 0, 0], [0, -cordLength, 0], 0.012, 0.0055, 10)}
        material={M.iron()}
      />
      {/* enamelled dish shade */}
      <group position={[0, -cordLength, 0]}>
        <mesh geometry={turned(DISH_SHADE, 22)} material={M.shadeOuter()} castShadow />
        <mesh
          geometry={turned(DISH_SHADE, 22)}
          material={M.shadeInner()}
          scale={0.95}
          position={[0, 0.004, 0]}
        />
        <mesh position={[0, -0.075, 0]} material={M.bulb()}>
          <sphereGeometry args={[0.034, 16, 12]} />
        </mesh>
      </group>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Plant
// ═══════════════════════════════════════════════════════════════════════════

export function Plant({
  position = [0, 0, 0], scale = 1, seed = 1,
}: { position?: Vec3; scale?: number; seed?: number }) {
  const blades = useMemo(() => {
    const r = rng(seed * 31 + 7)
    const n = 17 + Math.floor(r() * 6)
    return Array.from({ length: n }, (_, i) => {
      const az   = (i / n) * Math.PI * 2 + jitter(r, 0.28)
      const tilt = 0.52 + r() * 0.72
      const len  = 0.15 + r() * 0.13
      const wid  = 0.055 + r() * 0.035
      const tone = r()
      return {
        az, tilt, roll: jitter(r, 0.5),
        geo: leaf(len, wid, 0.20 + r() * 0.24),
        mat: tone < 0.33 ? M.leafDark() : tone < 0.70 ? M.leafMid() : M.leafLight(),
        y:   0.218 + r() * 0.058,
      }
    })
  }, [seed])

  const arcs = useMemo(() => {
    const r = rng(seed * 53 + 19)
    return Array.from({ length: 2 }, (_, i) => {
      const az = (i / 2) * Math.PI * 2 + jitter(r, 0.4)
      const reach = 0.20 + r() * 0.12
      return {
        az,
        geo: sagCable(
          [0, 0.25, 0],
          [Math.cos(az) * reach, 0.40 + r() * 0.12, Math.sin(az) * reach],
          0.06, 0.0065, 12,
        ),
        tipGeo: leaf(0.145, 0.062, 0.22),
        tip: [Math.cos(az) * reach, 0.40 + r() * 0.12, Math.sin(az) * reach] as Vec3,
        mat: i % 2 ? M.leafMid() : M.leafLight(),
      }
    })
  }, [seed])

  return (
    <group name="Plant" position={position} scale={scale}>
      <mesh geometry={turned(POT_PROFILE, 18)} material={M.terracotta()} castShadow receiveShadow />
      {/* rim band */}
      <mesh
        geometry={turned([[0.120, 0], [0.128, 0], [0.128, 0.024], [0.120, 0.024]], 18)}
        material={M.terracotta()}
        position={[0, 0.226, 0]}
        castShadow
      />
      {/* soil */}
      <mesh position={[0, 0.222, 0]} material={M.soil()} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.112, 48]} />
      </mesh>

      {blades.map((b, i) => (
        <group key={i} position={[0, b.y, 0]} rotation={[0, b.az, 0]}>
          <mesh
            geometry={b.geo}
            material={b.mat}
            rotation={[-Math.PI / 2 + b.tilt, 0, b.roll]}
            castShadow
          />
        </group>
      ))}

      {arcs.map((a, i) => (
        <group key={`a${i}`}>
          <mesh geometry={a.geo} material={M.leafDark()} />
          <mesh
            geometry={a.tipGeo}
            material={a.mat}
            position={a.tip}
            rotation={[-1.1, a.az, 0]}
            castShadow
          />
        </group>
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Mug
// ═══════════════════════════════════════════════════════════════════════════

export function Mug({
  position = [0, 0, 0], rotation = [0, 0, 0], color,
}: { position?: Vec3; rotation?: Vec3; color?: string }) {
  return (
    <group name="Mug" position={position} rotation={rotation}>
      <mesh
        geometry={turned(MUG_PROFILE, 16)}
        material={color ? M.glaze(color) : M.glaze("#d8dbd4")}
        castShadow receiveShadow
      />
      {/* handle */}
      <mesh
        position={[0.046, 0.050, 0]}
        rotation={[0, Math.PI / 2, 0]}
        material={color ? M.glaze(color) : M.glaze("#d8dbd4")}
        castShadow
      >
        <torusGeometry args={[0.024, 0.0065, 6, 14, Math.PI * 1.25]} />
      </mesh>
      {/* coffee */}
      <mesh position={[0, 0.076, 0]} rotation={[-Math.PI / 2, 0, 0]} material={M.coffee()}>
        <circleGeometry args={[0.036, 14]} />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Picture frame
// ═══════════════════════════════════════════════════════════════════════════

export function PictureFrame({
  position = [0, 0, 0], rotation = [0, 0, 0], size = 0.5,
  kind = "blueprint",
}: { position?: Vec3; rotation?: Vec3; size?: number; kind?: "blueprint" | "photo" }) {
  const w = size, h = size * 0.76
  const rail = size * 0.055

  return (
    <group name="PictureFrame" position={position} rotation={rotation}>
      {/* frame rails */}
      {([
        [0,  h / 2 - rail / 2, w, rail],
        [0, -h / 2 + rail / 2, w, rail],
      ] as const).map(([x, y, ww, hh], i) => (
        <mesh
          key={`h${i}`}
          geometry={bevelPanel(ww, hh, 0.024, 0.004)}
          material={M.walnut()}
          position={[x, y, 0]}
          castShadow
        />
      ))}
      {[-1, 1].map(s => (
        <mesh
          key={`v${s}`}
          geometry={bevelPanel(rail, h - rail * 2, 0.024, 0.004)}
          material={M.walnut()}
          position={[s * (w / 2 - rail / 2), 0, 0]}
          castShadow
        />
      ))}
      {/* Mount board, then the drawing. The photo frame used to hold plain
          aged paper: cream on a cream wall, which read as an empty frame. */}
      <mesh
        geometry={chamfer(w - rail * 1.8, h - rail * 1.8, 0.006, 0.002)}
        material={M.linen()}
        position={[0, 0, -0.006]}
      />
      <mesh
        geometry={chamfer(w - rail * 3.0, h - rail * 3.0, 0.003, 0.001)}
        material={kind === "blueprint" ? M.blueprint() : M.sketch()}
        position={[0, 0, -0.002]}
      />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Desk clutter
// ═══════════════════════════════════════════════════════════════════════════

export function DeskClutter({
  position = [0, 0, 0], rotation = [0, 0, 0], seed = 1,
}: { position?: Vec3; rotation?: Vec3; seed?: number }) {
  const r = useMemo(() => rng(seed * 97 + 11), [seed])

  const papers = useMemo(() => {
    const rr = rng(seed * 13 + 5)
    return Array.from({ length: 4 }, (_, i) => ({
      x: -0.42 + jitter(rr, 0.022),
      z: 0.02 + jitter(rr, 0.028),
      y: 0.002 + i * 0.0018,
      rot: jitter(rr, 0.09),
      aged: rr() < 0.35,
    }))
  }, [seed])

  const pencils = useMemo(() => {
    const rr = rng(seed * 41 + 3)
    const woods = ["#c98f4e", "#9a6b3f", "#d4a668", "#7c5230"]
    return Array.from({ length: 5 }, (_, i) => ({
      x: -0.02 + i * 0.014 + jitter(rr, 0.005),
      rot: jitter(rr, 0.22),
      tilt: 1.30 + jitter(rr, 0.12),
      color: woods[i % woods.length],
      len: 0.155 + rr() * 0.022,
    }))
  }, [seed])

  const clips = useMemo(() => {
    const rr = rng(seed * 7 + 29)
    return Array.from({ length: 4 }, () => ({
      x: 0.16 + jitter(rr, 0.09),
      z: 0.22 + jitter(rr, 0.07),
      rot: rr() * Math.PI,
    }))
  }, [seed])

  return (
    <group name="DeskClutter" position={position} rotation={rotation}>
      {/* stack of papers, each offset a degree or two */}
      {papers.map((p, i) => (
        <mesh
          key={i}
          geometry={chamfer(0.210, 0.0014, 0.290, 0.0006)}
          material={p.aged ? M.paperAged() : M.paper()}
          position={[p.x, p.y, p.z]}
          rotation={[0, p.rot, 0]}
          receiveShadow
        />
      ))}

      {/* open notebook */}
      <group position={[-0.40, 0.010, -0.20]} rotation={[0, jitter(r, 0.12), 0]}>
        <mesh geometry={chamfer(0.230, 0.014, 0.170, 0.004)} material={M.notebook()} castShadow />
        <mesh
          geometry={chamfer(0.216, 0.004, 0.158, 0.002)}
          material={M.paper()}
          position={[0, 0.009, 0]}
        />
        <mesh
          geometry={chamfer(0.008, 0.016, 0.168, 0.003)}
          material={M.notebook()}
          position={[0, 0.002, 0]}
        />
      </group>

      {/* pencil tray */}
      <group position={[0.10, 0.004, -0.16]} rotation={[0, -0.18, 0]}>
        <mesh geometry={chamfer(0.130, 0.026, 0.072, 0.006)} material={M.walnut()} castShadow />
        <mesh
          geometry={chamfer(0.112, 0.010, 0.056, 0.004)}
          material={M.walnutDarkMat()}
          position={[0, 0.012, 0]}
        />
        {pencils.map((p, i) => (
          <group key={i} position={[p.x, 0.026, 0]} rotation={[p.tilt, p.rot, 0]}>
            <mesh material={M.pencil(p.color)} castShadow>
              <cylinderGeometry args={[0.0042, 0.0042, p.len, 6]} />
            </mesh>
            <mesh position={[0, p.len / 2 + 0.006, 0]} material={M.pencilTip()}>
              <coneGeometry args={[0.0042, 0.013, 6]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* mug */}
      <Mug position={[0.30, 0.002, -0.04]} rotation={[0, jitter(r, 0.6), 0]} color="#cfd6cc" />

      {/* brass desk clock */}
      <group position={[0.34, 0.002, -0.26]} rotation={[0, -0.42, 0]}>
        <mesh
          geometry={turned(CLOCK_BODY, 16)}
          material={M.brass()}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        />
        <mesh position={[0, 0.019, 0.031]} rotation={[Math.PI / 2, 0, 0]} material={M.paper()}>
          <circleGeometry args={[0.040, 16]} />
        </mesh>
      </group>

      {/* drawing compasses */}
      <group position={[-0.14, 0.006, 0.26]} rotation={[0, 0.34, 0]}>
        <mesh
          geometry={chamfer(0.007, 0.145, 0.007, 0.002)}
          material={M.brass()}
          position={[-0.012, 0.068, 0]}
          rotation={[0, 0, 0.16]}
          castShadow
        />
        <mesh
          geometry={chamfer(0.007, 0.145, 0.007, 0.002)}
          material={M.brass()}
          position={[0.012, 0.068, 0]}
          rotation={[0, 0, -0.16]}
          castShadow
        />
        <mesh
          geometry={turned(PIVOT_BOSS, 8)}
          material={M.brassDark()}
          position={[0, 0.140, 0]}
          scale={0.6}
          castShadow
        />
      </group>

      {/* paperclips */}
      {clips.map((c, i) => (
        <mesh
          key={i}
          position={[c.x, 0.003, c.z]}
          rotation={[Math.PI / 2, 0, c.rot]}
          material={M.steel()}
        >
          <torusGeometry args={[0.009, 0.0013, 4, 10, Math.PI * 1.6]} />
        </mesh>
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Floor clutter — a crate of rolled drawings
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A rolled drawing.
 *
 * `rolledSheet` on its own is a cylinder, and a cylinder in paper-white reads
 * as a grey tube while one in blueprint blue reads as a blue stick dropped on
 * the floor — which is exactly how both looked on a real screen. What makes a
 * roll legible is the things a lathe cannot make: the free edge of the sheet
 * standing a little proud, a dark eye down the middle, and a twine tie.
 *
 * Built along local +Y, centred on the origin.
 */
function PaperRoll({
  length = 0.52, radius = 0.026, plan = false,
}: { length?: number; radius?: number; plan?: boolean }) {
  const capY = length / 2 + 0.0015
  return (
    <group>
      <mesh geometry={rolledSheet(length, radius)} material={M.kraft()} castShadow receiveShadow />

      {/* The last turn of the sheet, standing proud of the roll. */}
      <mesh castShadow>
        <cylinderGeometry args={[radius * 1.085, radius * 1.075, length * 0.985, 20, 1, true, 0.35, 2.05]} />
        <meshStandardMaterial color={plan ? "#cbbfa2" : "#dcc6a0"} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* A blueprint reads as a blueprint by its edge, not by being blue all over. */}
      {plan && (
        <mesh position={[0, -length * 0.34, 0]}>
          <cylinderGeometry args={[radius * 1.018, radius * 1.018, length * 0.07, 20, 1, true]} />
          <meshStandardMaterial color={PAL.blueprint} roughness={0.88} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Ends: a pale ring of paper round a dark eye. */}
      {[1, -1].map(sgn => (
        <group key={sgn} position={[0, sgn * capY, 0]} rotation={[sgn > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0]}>
          <mesh material={M.paper()}>
            <circleGeometry args={[radius * 0.98, 20]} />
          </mesh>
          <mesh position={[0, 0, 0.0008]} material={M.walnutDarkMat()}>
            <circleGeometry args={[radius * 0.30, 14]} />
          </mesh>
        </group>
      ))}

      {/* Twine. */}
      <mesh position={[0, length * 0.13, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.twine()}>
        <torusGeometry args={[radius * 1.06, 0.0034, 6, 22]} />
      </mesh>
    </group>
  )
}

export function FloorClutter({
  position = [0, 0, 0], seed = 1,
}: { position?: Vec3; seed?: number }) {
  const rolls = useMemo(() => {
    const r = rng(seed * 61 + 13)
    return Array.from({ length: 6 }, () => ({
      x:    jitter(r, 0.075),
      z:    jitter(r, 0.075),
      tilt: jitter(r, 0.16),
      yaw:  r() * Math.PI,
      len:  0.50 + r() * 0.14,
      rad:  0.024 + r() * 0.006,
      plan: r() < 0.55,
    }))
  }, [seed])

  return (
    <group name="FloorClutter" position={position}>
      {/* slatted crate */}
      <group>
        {[0.055, 0.165, 0.275].map(sy =>
          [-1, 1].map(s => (
            <mesh
              key={`x${s}-${sy}`}
              geometry={chamfer(0.018, 0.082, 0.300, 0.004)}
              material={M.crate()}
              position={[s * 0.145, sy, 0]}
              castShadow receiveShadow
            />
          ))
        )}
        {[0.055, 0.165, 0.275].map(sy =>
          [-1, 1].map(s => (
            <mesh
              key={`z${s}-${sy}`}
              geometry={chamfer(0.300, 0.082, 0.018, 0.004)}
              material={M.crate()}
              position={[0, sy, s * 0.145]}
              castShadow receiveShadow
            />
          ))
        )}
        <mesh
          geometry={chamfer(0.300, 0.016, 0.300, 0.004)}
          material={M.crate()}
          position={[0, 0.014, 0]}
          receiveShadow
        />
        {/* corner posts */}
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
          <mesh
            key={i}
            geometry={chamfer(0.026, 0.340, 0.026, 0.005)}
            material={M.walnut()}
            position={[sx * 0.148, 0.170, sz * 0.148]}
            castShadow
          />
        ))}
      </group>

      {/* rolls standing in the crate */}
      {rolls.map((rl, i) => (
        <group
          key={i}
          position={[rl.x, 0.030 + rl.len / 2, rl.z]}
          rotation={[rl.tilt, rl.yaw, jitter(rng(seed + i), 0.14)]}
        >
          <PaperRoll length={rl.len} radius={rl.rad} plan={rl.plan} />
        </group>
      ))}

      {/* One leaning against the crate, deliberately — a roll lying loose in
          the middle of the floor looked like something had fallen off. */}
      <group position={[0.255, 0.128, 0.055]} rotation={[0, 0.42, 1.18]}>
        <PaperRoll length={0.60} radius={0.027} plan />
      </group>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Floor lamp
// ═══════════════════════════════════════════════════════════════════════════
//
// A small lamp on a small table disappears at room scale. A standing lamp with
// a big drum shade holds the near corner, and gives the foreground its own
// warm light instead of borrowing the desk's.

const FLOOR_LAMP_BASE: Profile = [
  [0.000, 0.000], [0.150, 0.000], [0.156, 0.012],
  [0.120, 0.030], [0.040, 0.046], [0.026, 0.070],
  [0.020, 0.090],
]

export function FloorLamp({
  position = [0, 0, 0], rotation = [0, 0, 0], height = 1.45,
}: { position?: Vec3; rotation?: Vec3; height?: number }) {
  const shadeH = 0.30
  const shadeR = 0.215

  return (
    <group name="FloorLamp" position={position} rotation={rotation}>
      <mesh geometry={turned(FLOOR_LAMP_BASE, 18)} material={M.brassDark()} castShadow receiveShadow />
      {/* stem */}
      <mesh
        geometry={turned([[0.017, 0.0], [0.017, height - 0.09], [0.022, height - 0.06]], 12)}
        material={M.brass()}
        position={[0, 0.085, 0]}
        castShadow
      />
      {/* drum shade: opaque outside, lit inside, open top and bottom */}
      <group position={[0, height - shadeH * 0.42, 0]}>
        <mesh material={M.shadeOuter()} castShadow>
          <cylinderGeometry args={[shadeR * 0.92, shadeR, shadeH, 64, 1, true]} />
        </mesh>
        <mesh material={M.shadeInner()} scale={0.965}>
          <cylinderGeometry args={[shadeR * 0.92, shadeR, shadeH * 0.99, 64, 1, true]} />
        </mesh>
        <mesh position={[0, -shadeH * 0.10, 0]} material={M.bulb()}>
          <sphereGeometry args={[0.042, 18, 14]} />
        </mesh>
        {/* A top diffuser. Seen from an isometric camera you look straight down
            into an open drum, and a bare bulb at the bottom of it blows out to
            a white disc. The diffuser keeps the glow without the hotspot. */}
        <mesh position={[0, shadeH / 2 - 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} material={M.diffuser()}>
          <circleGeometry args={[shadeR * 0.91, 64]} />
        </mesh>
        <mesh position={[0, shadeH / 2, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.brassDark()}>
          <torusGeometry args={[shadeR * 0.92, 0.006, 8, 64]} />
        </mesh>
      </group>
    </group>
  )
}
