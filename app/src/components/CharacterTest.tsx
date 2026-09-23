/**
 * CharacterTest — a lineup rig for checking the figure in isolation.
 *
 * Open with ?debug=chars. Renders every pose standing and seated against a
 * plain ground so joint rotations, proportions and silhouettes can be judged
 * without the room's lighting and clutter hiding problems.
 */

import { Canvas } from "@react-three/fiber"
import { OrbitControls, Grid } from "@react-three/drei"
import * as THREE from "three"
import { Character, type Pose } from "./Character"
import { Chair } from "./Furniture"
import { M } from "../three/materials"
import { PAL } from "../three/palette"

const POSES: Pose[] = ["idle", "thinking", "writing", "carrying", "walking"]

function closeUp(): boolean {
  return new URLSearchParams(window.location.search).get("view") === "close"
}

export default function CharacterTest() {
  if (closeUp()) return <CloseUp />
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#20242a" }}>
      <Canvas
        shadows="soft"
        camera={{ position: [3.2, 2.4, 6.2], fov: 32 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}
      >
        <OrbitControls target={[0, 0.85, 0]} />
        <hemisphereLight args={["#cfe3f2", "#4a4038", 0.7]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[4, 7, 5]}
          intensity={2.0}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        />
        <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#9fc4de" />

        {/* ground */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#6e6257" roughness={0.95} />
        </mesh>
        <Grid
          args={[40, 40]}
          cellSize={0.5}
          cellColor="#8a7d70"
          sectionSize={1}
          sectionColor="#a89a8a"
          position={[0, 0.002, 0]}
          fadeDistance={22}
        />

        {/* Standing row — every pose, each hair style cycling */}
        {POSES.map((p, i) => (
          <group key={p} position={[(i - 2) * 1.1, 0, 0]}>
            <Character
              pose={p}
              hairStyle={(i % 3) as 0 | 1 | 2}
              skinTone={["#e8b894", "#c98d63", "#8d5a3c", "#f0c9a8", "#6f4430"][i]}
              shirtColor={i % 2 ? PAL.agentSub : PAL.agentMain}
              seed={i * 11 + 1}
            />
            <Marker label={i} />
          </group>
        ))}

        {/* Seated row — on real chairs, to verify the figure lands on the seat */}
        {POSES.slice(0, 3).map((p, i) => (
          <group key={`s${p}`} position={[(i - 1) * 1.3, 0, 2.2]}>
            <Chair position={[0, 0, 0.03]} rotation={[0, Math.PI, 0]} />
            <Character
              pose={p}
              seated
              hairStyle={((i + 1) % 3) as 0 | 1 | 2}
              shirtColor={PAL.agentMain}
              seed={i * 7 + 4}
            />
          </group>
        ))}

        {/* A 1.72 m height reference post beside the lineup */}
        <mesh position={[-3.4, 0.86, 0]} material={M.steel()} castShadow>
          <boxGeometry args={[0.03, 1.72, 0.03]} />
        </mesh>
        {[0.45, 0.75, 1.72].map(h => (
          <mesh key={h} position={[-3.4, h, 0.06]} material={M.status("#ff5555", 1.2)}>
            <boxGeometry args={[0.12, 0.006, 0.06]} />
          </mesh>
        ))}
      </Canvas>
      <div style={{
        position: "fixed", top: 10, left: 12, color: "#dfe6ee",
        font: "12px monospace", background: "rgba(0,0,0,0.55)",
        padding: "6px 10px", borderRadius: 4, lineHeight: 1.6,
      }}>
        CHARACTER TEST — back row standing: idle · thinking · writing · carrying · walking<br />
        front row seated: idle · thinking · writing · &nbsp; red marks: 0.45 seat / 0.75 desk / 1.72 height
      </div>
    </div>
  )
}

function Marker({ label }: { label: number }) {
  return (
    <mesh position={[0, 0.004, 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.055 + label * 0.001, 12]} />
      <meshStandardMaterial color="#2f3a44" roughness={1} />
    </mesh>
  )
}


/** A single figure filling the frame, front and three-quarter. */
function CloseUp() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#20242a" }}>
      <Canvas
        shadows="soft"
        camera={{ position: [1.15, 1.35, 2.6], fov: 30 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap }}
      >
        <OrbitControls target={[0, 1.05, 0]} />
        <hemisphereLight args={["#cfe3f2", "#4a4038", 0.75]} />
        <ambientLight intensity={0.30} />
        <directionalLight
          position={[3, 6, 4]} intensity={2.0} castShadow
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        />
        <directionalLight position={[-4, 2, -3]} intensity={0.55} color="#9fc4de" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#6e6257" roughness={0.95} />
        </mesh>

        {/* front view — each wears one of the accessories (Character.tsx) */}
        <Character pose="idle" hairStyle={0} shirtColor={PAL.agentMain} seed={2} accessory={1} />
        {/* three-quarter, different hair */}
        <group position={[0.95, 0, 0]} rotation={[0, -0.7, 0]}>
          <Character pose="carrying" hairStyle={1} shirtColor={PAL.agentSub} seed={5} accessory={2} />
        </group>
        {/* seated on a real chair */}
        <group position={[-1.05, 0, 0.1]}>
          <Chair position={[0, 0, 0.03]} rotation={[0, Math.PI, 0]} />
          <Character pose="writing" seated hairStyle={2} shirtColor={PAL.agentMain} seed={9} accessory={3} />
        </group>
      </Canvas>
    </div>
  )
}
