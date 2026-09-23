/**
 * GaitTest — a filmstrip of the motion, frozen phase by phase.
 *
 * Open with ?debug=gait.
 *
 * Animation cannot be judged from a single screenshot, and it cannot be judged
 * from the source either: a walk cycle is wrong in ways that only show when two
 * moments of it sit side by side. This lays the cycle out in space instead of
 * time — eight phases of one gait cycle, side on, feet on a common ground line
 * — so a sliding foot, a knee bending the wrong way, or a stride that does not
 * match the ground covered is visible in a single image.
 *
 *   ?strip=walk    (default) the walk cycle, side on
 *   ?strip=carry   the same while carrying an armful
 *   ?strip=work    each station action, sampled through its own rhythm
 *   ?strip=sit     the seated figure on the real chair at the real desk
 */

import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { useRef, type ReactNode } from "react"

import { Character, JOINT_NAMES, SEATED, type Joint, type PoseMap } from "./Character"
import { Chair, MainDesk } from "./Furniture"
import { walkPose, walkCarryPose, walkBob, workPose } from "../anim/motion"
import { STATIONS } from "../anim/stations"
import { PAL } from "../three/palette"

type Vec3 = [number, number, number]

function flag(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  return new URLSearchParams(window.location.search).get(key) ?? fallback
}

/**
 * A figure frozen in an arbitrary pose. `Character` only takes the five named
 * poses; it is the generated maps that need checking.
 */
function Posed({
  map, bob = 0, seated = false, shirt = PAL.agentMain, seed = 3, hair = 0,
}: {
  map: PoseMap; bob?: number; seated?: boolean
  shirt?: string; seed?: number; hair?: 0 | 1 | 2
}) {
  const ref = useRef<THREE.Group>(null)

  // The actor composes SEATED over the active pose; a harness that forgot to
  // do the same showed a seated figure with its legs straight through the
  // chair, and the fault was the harness.
  const full = seated ? { ...map, ...SEATED } : map

  // Written every frame rather than once: a one-shot effect would be undone
  // the next time the harness re-rendered.
  useFrame(() => {
    const root = ref.current
    if (!root) return
    for (const name of JOINT_NAMES) {
      const o = root.getObjectByName(name)
      if (!o) continue
      const t = full[name as Joint] ?? [0, 0, 0]
      o.rotation.set(t[0], t[1], t[2])
    }
    const body = root.getObjectByName("bodyRoot")
    if (body && !seated) body.position.y = bob
  })

  return (
    <group ref={ref}>
      <Character seated={seated} shirtColor={shirt} hairStyle={hair} seed={seed} />
    </group>
  )
}

function Lights() {
  return (
    <>
      <hemisphereLight args={["#cfe3f2", "#4a4038", 0.65]} />
      <ambientLight intensity={0.28} />
      <directionalLight
        position={[6, 9, 8]} intensity={1.9} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
      />
      <directionalLight position={[-7, 4, -6]} intensity={0.5} color="#9fc4de" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#6e6257" roughness={0.95} />
      </mesh>
    </>
  )
}

function Stage({
  children, label, position, target, zoom,
}: {
  children: ReactNode; label: string
  position: Vec3; target: Vec3; zoom: number
}) {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1d2127" }}>
      <Canvas
        shadows="soft"
        orthographic
        camera={{ position, zoom, near: -80, far: 200 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}
      >
        <OrbitControls target={target} />
        <Lights />
        {children}
      </Canvas>
      <div style={{
        position: "fixed", top: 8, left: 10, color: "#dfe6ee",
        font: "12px monospace", background: "rgba(0,0,0,0.6)",
        padding: "5px 9px", borderRadius: 4,
      }}>
        {label}
      </div>
    </div>
  )
}

/** The red line every foot should touch, and never cross. */
function GroundLine({ span }: { span: number }) {
  return (
    <mesh position={[0, 0.006, 0.62]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[span, 0.022]} />
      <meshBasicMaterial color="#e0533a" />
    </mesh>
  )
}

export default function GaitTest() {
  const strip = flag("strip", "walk")
  if (strip === "work") return <WorkStrip />
  if (strip === "sit") return <SitCheck />
  return <WalkStrip carry={strip === "carry"} />
}

const N = 8
const PITCH = 0.95

function WalkStrip({ carry }: { carry: boolean }) {
  const gen = carry ? walkCarryPose : walkPose
  const span = N * PITCH
  return (
    <Stage
      label={`GAIT · ${carry ? "walking, carrying" : "walking"} — 8 phases of one cycle, side on`}
      position={[0, 0.95, 30]}
      target={[0, 0.95, 0]}
      zoom={172}
    >
      {Array.from({ length: N }, (_, i) => {
        const phase = (i / N) * Math.PI * 2
        return (
          <group
            key={i}
            position={[(i - (N - 1) / 2) * PITCH, 0, 0]}
            rotation={[0, Math.PI * 0.40, 0]}
          >
            <Posed
              map={gen(phase)}
              bob={walkBob(phase)}
              seed={i * 5 + 2}
              hair={(i % 3) as 0 | 1 | 2}
            />
          </group>
        )
      })}
      <GroundLine span={span + 1} />
    </Stage>
  )
}

const ACTIONS = ["search", "browse", "draw", "operate", "greet"] as const
const SAMPLES = [0, 0.42, 0.84]

function WorkStrip() {
  const total = ACTIONS.length * SAMPLES.length
  return (
    <Stage
      label="GAIT · station actions — search · browse · draw · operate · greet, three moments each"
      position={[0, 0.95, 30]}
      target={[0, 0.95, 0]}
      zoom={150}
    >
      {ACTIONS.map((a, ai) =>
        SAMPLES.map((t, si) => {
          const i = ai * SAMPLES.length + si
          return (
            <group
              key={`${a}${si}`}
              position={[(i - (total - 1) / 2) * 1.02, 0, 0]}
              rotation={[0, -Math.PI * 0.17, 0]}
            >
              <Posed
                map={workPose(a, t)}
                seed={ai * 7 + 1}
                hair={(ai % 3) as 0 | 1 | 2}
                shirt={si === 0 ? PAL.agentSub : PAL.agentMain}
              />
            </group>
          )
        }),
      )}
      <GroundLine span={total * 1.02 + 1} />
    </Stage>
  )
}

/**
 * The seated figure where it actually sits: the desk station's own chair, at
 * the station's own stand point, from the room's camera angle. The lineup rig
 * placed its chair wherever suited the lineup — which is how a figure sitting
 * through the backrest went unnoticed.
 */
function SitCheck() {
  const stand = STATIONS.desk.stand
  const target: Vec3 = [2.6, 0.85, 2.15]
  return (
    <Stage
      label="GAIT · seated at the real desk station, from the room's camera angle"
      position={[target[0] + 9, target[1] + 6.9, target[2] + 9]}
      target={target}
      zoom={300}
    >
      <MainDesk position={[2.60, 0, 1.70]} rotation={[0, -Math.PI * 0.08, 0]} />
      <Chair position={[2.60, 0, 2.32]} rotation={[0, Math.PI * 0.92, 0]} />
      <group position={[stand[0], 0, stand[1]]} rotation={[0, Math.PI, 0]}>
        <Posed map={workPose("sit", 0.4)} seated seed={4} hair={1} />
      </group>
    </Stage>
  )
}
