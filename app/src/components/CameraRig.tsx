/**
 * CameraRig.tsx — the room's framing, and the glide to whatever you clicked.
 *
 * FitToViewport (Scene.tsx) works out the framing that holds the whole room;
 * this owns what the camera actually does with it. Click a figure and the view
 * glides in and keeps it in the middle while it walks about; click the
 * chalkboard and it comes in close enough to read it; click the floor (or press
 * Escape) and it glides back to the whole room.
 *
 * Only the glide itself touches the zoom. Once there, the wheel is yours again:
 * the rig follows a walking figure by moving the target, never by fighting a
 * zoom you chose.
 */

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { useStore, type Focus } from "../store"
import { placementOf } from "../anim/stage"
import { wake } from "../anim/activity"
import { SLATE_FOCUS } from "./Slate"

/** What FitToViewport last computed. */
export const fit = {
  zoom:   83,
  target: new THREE.Vector3(),
  ready:  false,
}

type Controls = { target: THREE.Vector3; update: () => void; maxZoom?: number }

const GLIDE_S       = 0.85
const AGENT_ZOOM    = 2.3
const AGENT_HEIGHT  = 1.0
/** The board should fill about this much of the window's shorter side: the
 *  first try, a multiple of the room's framing, left it a hand's width wide
 *  and the chalk unreadable. Its size in metres, with the frame. */
const BOARD_SHARE   = 0.55
const BOARD_SPAN    = 0.9

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function goal(focus: Focus, out: THREE.Vector3, view: { width: number; height: number }): number | null {
  if (!fit.ready) return null
  if (!focus) { out.copy(fit.target); return fit.zoom }
  if (focus.kind === "board") {
    out.set(...SLATE_FOCUS)
    return (Math.min(view.width, view.height) * BOARD_SHARE) / BOARD_SPAN
  }
  if (focus.kind === "point") {
    out.set(...focus.at)
    return fit.zoom * focus.zoom
  }
  const p = placementOf(focus.id)
  if (!p) return null
  out.set(p.x, AGENT_HEIGHT, p.z)
  return fit.zoom * AGENT_ZOOM
}

export function CameraRig() {
  const camera   = useThree(s => s.camera) as THREE.OrthographicCamera
  const controls = useThree(s => s.controls) as unknown as Controls | null
  const view     = useThree(s => s.size)
  const focus    = useStore(s => s.focus)

  const glide = useRef<{ fromT: THREE.Vector3; fromZ: number; t: number } | null>(null)
  const want  = useRef(new THREE.Vector3())

  useEffect(() => {
    if (!controls) return
    glide.current = { fromT: controls.target.clone(), fromZ: camera.zoom, t: 0 }
    wake((GLIDE_S + 0.3) * 1000)
  }, [focus, controls, camera])

  // Escape always brings the whole room back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.getState().setFocus(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useFrame((_, dt) => {
    if (!controls) return
    const zoom = goal(focus, want.current, view)
    if (zoom === null) {
      // The figure being followed has left the room.
      if (focus?.kind === "agent") useStore.getState().setFocus(null)
      return
    }
    const g = glide.current
    if (g) {
      g.t = Math.min(1, g.t + dt / GLIDE_S)
      const k = ease(g.t)
      controls.target.lerpVectors(g.fromT, want.current, k)
      camera.zoom = g.fromZ + (Math.min(zoom, controls.maxZoom ?? 900) - g.fromZ) * k
      camera.updateProjectionMatrix()
      controls.update()
      wake(120)
      if (g.t >= 1) glide.current = null
    } else if (focus?.kind === "agent") {
      // Keep a walking figure centred, softly.
      if (controls.target.distanceToSquared(want.current) > 1e-6) {
        controls.target.lerp(want.current, Math.min(1, dt * 5))
        controls.update()
      }
    }
  })

  return null
}
