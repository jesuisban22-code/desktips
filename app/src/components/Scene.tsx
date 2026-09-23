/**
 * Bureau — the atelier scene.
 *
 * True isometric: an orthographic camera on the (1, 0.82, 1) diagonal. The
 * orbit is deliberately clamped to a narrow arc so the room always reads as an
 * isometric illustration rather than a free-flying 3D viewer.
 */

import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls, AdaptiveDpr, Preload } from "@react-three/drei"
import * as THREE from "three"
import { Suspense, useLayoutEffect } from "react"

import { Room } from "./Room"
import { MainDesk, DraftingTable, Workbench, Chair, Stool, Armchair, SideTable } from "./Furniture"
import { Bookshelf, FilingCabinet, Pegboard, WallShelf } from "./Storage"
import { DeskLamp, FloorLamp, Plant, PictureFrame, DeskClutter, FloorClutter, Mug } from "./Props"
import { Lighting, Effects } from "./Lighting"
import { AgentLayer } from "./AgentLayer"
import { HUD } from "./HUD"
import EmptyState from "./EmptyState"
import { StaticBatch } from "./StaticBatch"
import { Slate } from "./Slate"
import { Terminal, DraftingSheet, SignalLamp, WallClock, MugSteam } from "./Workshop"
import { FrameDriver } from "./FrameDriver"
import { CameraRig, fit } from "./CameraRig"
import { useTauriEvents } from "../hooks/useTauriEvents"
import { voidTexture } from "../three/textures"
import { PAL } from "../three/palette"
import { useStore } from "../store"
import { useSettings } from "../ui/settings"
import { wake } from "../anim/activity"

/**
 * What the camera must always hold in frame: the plinth, the two walls and the
 * beams above them.
 */
// Tight on purpose. An over-generous box is not a safety margin: every extra
// centimetre is a real shrink of the room, because the fit is height-limited
// on any 16:9 window. -0.21 is the plinth's bottom edge at the near corner —
// the lowest thing you can actually see — and 3.43 is the cornice.
const FRAME_BOX = new THREE.Box3(
  new THREE.Vector3(-6.09, -0.21, -6.09),
  new THREE.Vector3( 6.09,  3.43,  6.09),
)

/** Orthographic projection is affine, so the centre of the box projects to the
 *  centre of its silhouette: aiming here centres the room exactly. */
const FRAME_CENTRE = FRAME_BOX.getCenter(new THREE.Vector3())

/** The overlay owns these edges: the counters along the top, the timeline strip
 *  along the bottom. Framing the room inside the whole window put the ceiling
 *  beams under the counters. The widget has only a thin bar to leave room for. */
const PAD_FULL   = { top: 44, bottom: 54, side: 26 }
const PAD_WIDGET = { top: 26, bottom: 6,  side: 6 }

/**
 * The zoom used to be the constant 83. An orthographic zoom is pixels per world
 * unit, so a constant one means the framing is decided by whatever monitor the
 * app happens to open on: on the 1456-px window I watched it run in, the room
 * left a quarter of the frame as empty background, and on a small laptop it
 * would have been cropped instead.
 *
 * So: project the eight corners of FRAME_BOX into camera space, take the
 * silhouette's width and height in world units, and pick the zoom that makes
 * the tighter of the two fit the area the overlay leaves free — recomputed
 * whenever the window changes size.
 */
function FitToViewport({ margin = 1.0 }: { margin?: number }) {
  const camera   = useThree(s => s.camera)
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update?: () => void } | null
  const width    = useThree(s => s.size.width)
  const height   = useThree(s => s.size.height)
  const widget   = useStore(s => s.widget)

  useLayoutEffect(() => {
    const PAD = widget ? PAD_WIDGET : PAD_FULL
    const cam = camera as THREE.OrthographicCamera
    if (!cam.isOrthographicCamera) return
    cam.updateMatrixWorld()

    const toCam = new THREE.Matrix4().copy(cam.matrixWorld).invert()
    const v = new THREE.Vector3()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < 8; i++) {
      v.set(
        i & 1 ? FRAME_BOX.max.x : FRAME_BOX.min.x,
        i & 2 ? FRAME_BOX.max.y : FRAME_BOX.min.y,
        i & 4 ? FRAME_BOX.max.z : FRAME_BOX.min.z,
      ).applyMatrix4(toCam)
      if (v.x < minX) minX = v.x
      if (v.x > maxX) maxX = v.x
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
    }

    const usableW = Math.max(width  - PAD.side * 2,        240)
    const usableH = Math.max(height - PAD.top - PAD.bottom, 200)
    const spanX = Math.max(maxX - minX, 1e-3) * margin
    const spanY = Math.max(maxY - minY, 1e-3) * margin

    const zoom = Math.min(usableW / spanX, usableH / spanY)

    // Centre the room in the band the overlay leaves, not in the window.
    // Moving the orbit target along the camera's own up axis slides the image
    // the other way, one world unit per `zoom` pixels.
    const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize()
    const shiftPx = (PAD.top - PAD.bottom) / 2
    fit.target.copy(FRAME_CENTRE).addScaledVector(camUp, shiftPx / zoom)
    fit.zoom = zoom
    fit.ready = true

    // Looking at something in particular: CameraRig owns the view, and uses
    // this framing only as its scale and its way back.
    if (useStore.getState().focus) return

    cam.zoom = zoom
    cam.updateProjectionMatrix()
    if (controls?.target) {
      controls.target.copy(fit.target)
      controls.update?.()
    }
    wake(400)
  }, [camera, controls, width, height, margin, widget])

  return null
}

