/**
 * Lighting.tsx — the light story and the post-processing stack.
 *
 * The scene is set in LATE AFTERNOON. A low warm sun rakes in through the
 * back-wall windows; cool skylight fills the shadows from above; the practical
 * lamps inside are lit and just starting to matter. That contrast — warm key
 * against cool fill — is what keeps a beige room from reading as grey mud.
 *
 * Shadow bias is set deliberately. The whole scene is built from chamfered
 * geometry, and chamfers are exactly where shadow acne shows up first; without
 * the normalBias below, every softened edge grows a dark fringe and the
 * geometry work is wasted.
 */

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { registerShadowLights } from "./FrameDriver"
import { DustMotes } from "./Dust"
import { wake, glance } from "../anim/activity"
import { M } from "../three/materials"
import { useDaylight, type Daylight } from "../three/daylight"
import {
  EffectComposer, N8AO, Bloom, Vignette, SMAA,
} from "@react-three/postprocessing"
import { PAL } from "../three/palette"

// ── Lights ───────────────────────────────────────────────────────────────────

export interface LightingProps {
  quality?: "high" | "low"
}

export function Lighting({ quality = "high" }: LightingProps) {
  const high = quality === "high"
  const sun  = useRef<THREE.DirectionalLight>(null)
  const lamp = useRef<THREE.PointLight | null>(null)
  const practicals = useRef<Array<THREE.PointLight | null>>([])
  const day = useDaylight()

  useEffect(() => { applyDaylight(day) }, [day])

  // Aim the sun at the room centre once it exists
  useFrame(() => {
    if (sun.current && sun.current.target.position.lengthSq() === 0) {
      sun.current.target.position.set(0.5, 0.7, 1.5)
      sun.current.target.updateMatrixWorld()
    }
    // The practicals flicker a little. This runs at whatever rate the room is
    // being drawn, which at rest is slow — and slow flicker reads as candle-soft.
    const t = performance.now() / 1000
    practicals.current.forEach((l, i) => {
      if (l) l.intensity = PRACTICAL_BASE[i] * day.lamps * flicker(t, i)
    })
  })

  // From here on the shadow maps are redrawn only when something moves
  // (FrameDriver). The first seconds are drawn in full while the room settles.
  useEffect(() => {
    registerShadowLights(sun.current, high ? lamp.current : null)
    wake(3000)
    return () => registerShadowLights(null, null)
  }, [high])

  return (
    <>
      {/* Sky/ground hemisphere — grounds everything far better than a flat
          ambient, because the floor bounce arrives from below. */}
      <hemisphereLight
        args={[PAL.skyCool, PAL.floorMid, 0.42]}
        position={[0, 6, 0]}
      />

      {/* A whisper of warm ambient so shadow cores never crush to black */}
      <ambientLight intensity={0.12} color={PAL.skyWarm} />

      {/* ── KEY: the sun, coming through the back windows ─────────────── */}
      {/* By night the same light, dimmed and blue, is the moon. */}
      <directionalLight
        ref={sun}
        position={[-6.5, 5.6, -9.5]}
        intensity={2.35 * day.sun}
        color={day.sunColor}
        castShadow
        shadow-mapSize-width={high ? 2048 : 1024}
        shadow-mapSize-height={high ? 2048 : 1024}
        shadow-camera-near={0.5}
        shadow-camera-far={34}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
        shadow-normalBias={0.022}
        shadow-radius={high ? 3 : 1}
      />

      {/* ── FILL: cool skylight from the open corner, so camera-facing
             surfaces aren't silhouettes ──────────────────────────────── */}
      <directionalLight
        position={[9, 7, 10]}
        intensity={0.38 * day.fill}
        color="#9fc4de"
      />

      {/* ── BOUNCE: warm kick off the floor ───────────────────────────── */}
      <directionalLight
        position={[2, -3, 6]}
        intensity={0.20 * Math.max(0.35, day.sun)}
        color="#c98a4a"
      />

      {/* ── PRACTICALS ────────────────────────────────────────────────── */}
      {/* Intensities are set every frame in useFrame (the flicker); the
          values here are the first frame's. */}
      {/* Desk lamp over the main desk */}
      <pointLight
        ref={el => { practicals.current[0] = el }}
        position={[3.05, 1.28, 1.30]}
        intensity={PRACTICAL_BASE[0] * day.lamps}
        color={PAL.lampGlow}
        distance={4.6}
        decay={2}
      />
      {/* Standing lamp beside the drafting table. Brighter than the desk lamp
          it replaced: the source is now 1.3 m from the board instead of 0.4,
          and inverse-square falloff eats the difference. */}
      <pointLight
        ref={el => { practicals.current[1] = el }}
        position={[-0.42, 1.34, -3.92]}
        intensity={PRACTICAL_BASE[1] * day.lamps}
        color={PAL.lampGlow}
        distance={5.2}
        decay={2}
      />
      {/* Workbench lamp — the only practical that casts */}
      <pointLight
        ref={el => { lamp.current = el; practicals.current[2] = el }}
        position={[-4.62, 1.48, 0.62]}
        intensity={PRACTICAL_BASE[2] * day.lamps}
        color={PAL.lampGlow}
        distance={5.2}
        decay={2}
        castShadow={high}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0025}
        shadow-normalBias={0.03}
      />

      {/* Floor lamp in the near corner. Without its own source the shade is
          just a dark drum on a pole, and the whole foreground stays cold. */}
      <pointLight
        ref={el => { practicals.current[3] = el }}
        position={[-3.25, 1.42, 3.35]}
        intensity={PRACTICAL_BASE[3] * day.lamps}
        color={PAL.lampGlow}
        distance={5.4}
        decay={2}
      />

      {/* ── Window bounce: cool light spilling in at each opening ─────── */}
      <pointLight position={[-1.6, 1.85, -5.35]} intensity={2.6 * day.window} color="#bcd8ea" distance={3.4} decay={2} />
      <pointLight position={[-4.2, 1.85, -5.35]} intensity={2.6 * day.window} color="#bcd8ea" distance={3.4} decay={2} />
      <pointLight position={[-5.35, 1.85, -1.2]} intensity={2.2 * day.window} color="#bcd8ea" distance={3.2} decay={2} />

      <DustMotes level={day.dust} color={day.sunColor} />
    </>
  )
}

