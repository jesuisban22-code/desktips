/**
 * Workshop.tsx — the room keeping a record of the work.
 *
 *   Terminal       on the bench: the last commands typed there, in phosphor
 *                  green, with a cursor that blinks while it waits
 *   DraftingSheet  pinned to the board: a drawing that gains a few lines with
 *                  every edit; on a new request it goes on the pile beside it
 *   SignalLamp     over the door: red for a moment when something fails,
 *                  amber while the person is being waited on
 *   WallClock      on the back wall: the real time, which is also the time of
 *                  day the light in the room follows
 *   MugSteam       off the mug DeskClutter leaves on the main desk
 *
 * All of them read anim/workshop.ts (written as the figures PLAY their beats)
 * and redraw their textures only when its version moves. Their housings are
 * welded with the furniture (Scene.tsx puts them inside StaticBatch): what
 * changes is either a texture or colour on a material of its own, or marked
 * `userData.dynamic` (the clock's hands, the pile of sheets).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { mergeBufferGeometries } from "three-stdlib"
import { chamfer, rng } from "../three/kit"
import { M } from "../three/materials"
import { BENCH_TOP_Y, DRAFTING_BOARD } from "./Furniture"
import { workshop } from "../anim/workshop"
import { wake } from "../anim/activity"
import { useStore } from "../store"

// ── Shared helpers ───────────────────────────────────────────────────────────

function canvasTexture(w: number, h: number): [HTMLCanvasElement, THREE.CanvasTexture] {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return [c, t]
}

/** A soft round spot, for glows and steam. */
let softDot: THREE.CanvasTexture | null = null
function softDotTexture(): THREE.CanvasTexture {
  if (softDot) return softDot
  const [c, t] = canvasTexture(128, 128)
  const g = c.getContext("2d")!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, "rgba(255,255,255,1)")
  grd.addColorStop(0.35, "rgba(255,255,255,0.45)")
  grd.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  t.needsUpdate = true
  softDot = t
  return t
}

// ═══════════════════════════════════════════════════════════════════════════
// Terminal
// ═══════════════════════════════════════════════════════════════════════════

const TERM_W = 512
const TERM_H = 380

function drawTerminal(c: HTMLCanvasElement, lines: string[], cursorOn: boolean): void {
  const g = c.getContext("2d")!
  const bg = g.createRadialGradient(TERM_W / 2, TERM_H / 2, 30, TERM_W / 2, TERM_H / 2, TERM_W * 0.72)
  bg.addColorStop(0, "#0d3316")
  bg.addColorStop(1, "#020b04")
  g.fillStyle = bg
  g.fillRect(0, 0, TERM_W, TERM_H)

  // Large on purpose: the whole screen is a hand's width even in close-up,
  // and 22 px text on it was a green smudge.
  const pad = 26
  const lh = 46
  g.font = "700 31px 'Cascadia Mono', Consolas, 'Courier New', monospace"
  g.textBaseline = "top"
  g.shadowColor = "rgba(90,255,140,0.75)"
  g.shadowBlur = 9

  const shown = lines.length ? lines : ["bureau: prêt."]
  const max = Math.floor((TERM_H - pad * 2) / lh) - 1
  const tail = shown.slice(-max)
  let y = pad
  tail.forEach((raw, i) => {
    let s = raw
    while (s.length > 1 && g.measureText(s).width > TERM_W - pad * 2) s = s.slice(0, -1)
    if (s !== raw) s = s.slice(0, -1) + "…"
    // Older lines dim, the way an eye reads a scrolling screen.
    const age = tail.length - 1 - i
    g.fillStyle = age === 0 ? "#b8ffcc" : `rgba(128,255,164,${Math.max(0.35, 0.85 - age * 0.09)})`
    g.fillText(s, pad, y)
    y += lh
  })
  // The cursor waits on the line after the last command.
  if (cursorOn) {
    g.fillStyle = "#b8ffcc"
    g.fillRect(pad, y + 2, 13, 24)
  }
  g.shadowBlur = 0

  // Scanlines and a darker rim: a tube, not a flat panel.
  g.fillStyle = "rgba(0,0,0,0.24)"
  for (let sy = 0; sy < TERM_H; sy += 3) g.fillRect(0, sy, TERM_W, 1)
  const rim = g.createRadialGradient(TERM_W / 2, TERM_H / 2, TERM_H * 0.45, TERM_W / 2, TERM_H / 2, TERM_W * 0.66)
  rim.addColorStop(0, "rgba(0,0,0,0)")
  rim.addColorStop(1, "rgba(0,0,0,0.55)")
  g.fillStyle = rim
  g.fillRect(0, 0, TERM_W, TERM_H)
}