/** ?fx=0 disables post-processing, ?q=low drops shadow resolution. */
function urlFlag(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  return new URLSearchParams(window.location.search).get(key) ?? fallback
}

export default function Scene() {
  useTauriEvents()
  const widget = useStore(s => s.widget)
  // The widget is a few hundred pixels across: ambient occlusion and bloom
  // cost the same per pixel there and show next to nothing.
  // The URL flags still win over the settings, so captures stay reproducible.
  const effects = useSettings(s => s.effects)
  const shadows = useSettings(s => s.quality)
  const fxFlag  = urlFlag("fx", "")
  const qFlag   = urlFlag("q", "")
  const fxOn = (fxFlag ? fxFlag !== "0" : effects) && !widget
  const quality: "high" | "low" = qFlag ? (qFlag === "low" ? "low" : "high") : shadows
  const batch = urlFlag("batch", "1") !== "0"

  return (
    <div style={{ width: "100vw", height: "100vh", background: PAL.bgVoid, position: "relative" }}>
      <Canvas
        style={{ position: "absolute", inset: 0 }}
        // Drawn on demand: see FrameDriver. A monitor spends its day showing a
        // room where nothing moves.
        frameloop="demand"
        // Clicking the floor or the walls lets go of whatever was focused.
        onPointerMissed={() => useStore.getState().setFocus(null)}
        shadows="soft"
        dpr={[1, 2]}
        orthographic
        camera={{ position: [16, 12.2, 16], zoom: 83, near: -60, far: 140 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl, scene, camera }) => {
          gl.shadowMap.type = THREE.PCFSoftShadowMap
          // The room used to sit in flat near-black, which reads as a hole
          // punched in the window rather than as a room at dusk. A warm pool
          // behind it, falling off to the corners, gives it somewhere to be.
          // (A CSS gradient under a transparent canvas would be simpler, but
          // the post-processing composer writes an opaque frame over it.)
          scene.background = voidTexture(PAL.bgWarm, PAL.bgMid, PAL.bgVoid)
          scene.fog = new THREE.Fog(PAL.fogNear, 26, 52)
          // scripts/audit.mjs reads the real graph through this handle rather
          // than a hand transcription — a transcription is what let the
          // drafting table ship with two members rotated the wrong way.
          if (urlFlag("audit", "0") === "1") {
            ;(window as unknown as { __scene?: unknown; __THREE_V3?: unknown }).__scene = scene
            ;(window as unknown as { __THREE_V3?: unknown }).__THREE_V3 = THREE.Vector3
            // For timing a render directly: with frameloop="demand" the frame
            // rate says nothing about what one frame costs.
            ;(window as unknown as { __gl?: unknown; __camera?: unknown }).__gl = gl
            ;(window as unknown as { __camera?: unknown }).__camera = camera
          }
        }}
      >
        <Suspense fallback={null}>
          <Atelier fxOn={fxOn} quality={quality} batch={batch} />
          <Preload all />
        </Suspense>
        <AdaptiveDpr pixelated />
      </Canvas>
      <HUD />
      <EmptyState />
    </div>
  )
}

