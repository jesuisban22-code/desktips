/**
 * Dust.tsx — motes drifting in the sun coming through the back windows.
 *
 * The shafts were already there; nothing moved in them. A few hundred points,
 * seeded along each beam and drifting slowly, are what make them read as light
 * falling through air rather than as two pale wedges. The drift is computed in
 * the vertex shader from one time uniform, so it costs nothing on the CPU and
 * keeps going at whatever rate the room is being drawn — slow when the room is
 * idle, which suits dust.
 *
 * `level` comes from the time of day: none at night, full in the afternoon.
 */

import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { useFrame, useThree } from "@react-three/fiber"
import { rng } from "../three/kit"

/** The two back-wall windows that let the sun in (Room.tsx). */
const WINDOWS_X = [-4.20, -1.60]
const WINDOW_Y = 1.85
const WALL_Z = -5.84
/** Beam direction, from the shaft's tilt and yaw in Room.tsx. */
const DIR = new THREE.Vector3(Math.sin(0.16) * 0.788, -0.616, Math.cos(0.16) * 0.788).normalize()
/** Across the beam, in its vertical plane. */
const ACROSS = new THREE.Vector3(0, 0.788, 0.616).normalize()
const PER_WINDOW = 170

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uPixel;
  attribute float aPhase;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float ph = aPhase * 6.2831;
    p.x += sin(uTime * 0.11 + ph) * 0.07;
    p.y += sin(uTime * 0.08 + ph * 1.7) * 0.06;
    p.z += cos(uTime * 0.10 + ph * 2.3) * 0.06;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uPixel * (1.6 + 1.6 * fract(aPhase * 7.31));
    // Motes catch the light and lose it as they turn.
    vAlpha = uLevel * (0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * 0.6 + ph * 3.1)));
  }
`

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, vAlpha * smoothstep(0.5, 0.0, d));
  }
`

export function DustMotes({ level, color }: { level: number; color: THREE.Color }) {
  const dpr = useThree(s => s.viewport.dpr)

  const geometry = useMemo(() => {
    const r = rng(77)
    const pos: number[] = []
    const phase: number[] = []
    const p = new THREE.Vector3()
    for (const wx of WINDOWS_X) {
      for (let i = 0; i < PER_WINDOW; i++) {
        const s = 0.2 + r() * 3.1
        // The beam widens as it travels; so does the cloud in it.
        const spread = 0.35 + s * 0.12
        p.set(wx + (r() - 0.5) * 2 * spread * 1.2, WINDOW_Y, WALL_Z)
          .addScaledVector(DIR, s)
          .addScaledVector(ACROSS, (r() - 0.5) * 2 * spread)
        pos.push(p.x, p.y, p.z)
        phase.push(r())
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1))
    return g
  }, [])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime:  { value: 0 },
      uLevel: { value: 0 },
      uPixel: { value: 1 },
      uColor: { value: new THREE.Color("#fff1d6") },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame(() => {
    const u = material.uniforms
    u.uTime.value = performance.now() / 1000
    u.uLevel.value = level * 0.55
    u.uPixel.value = dpr
    ;(u.uColor.value as THREE.Color).copy(color).lerp(new THREE.Color("#ffffff"), 0.5)
  })

  if (level <= 0.01) return null
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={25} />
}