/** Placed in the workbench's own frame: its front (+z) faces the room. */
export function Terminal({ position, rotation }: {
  position: [number, number, number]; rotation: [number, number, number]
}) {
  const { canvas, texture, screen } = useMemo(() => {
    const [canvas, texture] = canvasTexture(TERM_W, TERM_H)
    const screen = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    return { canvas, texture, screen }
  }, [])
  useEffect(() => () => { texture.dispose(); screen.dispose() }, [texture, screen])
  const body = M.crt(), dark = M.crtTrim(), keys = M.keycaps()

  const seen = useRef({ version: -1, cursor: false })
  useFrame(() => {
    const cursor = Math.floor(performance.now() / 530) % 2 === 0
    const s = seen.current
    if (s.version === workshop.version && s.cursor === cursor) return
    s.version = workshop.version
    s.cursor = cursor
    drawTerminal(canvas, workshop.commands, cursor)
    texture.needsUpdate = true
  })

  return (
    <group name="Terminal" position={position} rotation={rotation}>
      {/* the local frame: bench top at y = 0, screen facing +z */}
      <group position={[-0.20, BENCH_TOP_Y, -0.13]}>
        {/* swivel foot */}
        <mesh geometry={chamfer(0.20, 0.028, 0.18, 0.008)} material={dark} position={[0, 0.014, 0]} castShadow receiveShadow />
        {/* the tube's housing, deep at the back */}
        <mesh geometry={chamfer(0.30, 0.25, 0.24, 0.030)} material={body} position={[0, 0.170, -0.045]} castShadow receiveShadow />
        {/* bezel */}
        <mesh geometry={chamfer(0.360, 0.300, 0.060, 0.022)} material={body} position={[0, 0.176, 0.090]} castShadow receiveShadow />
        <mesh geometry={chamfer(0.300, 0.228, 0.012, 0.010)} material={dark} position={[0, 0.184, 0.118]} />
        {/* the glass */}
        <mesh position={[0, 0.184, 0.1250]} material={screen}>
          <planeGeometry args={[0.272, 0.202]} />
        </mesh>
        {/* power light */}
        <mesh geometry={chamfer(0.012, 0.006, 0.004, 0.002)} material={M.status("#62ff8a", 1.2)} position={[0.140, 0.044, 0.121]} />
        {/* keyboard */}
        <group position={[0, 0, 0.300]} rotation={[0.06, 0, 0]}>
          <mesh geometry={chamfer(0.340, 0.026, 0.130, 0.008)} material={body} position={[0, 0.013, 0]} castShadow receiveShadow />
          <mesh geometry={chamfer(0.306, 0.012, 0.094, 0.004)} material={keys} position={[0, 0.030, -0.004]} />
        </group>
      </group>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Drafting sheet
// ═══════════════════════════════════════════════════════════════════════════

const SHEET_W = 0.90
const SHEET_H = 0.62
const PX_W = 1024
const PX_H = Math.round(PX_W * SHEET_H / SHEET_W)

type Stroke = (g: CanvasRenderingContext2D) => void

/**
 * The drawing, as the ordered list of strokes a draughtsman would make: frame
 * and title block first, then the plan's outline, the partitions, openings,
 * dimensions, hatching and labels. Seeded by the sheet's number, so every
 * request gets a different building.
 */
function composeDrawing(seed: number): Stroke[] {
  const r = rng(seed * 7919 + 17)
  const rr = (a: number, b: number) => a + (b - a) * r()
  const out: Stroke[] = []
  const line = (x0: number, y0: number, x1: number, y1: number, w = 2.2): Stroke => g => {
    g.lineWidth = w
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
    // A second, slightly offset pass: a hand-drawn line is never one line.
    g.globalAlpha = 0.35
    g.beginPath(); g.moveTo(x0 + 0.8, y0 + 0.6); g.lineTo(x1 + 0.6, y1 - 0.5); g.stroke()
    g.globalAlpha = 1
  }
  const M0 = 36
  // frame, title block
  out.push(g => { g.lineWidth = 2.6; g.strokeRect(M0, M0, PX_W - M0 * 2, PX_H - M0 * 2) })
  const tbx = PX_W - M0 - 260, tby = PX_H - M0 - 90
  out.push(g => { g.lineWidth = 2; g.strokeRect(tbx, tby, 260, 90) })
  out.push(line(tbx, tby + 40, tbx + 260, tby + 40, 1.6))
  out.push(line(tbx + 150, tby + 40, tbx + 150, tby + 90, 1.6))

  // the plan's outline
  const px = rr(90, 150), py = rr(80, 120)
  const pw = rr(520, 600), ph = rr(330, 380)
  out.push(line(px, py, px + pw, py, 3.4))
  out.push(line(px + pw, py, px + pw, py + ph, 3.4))
  out.push(line(px + pw, py + ph, px, py + ph, 3.4))
  out.push(line(px, py + ph, px, py, 3.4))

  // partitions
  const vx = px + pw * rr(0.38, 0.55)
  const hy = py + ph * rr(0.45, 0.6)
  const vx2 = px + pw * rr(0.72, 0.84)
  out.push(line(vx, py, vx, py + ph, 2.6))
  out.push(line(px, hy, vx, hy, 2.6))
  out.push(line(vx2, py, vx2, hy + 30, 2.6))
  out.push(line(vx, hy + 30, px + pw, hy + 30, 2.6))

  // doors: a leaf and its swing
  const doors: Array<[number, number, number, number]> = [
    [vx, py + ph * 0.18, 1, 0], [px + pw * 0.2, hy, 0, 1], [vx2, py + 40, -1, 0], [px + pw * 0.62, hy + 30, 0, -1],
  ]
  for (const [dx, dy, sx, sy] of doors) {
    const L = 48
    out.push(line(dx, dy, dx + (sx ? sx * L : L), dy + (sy ? sy * L : 0), 1.8))
    out.push(g => {
      g.lineWidth = 1.3
      g.setLineDash([5, 4])
      g.beginPath()
      g.arc(dx, dy, L, sy ? 0 : (sx > 0 ? -Math.PI / 2 : Math.PI), sy ? (sy > 0 ? Math.PI / 2 : -Math.PI / 2) : (sx > 0 ? 0 : Math.PI * 1.5))
      g.stroke()
      g.setLineDash([])
    })
  }

  // windows on the outline: short double lines
  for (let i = 0; i < 4; i++) {
    const wx = px + pw * (0.12 + i * 0.22)
    out.push(g => {
      g.lineWidth = 1.4
      g.strokeRect(wx, py - 5, 46, 10)
    })
  }

  // columns
  for (let i = 0; i < 3; i++) {
    const cx = px + pw * rr(0.15, 0.85), cy = py + ph * rr(0.2, 0.85)
    out.push(g => { g.lineWidth = 1.6; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke() })
  }

  // dimension lines with ticks and figures
  const dim = (x0: number, y0: number, x1: number, y1: number, label: string): Stroke => g => {
    g.lineWidth = 1.1
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
    const tick = (x: number, y: number) => { g.beginPath(); g.moveTo(x - 6, y + 6); g.lineTo(x + 6, y - 6); g.stroke() }
    tick(x0, y0); tick(x1, y1)
    g.font = "15px 'Ink Free', 'Segoe Print', cursive"
    g.fillText(label, (x0 + x1) / 2 - 14, (y0 + y1) / 2 - 8)
  }
  out.push(dim(px, py + ph + 34, px + pw, py + ph + 34, `${(pw / 50).toFixed(1)} m`))
  out.push(dim(px - 34, py, px - 34, py + ph, `${(ph / 50).toFixed(1)}`))
  out.push(dim(px, py - 30, vx, py - 30, `${((vx - px) / 50).toFixed(1)}`))
  out.push(dim(vx2, py + ph + 60, px + pw, py + ph + 60, `${((px + pw - vx2) / 50).toFixed(1)}`))

  // hatching in one room
  const hx0 = vx + 8, hx1 = vx2 - 8, hy0 = py + 8, hy1 = hy + 22
  for (let k = 0; k < 12; k++) {
    const t = (k + 1) / 13
    out.push(g => {
      g.save()
      g.beginPath(); g.rect(hx0, hy0, hx1 - hx0, hy1 - hy0); g.clip()
      g.lineWidth = 0.9
      const x = hx0 + (hx1 - hx0 + (hy1 - hy0)) * t
      g.beginPath(); g.moveTo(x, hy0); g.lineTo(x - (hy1 - hy0), hy1); g.stroke()
      g.restore()
    })
  }

  // labels
  const names = ["atelier", "bureau", "archives", "cour", "réserve", "salle"]
  const pick = () => names[Math.floor(r() * names.length)]
  const spots: Array<[number, number]> = [
    [px + (vx - px) * 0.35, py + (hy - py) * 0.5],
    [px + (vx - px) * 0.35, hy + (py + ph - hy) * 0.55],
    [vx + (px + pw - vx) * 0.3, hy + 30 + (py + ph - hy - 30) * 0.55],
  ]
  for (const [lx, ly] of spots) {
    const word = pick()
    out.push(g => { g.font = "20px 'Ink Free', 'Segoe Print', cursive"; g.fillText(word, lx, ly) })
  }

  // title
  out.push(g => {
    g.font = "22px 'Ink Free', 'Segoe Print', cursive"
    g.fillText(`plan n° ${seed}`, tbx + 14, tby + 12)
    g.font = "15px 'Ink Free', 'Segoe Print', cursive"
    g.fillText("éch. 1:50", tbx + 14, tby + 56)
    g.fillText("Bureau", tbx + 166, tby + 56)
  })

  // a small elevation in the margin: whatever strokes remain go here
  const ex = PX_W - M0 - 250, ey = M0 + 40
  out.push(line(ex, ey + 120, ex + 220, ey + 120, 2.2))
  out.push(line(ex + 20, ey + 120, ex + 20, ey + 40, 2))
  out.push(line(ex + 200, ey + 120, ex + 200, ey + 40, 2))
  out.push(line(ex + 10, ey + 44, ex + 110, ey, 2))
  out.push(line(ex + 110, ey, ex + 210, ey + 44, 2))
  out.push(g => { g.lineWidth = 1.4; g.strokeRect(ex + 90, ey + 76, 40, 44) })
  out.push(g => { g.lineWidth = 1.2; g.strokeRect(ex + 40, ey + 62, 30, 26); g.strokeRect(ex + 150, ey + 62, 30, 26) })
  return out
}

function drawSheet(c: HTMLCanvasElement, seed: number, strokes: number): void {
  const g = c.getContext("2d")!
  g.fillStyle = "#f2ebd9"
  g.fillRect(0, 0, PX_W, PX_H)
  // a faint grain, and the tape holding the corners down
  const r = rng(seed * 31 + 5)
  g.fillStyle = "rgba(120,100,70,0.035)"
  for (let i = 0; i < 1400; i++) g.fillRect(r() * PX_W, r() * PX_H, 2, 2)
  g.fillStyle = "rgba(214,196,150,0.9)"
  for (const [x, y, a] of [[18, 18, -0.6], [PX_W - 18, 18, 0.6], [18, PX_H - 18, 0.6], [PX_W - 18, PX_H - 18, -0.6]] as const) {
    g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-34, -11, 68, 22); g.restore()
  }
  g.strokeStyle = "rgba(38,42,50,0.86)"
  g.fillStyle = "rgba(38,42,50,0.86)"
  g.lineCap = "round"
  const all = composeDrawing(seed)
  for (let i = 0; i < Math.min(strokes, all.length); i++) all[i](g)
}

/** In the drafting table's frame (same position and rotation as the table). */
export function DraftingSheet({ position, rotation }: {
  position: [number, number, number]; rotation: [number, number, number]
}) {
  const { canvas, texture, paper } = useMemo(() => {
    const [canvas, texture] = canvasTexture(PX_W, PX_H)
    const paper = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92 })
    return { canvas, texture, paper }
  }, [])
  useEffect(() => () => { texture.dispose(); paper.dispose() }, [texture, paper])

  const [sheets, setSheets] = useState(workshop.sheets)
  const seen = useRef(-1)
  useFrame(() => {
    if (seen.current === workshop.version) return
    seen.current = workshop.version
    drawSheet(canvas, workshop.sheetNo, workshop.strokes)
    texture.needsUpdate = true
    if (workshop.sheets !== sheets) setSheets(workshop.sheets)
  })

  const B = DRAFTING_BOARD
  return (
    <group position={position} rotation={rotation}>
      <group position={[0, B.pivotY, B.pivotZ]} rotation={[B.tilt, 0, 0]}>
        <mesh position={[0, B.topY + 0.0015, B.centerZ - 0.02]} rotation={[-Math.PI / 2, 0, 0]} material={paper} receiveShadow>
          <planeGeometry args={[SHEET_W, SHEET_H]} />
        </mesh>
      </group>
      <SheetPile count={sheets} />
    </group>
  )
}