/** The practical lamps' designed intensities, before time of day and flicker. */
const PRACTICAL_BASE = [7, 10, 10, 8]

/**
 * A filament is never perfectly steady. Three incommensurate sines per lamp,
 * a few percent at most: noticed as warmth, not as a fault.
 */
function flicker(t: number, lamp: number): number {
  const p = lamp * 1.93
  return 1 + 0.018 * Math.sin(t * 7.3 + p) + 0.012 * Math.sin(t * 13.7 + p * 2.1)
           + 0.008 * Math.sin(t * 29.1 + p * 3.7)
}

/**
 * The window glass, the light shafts and the lamp shades are shared materials
 * built elsewhere; the time of day is applied to them here, as factors of
 * their designed values (captured the first time).
 */
const designed = new Map<THREE.Material, { opacity: number; emissive: number; color: THREE.Color }>()
function scaleMaterial(m: THREE.Material, opacity: number | null, emissive: number | null, color?: THREE.Color) {
  let d = designed.get(m)
  const std = m as THREE.MeshStandardMaterial
  const basic = m as THREE.MeshBasicMaterial
  if (!d) {
    d = {
      opacity: m.opacity,
      emissive: std.emissiveIntensity ?? 1,
      color: (basic.color ?? new THREE.Color()).clone(),
    }
    designed.set(m, d)
  }
  if (opacity !== null) m.opacity = d.opacity * opacity
  if (emissive !== null && std.emissiveIntensity !== undefined) std.emissiveIntensity = d.emissive * emissive
  if (color && basic.color) basic.color.copy(d.color).multiply(color)
}

function applyDaylight(day: Daylight): void {
  // What the windows show: the sky texture, tinted — and after dark, the city.
  scaleMaterial(M.sky(), null, null, day.sky)
  const city = Math.min(1, Math.max(0, (0.70 - day.sun) / 0.55))
  ;(M.sky().userData.night as { value: number }).value = city
  // The shafts: fainter as the sun drops, coloured by it.
  for (const op of [0.050, 0.055, 0.060]) {
    const shaft = M.lightShaft(PAL.skyWarm, op)
    scaleMaterial(shaft, day.shaft, null)
    ;(shaft as THREE.MeshBasicMaterial).color.copy(day.sunColor)
  }
  // Lit shades glow more when they are the main light in the room.
  const glow = Math.min(1.6, 0.55 + day.lamps * 0.6)
  for (const m of [M.shadeOuter(), M.shadeInner(), M.diffuser(), M.bulb()]) scaleMaterial(m, null, glow)
  // A few frames to show it — as a glance, not a wake: this runs every thirty
  // seconds, and a wake each time restarted the room's slow-down, so an idle
  // room never got below 12 fps (measured: a burst to 30 fps every 30 s).
  // The sun only changes intensity and colour, never direction: the shadow
  // maps are unaffected.
  glance(150)
}

// ── Post-processing ──────────────────────────────────────────────────────────

export interface EffectsProps {
  enabled?: boolean
  quality?: "high" | "low"
}

/**
 * Order matters: ambient occlusion before bloom (so AO darkens contact points
 * before the highlights are picked out), vignette last.
 *
 * Bloom threshold is high on purpose — only the bulbs and the lit shade
 * interiors should glow. A low threshold makes the whole beige room bloom and
 * the result looks like a soft-focus filter, not lamplight.
 */
export function Effects({ enabled = true, quality = "high" }: EffectsProps) {
  if (!enabled) return null

  // NOTE: no <ToneMapping /> here. The renderer is already set to ACES
  // filmic in Scene.tsx, and a composer tone-mapping pass applies it a
  // SECOND time — which crushed the whole room to near-black. AO intensity
  // is likewise conservative: at 2.6 with a dark AO colour the occlusion
  // swallowed the warm bounce light and the atelier read as a night scene.
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <N8AO
        aoRadius={0.34}
        distanceFalloff={0.75}
        intensity={1.05}
        quality={quality === "high" ? "medium" : "low"}
        color="#3a2a16"
        halfRes={quality !== "high"}
      />
      <Bloom
        luminanceThreshold={0.88}
        luminanceSmoothing={0.28}
        intensity={0.42}
        mipmapBlur
        radius={0.58}
      />
      <Vignette offset={0.42} darkness={0.32} eskil={false} />
      <SMAA />
    </EffectComposer>
  )
}
