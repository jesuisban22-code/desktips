/**
 * FrameDriver.tsx — draw the room when something in it moves, and not otherwise.
 *
 * The canvas runs with frameloop="demand": nothing is drawn unless asked for.
 * This asks at full rate while anything is busy (see anim/activity.ts), and at
 * a trickle when nothing is — still enough for a seated figure's hands to move,
 * and for the room to feel alive rather than paused. Hidden, it asks for
 * nothing at all.
 *
 * It also decides when the shadow maps are redrawn. Shadows only change when
 * something moves; redrawing a 2048² sun map and a six-face lamp map for a
 * room that has not changed was most of what an idle frame cost.
 */

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { stageBusy, glancing, glanceMovesShadows } from "../anim/activity"
import { anyQueued } from "../anim/queue"
import { allPlacements } from "../anim/stage"

const lights: { sun?: THREE.DirectionalLight | null; lamp?: THREE.PointLight | null } = {}

/** ?debug counts rendered frames on window.__frames, for the headless checks. */
const DEBUG = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("debug")

/** Lighting hands over its shadow casters; from then on they update on demand. */
export function registerShadowLights(sun: THREE.DirectionalLight | null, lamp: THREE.PointLight | null): void {
  lights.sun = sun
  lights.lamp = lamp
  for (const l of [sun, lamp]) {
    if (!l) continue
    l.shadow.autoUpdate = false
    l.shadow.needsUpdate = true
  }
}

/** Beyond its `distance` a point light contributes nothing, so a figure
 *  further than that (plus its own width) cannot change the lamp's shadow. */
const LAMP_REACH = 5.2 + 0.6

function nearLamp(lamp: THREE.PointLight): boolean {
  for (const p of allPlacements().values()) {
    if (Math.hypot(p.x - lamp.position.x, p.z - lamp.position.z) < LAMP_REACH) return true
  }
  return false
}

/** Frame interval during a glance (activity.ts): about 30 fps. */
const GLANCE_INTERVAL = 30

/** Frame interval once nothing has moved for a while. */
function idleInterval(quietMs: number): number {
  if (quietMs < 1500)  return 0      // trailing frames: let everything settle
  if (quietMs < 8000)  return 33     // ~30 fps: a figure just sat down
  if (quietMs < 60000) return 80     // ~12 fps: breathing, writing hands
  return 250                         // ~4 fps: an empty afternoon
}

export function FrameDriver() {
  const invalidate = useThree(s => s.invalidate)
  const lastMove = useRef(performance.now())
  const frameNo = useRef(0)

  useEffect(() => {
    let raf = 0
    let last = 0
    let quietSince = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      if (stageBusy() || anyQueued()) {
        quietSince = now
        last = now
        invalidate()
        return
      }
      // A blink or a stretch: smooth while it lasts, without starting the
      // slow-down over. Thirty frames a second is plenty for a slow gesture,
      // and a figure idling all day fidgets a few hundred times.
      if (glancing()) {
        if (now - last >= GLANCE_INTERVAL) {
          last = now
          invalidate()
        }
        return
      }
      if (now - last >= idleInterval(now - quietSince)) {
        last = now
        invalidate()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [invalidate])

  useFrame(() => {
    const now = performance.now()
    if (DEBUG) (window as unknown as { __frames?: number }).__frames =
      ((window as unknown as { __frames?: number }).__frames ?? 0) + 1
    if (stageBusy() || anyQueued() || glanceMovesShadows()) lastMove.current = now
    // A short tail after the last movement, so the final position is in the
    // map whatever order this ran in relative to the actors this frame.
    const moving = now - lastMove.current < 300
    frameNo.current++

    if (lights.sun) lights.sun.shadow.needsUpdate = moving
    // Six faces per update: every other frame is plenty for figures walking
    // past a lamp, and none at all when nobody is within its reach.
    if (lights.lamp) {
      lights.lamp.shadow.needsUpdate = moving && frameNo.current % 2 === 0 && nearLamp(lights.lamp)
    }
  })

  return null
}