/**
 * Finished drawings, on the floor at the table's left end. Welded into one
 * mesh per paper tone whenever the count changes: a tall pile is still two
 * draw calls, not twenty-four.
 */
function SheetPile({ count }: { count: number }) {
  const shown = Math.min(count, 24)
  const geos = useMemo(() => {
    if (shown === 0) return null
    const r = rng(1234)
    const fresh: THREE.BufferGeometry[] = []
    const aged: THREE.BufferGeometry[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (let i = 0; i < shown; i++) {
      const rot = (r() - 0.5) * 0.18, dx = (r() - 0.5) * 0.03, dz = (r() - 0.5) * 0.03
      const g = chamfer(0.62, 0.003, 0.44, 0.001).clone()
      // On the planks, whose top is 18 mm up — not on the floor's datum.
      m.compose(new THREE.Vector3(dx, 0.0196 + i * 0.0042, dz),
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1))
      g.applyMatrix4(m)
      ;(r() < 0.4 ? aged : fresh).push(g)
    }
    const merge = (list: THREE.BufferGeometry[]) => {
      if (list.length === 0) return null
      const out = mergeBufferGeometries(list, false)
      list.forEach(g => g.dispose())
      return out
    }
    return { fresh: merge(fresh), aged: merge(aged) }
  }, [shown])
  useEffect(() => () => { geos?.fresh?.dispose(); geos?.aged?.dispose() }, [geos])

  if (!geos) return null
  return (
    // Rebuilt whenever the count changes: never part of the static weld.
    <group position={[-0.92, 0, 0.04]} userData={{ dynamic: true }}>
      {geos.fresh && <mesh geometry={geos.fresh} material={M.paper()} castShadow receiveShadow />}
      {geos.aged && <mesh geometry={geos.aged} material={M.paperAged()} castShadow receiveShadow />}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Signal lamp
// ═══════════════════════════════════════════════════════════════════════════

const RED = new THREE.Color("#ff3b24")
const AMBER = new THREE.Color("#ffb13b")
const OFF = new THREE.Color("#3a1410")

/** How long a failure keeps the lamp red, in seconds. */
const ERROR_S = 8

export function SignalLamp({ position, rotation }: {
  position: [number, number, number]; rotation: [number, number, number]
}) {
  const waiting = useStore(s => {
    for (const a of s.agents.values()) if (a.attention && a.attention.reason !== "idle") return true
    return false
  })
  const { dome, glow } = useMemo(() => ({
    dome: new THREE.MeshStandardMaterial({
      color: "#5a1a14", roughness: 0.25, emissive: OFF.clone(), emissiveIntensity: 1, toneMapped: false,
    }),
    glow: new THREE.MeshBasicMaterial({
      map: softDotTexture(), color: RED.clone(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  }), [])
  useEffect(() => () => { dome.dispose(); glow.dispose() }, [dome, glow])
  useEffect(() => { wake(600) }, [waiting])

  useFrame(() => {
    const age = (performance.now() - workshop.errorAt) / 1000
    let color = OFF, level = 0
    if (age < ERROR_S) {
      // Urgent pulses for three seconds, then a fading glow.
      const pulse = age < 3 ? 0.55 + 0.45 * Math.abs(Math.sin(age * Math.PI * 1.6)) : 1 - (age - 3) / (ERROR_S - 3)
      color = RED
      level = Math.max(0, pulse)
      wake(120)
    } else if (waiting) {
      color = AMBER
      level = 0.55 + 0.35 * Math.sin(performance.now() / 1000 * 2.4)
    }
    if (level > 0) {
      dome.emissive.copy(color).multiplyScalar(0.25 + level * 1.6)
      glow.color.copy(color)
      glow.opacity = level * 0.8
    } else {
      dome.emissive.copy(OFF)
      glow.opacity = 0
    }
  })

  return (
    <group name="SignalLamp" position={position} rotation={rotation}>
      {/* the glow it throws on the plaster */}
      <mesh position={[0, 0, 0.004]} material={glow} renderOrder={30}>
        <planeGeometry args={[1.0, 1.0]} />
      </mesh>
      <mesh geometry={chamfer(0.110, 0.110, 0.022, 0.006)} material={M.iron()} position={[0, 0, 0.011]} castShadow />
      <mesh geometry={chamfer(0.070, 0.030, 0.050, 0.006)} material={M.iron()} position={[0, 0.042, 0.040]} castShadow />
      <mesh position={[0, 0, 0.032]} rotation={[Math.PI / 2, 0, 0]} material={dome}>
        <sphereGeometry args={[0.040, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* the cage over the glass */}
      {[-1, 0, 1].map(k => (
        <mesh key={k} geometry={chamfer(0.004, 0.090, 0.004, 0.0015)} material={M.iron()}
              position={[k * 0.026, 0, 0.066 - Math.abs(k) * 0.012]} />
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Wall clock
// ═══════════════════════════════════════════════════════════════════════════

function drawClockFace(c: HTMLCanvasElement): void {
  const g = c.getContext("2d")!
  const S = c.width, R = S / 2
  g.fillStyle = "#efe6d0"
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill()
  g.strokeStyle = "#2a241c"
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const long = i % 5 === 0
    g.lineWidth = long ? 7 : 2.5
    const r0 = R * (long ? 0.80 : 0.86), r1 = R * 0.93
    g.beginPath()
    g.moveTo(R + Math.sin(a) * r0, R - Math.cos(a) * r0)
    g.lineTo(R + Math.sin(a) * r1, R - Math.cos(a) * r1)
    g.stroke()
  }
  g.fillStyle = "#2a241c"
  g.font = `${Math.round(S * 0.11)}px Georgia, 'Times New Roman', serif`
  g.textAlign = "center"
  g.textBaseline = "middle"
  for (const [n, a] of [[12, 0], [3, 0.25], [6, 0.5], [9, 0.75]] as const) {
    const ang = a * Math.PI * 2
    g.fillText(String(n), R + Math.sin(ang) * R * 0.64, R - Math.cos(ang) * R * 0.64)
  }
  g.font = `italic ${Math.round(S * 0.045)}px Georgia, serif`
  g.fillStyle = "#6b5f4c"
  g.fillText("Bureau", R, R + R * 0.34)
}

export function WallClock({ position, size = 0.40 }: { position: [number, number, number]; size?: number }) {
  const face = useMemo(() => {
    const [c, t] = canvasTexture(512, 512)
    drawClockFace(c)
    t.needsUpdate = true
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })
  }, [])
  useEffect(() => () => { face.map?.dispose(); face.dispose() }, [face])

  const hour = useRef<THREE.Group>(null)
  const minute = useRef<THREE.Group>(null)
  const second = useRef<THREE.Group>(null)
  useFrame(() => {
    const d = new Date()
    const s = d.getSeconds() + d.getMilliseconds() / 1000
    const m = d.getMinutes() + s / 60
    const h = (d.getHours() % 12) + m / 60
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2
    // Ticks, like a real movement, rather than sweeping.
    if (second.current) second.current.rotation.z = -(Math.floor(s) / 60) * Math.PI * 2
  })

  const R = size / 2
  return (
    <group name="WallClock" position={position}>
      {/* rim */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.018]} material={M.walnut()} castShadow>
        <cylinderGeometry args={[R + 0.022, R + 0.022, 0.036, 40]} />
      </mesh>
      <mesh position={[0, 0, 0.0365]} material={face}>
        <circleGeometry args={[R, 48]} />
      </mesh>
      {/* hands pivot at the centre; their length points up at 12 */}
      <group ref={hour} userData={{ dynamic: true }} position={[0, 0, 0.040]}>
        <mesh geometry={chamfer(0.016, R * 0.55, 0.004, 0.002)} material={M.iron()} position={[0, R * 0.22, 0]} />
      </group>
      <group ref={minute} userData={{ dynamic: true }} position={[0, 0, 0.045]}>
        <mesh geometry={chamfer(0.010, R * 0.82, 0.004, 0.002)} material={M.iron()} position={[0, R * 0.36, 0]} />
      </group>
      <group ref={second} userData={{ dynamic: true }} position={[0, 0, 0.049]}>
        <mesh geometry={chamfer(0.004, R * 0.92, 0.003, 0.001)} material={M.status("#b8322a", 0.2)} position={[0, R * 0.36, 0]} />
      </group>
      <mesh position={[0, 0, 0.052]} rotation={[Math.PI / 2, 0, 0]} material={M.brass()}>
        <cylinderGeometry args={[0.012, 0.012, 0.008, 12]} />
      </mesh>
      {/* glass: a faint sheen only. The windows' refracting glass would add
          nothing at this size and cost a transmission pass of its own. */}
      <mesh position={[0, 0, 0.058]} material={M.clockGlass()}>
        <circleGeometry args={[R + 0.004, 40]} />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Steam off the mug on the main desk
// ═══════════════════════════════════════════════════════════════════════════

/** Placed on the mug DeskClutter already puts on the main desk. */
export function MugSteam({ position }: { position: [number, number, number] }) {
  const puffs = useRef<THREE.Sprite[]>([])
  const material = useMemo(() => new THREE.SpriteMaterial({
    map: softDotTexture(), color: "#f4efe6", transparent: true, opacity: 0.18, depthWrite: false,
  }), [])
  const mats = useMemo(() => [0, 1, 2].map(() => material.clone()), [material])
  useEffect(() => () => { material.dispose(); mats.forEach(m => m.dispose()) }, [material, mats])

  useFrame(() => {
    const t = performance.now() / 1000
    puffs.current.forEach((p, i) => {
      if (!p) return
      const phase = (t * 0.28 + i / 3) % 1
      p.position.set(Math.sin(phase * 5 + i) * 0.012, 0.09 + phase * 0.20, Math.cos(phase * 4 + i * 2) * 0.008)
      const s = 0.035 + phase * 0.07
      p.scale.set(s, s, s)
      ;(p.material as THREE.SpriteMaterial).opacity = Math.sin(phase * Math.PI) * 0.16
    })
  })

  return (
    <group position={position}>
      {mats.map((m, i) => (
        <sprite key={i} ref={el => { if (el) puffs.current[i] = el }} material={m} renderOrder={31} />
      ))}
    </group>
  )
}
