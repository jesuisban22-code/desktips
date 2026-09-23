/**
 * Isolation rig. `?debug=piece&p=<name>&a=<deg>&e=<deg>&r=<m>` renders one
 * object alone on a fixed orbit, so two runs are comparable and a part that
 * pokes through something is obvious instead of being hidden behind the rest
 * of the room.
 */
import { Canvas } from "@react-three/fiber"
import { ContactShadows } from "@react-three/drei"
import { chamfer as chamferBox } from "../three/kit"
import {
  MainDesk, DraftingTable, Workbench, Chair, Stool, Armchair, SideTable,
} from "./Furniture"
import {
  DeskLamp, PendantLamp, Plant, Mug, PictureFrame, DeskClutter, FloorClutter,
  FloorLamp,
} from "./Props"
import { Bookshelf, FilingCabinet, Pegboard, WallShelf } from "./Storage"
import { Character } from "./Character"
import { M } from "../three/materials"

/** A seated figure on the desk chair, at the exact offset the desk station
 *  uses (chair z 2.58, sitter z 2.55) so the rig shows what the room shows. */
function SeatedAtDesk() {
  return (
    <group>
      <Chair position={[0, 0, 0.03]} rotation={[0, 0, 0]} />
      <Character seated pose="writing" position={[0, 0, 0]} rotation={[0, 0, 0]} />
    </group>
  )
}

function CarryingFigure() {
  const tints = ["#c9a06a", "#b98d55", "#d8b784", "#a97f4c"]
  return (
    <group>
      <Character pose="carrying" position={[0, 0, 0]} rotation={[0, 0, 0]} />
      <group position={[0, 1.176, 0.238]} rotation={[0.17, 0, 0]}>
        {Array.from({ length: 4 }, (_, i) => (
          <mesh
            key={i}
            geometry={chamferBox(0.30, 0.013, 0.215, 0.004)}
            material={M.folder(tints[i % tints.length])}
            position={[(i % 2) * 0.008 - 0.004, i * 0.015, (i % 3) * 0.005 - 0.005]}
            rotation={[0, (i - 2) * 0.03, (i % 2 ? 1 : -1) * 0.012]}
            castShadow
          />
        ))}
      </group>
    </group>
  )
}

/** Each entry: the element, and the height its camera should aim at. */
const PIECES: Record<string, { el: JSX.Element; aim: number; r: number }> = {
  desk:      { el: <MainDesk position={[0, 0, 0]} />,       aim: 0.42, r: 3.4 },
  table:     { el: <DraftingTable position={[0, 0, 0]} />,  aim: 0.62, r: 3.2 },
  workbench: { el: <Workbench position={[0, 0, 0]} rotation={[0, 0, 0]} />, aim: 0.55, r: 3.8 },
  chair:     { el: <Chair position={[0, 0, 0]} />,          aim: 0.50, r: 2.2 },
  stool:     { el: <Stool position={[0, 0, 0]} />,          aim: 0.35, r: 1.8 },
  armchair:  { el: <Armchair position={[0, 0, 0]} />,       aim: 0.45, r: 2.6 },
  sidetable: { el: <SideTable position={[0, 0, 0]} />,      aim: 0.32, r: 1.8 },
  bookshelf: { el: <Bookshelf position={[0, 0, 0]} />,      aim: 1.00, r: 4.2 },
  cabinet:   { el: <FilingCabinet position={[0, 0, 0]} />,  aim: 0.55, r: 2.6 },
  pegboard:  { el: <Pegboard position={[0, 1.45, 0]} />,    aim: 1.45, r: 2.6 },
  wallshelf: { el: <WallShelf position={[0, 1.55, 0]} />,   aim: 1.55, r: 1.8 },
  desklamp:  { el: <DeskLamp position={[0, 0, 0]} />,       aim: 0.22, r: 1.2 },
  floorlamp: { el: <FloorLamp position={[0, 0, 0]} />,      aim: 0.85, r: 3.0 },
  pendant:   { el: <PendantLamp position={[0, 2.4, 0]} />,  aim: 2.10, r: 2.0 },
  plant:     { el: <Plant position={[0, 0, 0]} />,          aim: 0.35, r: 1.8 },
  mug:       { el: <Mug position={[0, 0, 0]} />,            aim: 0.05, r: 0.45 },
  frame:     { el: <PictureFrame position={[0, 1.5, 0]} />, aim: 1.50, r: 1.8 },
  clutter:   { el: <DeskClutter position={[0, 0, 0]} />,    aim: 0.06, r: 1.5 },
  floorjunk: { el: <FloorClutter position={[0, 0, 0]} />,   aim: 0.20, r: 1.8 },
  seat:      { el: <SeatedAtDesk />,                       aim: 0.75, r: 3.2 },
  carry:     { el: <CarryingFigure />,                     aim: 0.95, r: 3.2 },
  stand:     { el: <Character pose="idle" />,              aim: 0.95, r: 3.2 },
  think:     { el: <Character pose="thinking" />,          aim: 1.10, r: 2.6 },
}

export default function FurnitureTest() {
  const q = new URLSearchParams(window.location.search)
  const key = q.get("p") ?? "table"
  const piece = PIECES[key] ?? PIECES.table
  const a = ((Number(q.get("a") ?? 35)) * Math.PI) / 180
  const e = ((Number(q.get("e") ?? 18)) * Math.PI) / 180
  const r = Number(q.get("r") ?? piece.r)
  const aim = Number(q.get("y") ?? piece.aim)
  const cam: [number, number, number] = [
    r * Math.cos(e) * Math.sin(a),
    aim + r * Math.sin(e),
    r * Math.cos(e) * Math.cos(a),
  ]
  return (
    <Canvas
      shadows
      dpr={1}
      camera={{ position: cam, fov: 28 }}
      onCreated={({ camera }) => camera.lookAt(0, aim, 0)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#20180f"]} />
      <hemisphereLight args={["#ffe6c0", "#2a1d12", 0.75]} />
      <directionalLight
        position={[3.2, 4.4, 2.6]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <directionalLight position={[-3, 2, -2.5]} intensity={0.85} />
      <directionalLight position={[0, 1.2, 4]} intensity={0.45} />
      {piece.el}
      <ContactShadows position={[0, 0.002, 0]} opacity={0.45} scale={6} blur={2.2} far={2.5} />
    </Canvas>
  )
}
