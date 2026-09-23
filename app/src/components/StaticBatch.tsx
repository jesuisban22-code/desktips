/**
 * StaticBatch.tsx — weld the furniture into a handful of meshes.
 *
 * Measured before writing this: 911 meshes in the room, 704 of them casting
 * shadows. Every frame draws each one in the main pass, again for the sun's
 * shadow, again for up to six faces of the workbench lamp's cube shadow, and
 * again for the AO normal pass — about 4 000 draw calls to show a room in which
 * only the people move. The frame took 25 ms with the effects on and 21 ms
 * without: the cost was the calls, not the pixels.
 *
 * Nothing under this component moves after it mounts, so once it is built its
 * meshes are merged — in world space, one mesh per material and shadow
 * setting — and the originals are hidden. The furniture code keeps its
 * readable one-mesh-per-part structure; the GPU sees a few dozen batches.
 *
 * What is left alone:
 *  - anything under an object with `userData.dynamic` (the door leaf, the
 *    working drawer) — those are welded on their own, in their own frame,
 *    by useWeld below,
 *  - transparent materials (glass, light shafts): merged, their depth sorting
 *    would break,
 *  - meshes already hidden, instanced, skinned, or using several materials.
 */

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import * as THREE from "three"
import { useThree } from "@react-three/fiber"
import { mergeBufferGeometries } from "three-stdlib"
import { wake } from "../anim/activity"

interface Bucket {
  material: THREE.Material
  cast:     boolean
  receive:  boolean
  parts:    THREE.BufferGeometry[]
  sources:  THREE.Mesh[]
}

/** Geometries merge only with others of exactly the same layout. */
function layoutOf(g: THREE.BufferGeometry): string {
  const names = Object.keys(g.attributes).sort()
  const attrs = names.map(n => {
    const a = g.attributes[n] as THREE.BufferAttribute
    return `${n}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`
  })
  const morph = Object.keys(g.morphAttributes).length
  return `${attrs.join(",")}|i${g.index ? 1 : 0}|m${morph}`
}

function underDynamic(o: THREE.Object3D, stop: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== stop; p = p.parent) {
    if (p.userData?.dynamic) return true
  }
  return false
}

function visibleUpTo(o: THREE.Object3D, stop: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== stop; p = p.parent) {
    if (!p.visible) return false
  }
  return true
}


/**
 * Weld the static meshes under `root`: one merged mesh per material, shadow
 * setting and vertex layout, the originals hidden.
 *
 * World space, hung off `attach` (the scene) — or, `local`, in `root`'s own
 * frame and hung off `root` itself, so that a group which moves as one (the
 * door leaf, a drawer) carries its welded parts along with it.
 */
function weld(root: THREE.Object3D, attach: THREE.Object3D, local: boolean) {
  root.updateWorldMatrix(true, true)
  const toFrame = local ? root.matrixWorld.clone().invert() : new THREE.Matrix4()
  const placed = new THREE.Matrix4()

  const buckets = new Map<string, Bucket>()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return
    if (Array.isArray(m.material)) return
    const mat = m.material as THREE.Material
    if (mat.transparent || m.customDepthMaterial || m.customDistanceMaterial) return
    if (!visibleUpTo(m, root) || underDynamic(m, root)) return

    placed.multiplyMatrices(toFrame, m.matrixWorld)
    const mirrored = placed.determinant() < 0
    // Without an index there is no cheap way to flip the winding back.
    if (mirrored && !m.geometry.index) return

    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${layoutOf(m.geometry)}`
    let b = buckets.get(key)
    if (!b) {
      b = { material: mat, cast: m.castShadow, receive: m.receiveShadow, parts: [], sources: [] }
      buckets.set(key, b)
    }
    const part = m.geometry.clone()
    part.applyMatrix4(placed)
    // A mirrored transform flips the winding; merged, those faces would turn
    // inside out. Put them back.
    if (mirrored && part.index) {
      const idx = part.index.array as Uint16Array | Uint32Array
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t
      }
    }
    b.parts.push(part)
    b.sources.push(m)
  })

  const merged: THREE.Mesh[] = []
  const hidden: THREE.Mesh[] = []
  for (const b of buckets.values()) {
    if (b.parts.length < 2) { b.parts.forEach(p => p.dispose()); continue }
    const geo = mergeBufferGeometries(b.parts, false)
    b.parts.forEach(p => p.dispose())
    if (!geo) continue            // incompatible after all: leave the originals
    geo.computeBoundingSphere()
    const mesh = new THREE.Mesh(geo, b.material)
    mesh.castShadow = b.cast
    mesh.receiveShadow = b.receive
    // Identity: world space off the scene, or root's frame off root.
    mesh.matrixAutoUpdate = false
    mesh.name = "batch"
    merged.push(mesh)
    for (const s of b.sources) { s.visible = false; hidden.push(s) }
  }

  for (const m of merged) attach.add(m)
  wake(1500)

  return {
    batches: merged.length,
    welded: hidden.length,
    undo: () => {
      for (const m of merged) { attach.remove(m); m.geometry.dispose() }
      for (const s of hidden) s.visible = true
    },
  }
}

/** `?batch=0` turns every kind of welding off, to compare against. */
function batchingOn(): boolean {
  return typeof window === "undefined" || new URLSearchParams(window.location.search).get("batch") !== "0"
}

export function StaticBatch({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const scene = useThree(s => s.scene)

  useLayoutEffect(() => {
    const root = group.current
    if (!root || !enabled) return
    // World-space geometry, so the batches hang off the scene itself.
    const w = weld(root, scene, false)

    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")) {
      ;(window as unknown as { __batch?: unknown }).__batch = {
        batches: w.batches, merged: w.welded,
      }
    }
    return w.undo
  }, [scene, enabled])

  return <group ref={group}>{children}</group>
}

/**
 * The same for a group that moves as one: its parts are welded in its own
 * frame and stay its children, so they swing or slide with it. The door leaf
 * was 29 meshes and the working drawer 17 — each drawn in the main pass, the
 * transmission pass, the AO normal pass and the shadow maps. Call it from the
 * component that owns the ref, on a group marked `userData.dynamic` (which
 * keeps the room-wide StaticBatch off it).
 */
export function useWeld(ref: RefObject<THREE.Object3D | null>): void {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !batchingOn()) return
    return weld(root, root, true).undo
  }, [ref])
}