function Atelier({ fxOn, quality, batch }: { fxOn: boolean; quality: "high" | "low"; batch: boolean }) {
  return (
    <>
      <FrameDriver />
      <FitToViewport />
      <CameraRig />

      <OrbitControls
        makeDefault
        enablePan={false}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.40}
        minAzimuthAngle={Math.PI * 0.10}
        maxAzimuthAngle={Math.PI * 0.40}
        // Wide enough that the fitted zoom is never clamped: OrbitControls
        // re-clamps object.zoom on every frame, so limits tighter than the fit
        // would silently undo it.
        minZoom={22}
        // High enough to read the chalkboard from close up.
        maxZoom={900}
        enableDamping
        dampingFactor={0.07}
      />

      {/* Keyed: a shadow map is allocated once at its first size, so a new
          quality needs new lights rather than new numbers on the old ones. */}
      <Lighting key={quality} quality={quality} />

      {/* Everything from here to the people is static once mounted, and is
          welded into a few dozen meshes (see StaticBatch). ?batch=0 skips it. */}
      <StaticBatch enabled={batch}>

      {/* ── Shell ─────────────────────────────────────────────────────── */}
      <Room />

      {/* ── Storage against the walls ─────────────────────────────────── */}
      <Bookshelf     position={[ 2.20, 0, -5.55]} />
      <WallShelf     position={[-0.20, 1.70, -5.82]} />
      <FilingCabinet position={[ 4.70, 0, -4.60]} rotation={[0, -Math.PI * 0.06, 0]} />
      <Pegboard      position={[-5.88, 1.70,  1.40]} />

      {/* ── Furniture ─────────────────────────────────────────────────── */}
      <MainDesk      position={[ 2.60, 0,  1.70]} rotation={[0, -Math.PI * 0.08, 0]} />
      <Chair         position={[ 2.60, 0,  2.32]} rotation={[0,  Math.PI * 0.92, 0]} />

      <DraftingTable position={[-1.40, 0, -3.50]} rotation={[0,  Math.PI * 0.03, 0]} />
      <Stool         position={[-1.40, 0, -2.62]} rotation={[0,  Math.PI * 0.02, 0]} />

      <Workbench     position={[-5.10, 0,  1.40]} rotation={[0,  Math.PI * 0.50, 0]} />

      {/* Foreground nook — the near corner was bare floor, which an isometric
          view puts right in the middle of the frame. */}
      <Armchair      position={[-2.30, 0,  4.05]} rotation={[0,  1.12, 0]} />
      <SideTable     position={[-1.18, 0,  4.30]} rotation={[0,  0.32, 0]} />
      <FloorLamp     position={[-3.25, 0,  3.35]} rotation={[0,  0.50, 0]} height={1.52} />

      {/* ── Lamps ─────────────────────────────────────────────────────── */}
      <DeskLamp      position={[ 3.22, 0.77,  1.30]} rotation={[0, -Math.PI * 0.65, 0]} />
      {/* A desk lamp cannot stand ON a board tilted 20°: its base sat at 0.76
          where the board's underside is 0.92, so the stem rose straight
          through the drawing surface. A standing lamp beside the table lights
          it from above and is clear of the board's footprint in x. */}
      <FloorLamp     position={[-0.42, 0,    -3.92]} rotation={[0, -0.55, 0]} height={1.46} />
      <DeskLamp      position={[-4.78, 0.98,  0.62]} rotation={[0,  Math.PI * 0.14, 0]} />

      {/* ── Green ─────────────────────────────────────────────────────── */}
      <Plant position={[-5.30, 0, -4.90]} scale={1.15} seed={3} />
      <Plant position={[ 3.70, 0,  3.55]} scale={1.22} seed={11} />
      <Plant position={[ 0.90, 0, -5.40]} scale={0.72} seed={29} />
      <Plant position={[ 5.15, 0,  1.55]} scale={1.05} seed={43} />

      {/* ── Paper & clutter ───────────────────────────────────────────── */}
      <PictureFrame position={[-5.86, 2.05, -3.10]} rotation={[0, Math.PI * 0.5, 0]} size={0.62} kind="blueprint" />
      <PictureFrame position={[-5.86, 1.62, -3.10]} rotation={[0, Math.PI * 0.5, 0]} size={0.42} kind="photo" />
      <DeskClutter  position={[ 2.60, 0.77,  1.70]} rotation={[0, -Math.PI * 0.08, 0]} seed={7} />
      <FloorClutter position={[ 4.55, 0,     2.95]} seed={19} />
      <Mug          position={[-1.18, 0.520, 4.28]} color="#cfd6cc" />

      {/* ── What the work leaves behind (Workshop.tsx) ─────────────────── */}
      {/* Same frames as the bench and the drafting table they sit on. Their
          housings weld with the furniture; what changes is either a texture
          on a material of its own (screens, paper, the lamp's dome) or marked
          userData.dynamic (the clock's hands, the pile of sheets). */}
      <Terminal      position={[-5.10, 0,  1.40]} rotation={[0, Math.PI * 0.50, 0]} />
      <DraftingSheet position={[-1.40, 0, -3.50]} rotation={[0, Math.PI * 0.03, 0]} />
      <SignalLamp    position={[-5.885, 2.36, 4.00]} rotation={[0, Math.PI / 2, 0]} />
      <WallClock     position={[ 4.35, 2.12, -5.885]} />

      </StaticBatch>

      {/* The chalkboard by the door: redrawn when the request changes, and
          clickable, so it stays out of the batch. */}
      <Slate />

      {/* Steam off the mug DeskClutter sets at (0.30, −0.04) of the desk's frame. */}
      <MugSteam      position={[ 2.90, 0.772, 1.736]} />

      {/* ── The people ────────────────────────────────────────────────── */}
      <AgentLayer />

      <Effects enabled={fxOn} quality={quality} />
    </>
  )
}
