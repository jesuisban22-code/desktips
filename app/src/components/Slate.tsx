/**
 * Slate.tsx — the chalkboard by the door: what you asked for, and how far along
 * it is.
 *
 * Everything else in the room says what the assistant is doing NOW. Nothing
 * said what it was doing it FOR. The board carries the last request, and under
 * it either the assistant's own task list (when it keeps one) or a tally of the
 * work done since the request: files read, files written, commands run.
 *
 * Measured on this machine before building it: requests are typed constantly,
 * task lists almost never (two TaskCreate calls in a hundred sessions). So the
 * request and the tally are the board's real content; the checklist is a bonus.
 *
 * At room scale the chalk is texture more than text — the board is a hand's
 * width on screen. Clicking it brings the camera in close enough to read, and
 * the brief panel in the HUD carries the same words at a legible size.
 */

import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import type { ThreeEvent } from "@react-three/fiber"
import { bevelPanel, chamfer } from "../three/kit"
import { M } from "../three/materials"
import { useStore, type Brief } from "../store"
import type { TodoItem } from "../types"
import { wake } from "../anim/activity"

/** On the left wall, between the pegboard and the door. */
export const SLATE_POS: [number, number, number] = [-5.885, 1.60, 2.88]
/** Where the camera looks when the board is clicked: just in front of it. */
export const SLATE_FOCUS: [number, number, number] = [-5.55, 1.58, 2.88]

const W = 0.86
const H = 0.62
const RAIL = 0.044

const TEX_W = 1024
const TEX_H = Math.round(TEX_W * (H - RAIL * 2) / (W - RAIL * 2))

const CHALK = "rgba(238, 232, 216, 0.93)"
const CHALK_FAINT = "rgba(238, 232, 216, 0.55)"
const CHALK_RED = "rgba(236, 160, 138, 0.92)"
const HAND = "'Ink Free', 'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive"

export function Slate() {
  const brief = useStore(s => s.brief)
  const todos = useStore(s => (s.brief ? s.todos[s.brief.source] : undefined) ?? firstList(s.todos))
  const setFocus = useStore(s => s.setFocus)

  const { canvas, texture, material } = useMemo(() => {
    const canvas = document.createElement("canvas")
    canvas.width = TEX_W
    canvas.height = TEX_H
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.93,
      // A touch of self-light on the chalk only: the board hangs by the door,
      // out of the sun, and grey-on-slate otherwise sinks into the wall.
      emissive: new THREE.Color("#ffffff"),
      emissiveMap: texture,
      emissiveIntensity: 0.16,
    })
    return { canvas, texture, material }
  }, [])

  useEffect(() => () => { texture.dispose(); material.dispose() }, [texture, material])

  // Redrawn when the request, the tally or the list changes — never per frame.
  const last = useRef("")
  useEffect(() => {
    const sig = JSON.stringify([brief?.text, brief?.tally, todos])
    if (sig === last.current) return
    last.current = sig
    drawBoard(canvas, brief, todos ?? [])
    texture.needsUpdate = true
    wake(300)
  }, [brief, todos, canvas, texture])

  const onOver = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = "pointer" }
  const onOut  = () => { document.body.style.cursor = "" }
  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); setFocus({ kind: "board" }) }

  const walnut = M.walnut()
  return (
    <group name="Slate" position={SLATE_POS} rotation={[0, Math.PI / 2, 0]}
           onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
      {/* frame */}
      {([1, -1] as const).map(s => (
        <mesh key={`h${s}`} geometry={bevelPanel(W, RAIL, 0.030, 0.005)} material={walnut}
              position={[0, s * (H / 2 - RAIL / 2), 0.012]} castShadow receiveShadow />
      ))}
      {([1, -1] as const).map(s => (
        <mesh key={`v${s}`} geometry={bevelPanel(RAIL, H - RAIL * 2, 0.030, 0.005)} material={walnut}
              position={[s * (W / 2 - RAIL / 2), 0, 0.012]} castShadow receiveShadow />
      ))}
      {/* the slate itself */}
      <mesh position={[0, 0, 0.004]} material={material} receiveShadow>
        <planeGeometry args={[W - RAIL * 2 + 0.004, H - RAIL * 2 + 0.004]} />
      </mesh>
      <mesh geometry={chamfer(W - 0.02, H - 0.02, 0.008, 0.002)} material={M.slate()}
            position={[0, 0, -0.002]} />
      {/* chalk ledge, and a stub of chalk on it */}
      <mesh geometry={chamfer(W * 0.92, 0.016, 0.052, 0.004)} material={walnut}
            position={[0, -H / 2 - 0.004, 0.030]} castShadow receiveShadow />
      <mesh geometry={chamfer(0.062, 0.012, 0.012, 0.004)} material={M.chalk()}
            position={[W * 0.26, -H / 2 + 0.010, 0.040]} rotation={[0, 0.3, 0]} castShadow />
    </group>
  )
}

function firstList(todos: Record<string, TodoItem[]>): TodoItem[] | undefined {
  return Object.values(todos).find(l => l.length > 0)
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Slate with smudges of old chalk: generated once, reused for every redraw. */
let ground: HTMLCanvasElement | null = null
function slateGround(): HTMLCanvasElement {
  if (ground) return ground
  const c = document.createElement("canvas")
  c.width = TEX_W
  c.height = TEX_H
  const g = c.getContext("2d")!
  g.fillStyle = "#2c3634"
  g.fillRect(0, 0, TEX_W, TEX_H)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  // Wiped-off chalk: broad, faint, in the direction a hand wipes.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * TEX_W, y = rnd() * TEX_H
    const grd = g.createRadialGradient(x, y, 0, x, y, 60 + rnd() * 170)
    grd.addColorStop(0, `rgba(210,215,205,${0.025 + rnd() * 0.04})`)
    grd.addColorStop(1, "rgba(210,215,205,0)")
    g.fillStyle = grd
    g.save()
    g.translate(x, y); g.scale(1.9, 0.7); g.translate(-x, -y)
    g.fillRect(0, 0, TEX_W, TEX_H)
    g.restore()
  }
  // Grain.
  const img = g.getImageData(0, 0, TEX_W, TEX_H)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 10
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
  }
  g.putImageData(img, 0, 0)
  ground = c
  return c
}

/** Chalk is never solid: knock random specks out of whatever was just drawn. */
function chalkify(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.save()
  g.globalCompositeOperation = "destination-out"
  g.fillStyle = "rgba(0,0,0,0.55)"
  const n = Math.round((w * h) / 90)
  for (let i = 0; i < n; i++) {
    g.fillRect(x + Math.random() * w, y + Math.random() * h, 1.6, 1.6)
  }
  g.restore()
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (g.measureText(next).width <= width) { line = next; continue }
    if (line) lines.push(line)
    line = w
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && line) lines.push(line)
  const used = lines.join(" ").length
  if (used < text.length && lines.length) {
    let l = lines[lines.length - 1]
    while (l.length && g.measureText(l + "…").width > width) l = l.slice(0, -1)
    lines[lines.length - 1] = l + "…"
  }
  return lines
}

function drawBoard(canvas: HTMLCanvasElement, brief: Brief | null, todos: TodoItem[]) {
  const g = canvas.getContext("2d")!
  // Text goes on its own layer first, so chalkify only eats chalk.
  const ink = document.createElement("canvas")
  ink.width = TEX_W
  ink.height = TEX_H
  const c = ink.getContext("2d")!
  c.textBaseline = "alphabetic"
  const left = 60
  const width = TEX_W - left * 2

  if (!brief) {
    c.fillStyle = CHALK_FAINT
    c.font = `48px ${HAND}`
    c.textAlign = "center"
    c.fillText("Pas encore de demande", TEX_W / 2, TEX_H / 2)
  } else {
    // Heading, underlined with a stroke that is not quite straight.
    c.fillStyle = CHALK
    c.font = `600 50px ${HAND}`
    c.fillText("La demande", left, 92)
    c.strokeStyle = CHALK
    c.lineWidth = 3.2
    c.beginPath()
    c.moveTo(left, 108); c.quadraticCurveTo(left + 150, 102, left + 300, 110)
    c.stroke()

    c.font = `40px ${HAND}`
    let y = 172
    for (const line of wrap(c, `« ${brief.text} »`, width, 4)) {
      c.fillText(line, left, y)
      y += 52
    }

    y += 14
    c.strokeStyle = CHALK_FAINT
    c.lineWidth = 2
    c.beginPath(); c.moveTo(left, y); c.lineTo(TEX_W - left, y + 3); c.stroke()
    y += 62

    if (todos.length > 0) {
      const done = todos.filter(t => t.status === "completed").length
      c.font = `600 40px ${HAND}`
      c.fillText(`Tâches ${done}/${todos.length}`, left, y)
      y += 56
      c.font = `36px ${HAND}`
      const shown = todos.filter(t => t.status !== "deleted").slice(0, 4)
      for (const t of shown) {
        const mark = t.status === "completed" ? "☑" : t.status === "in_progress" ? "➜" : "☐"
        c.fillStyle = t.status === "completed" ? CHALK_FAINT : CHALK
        const [line] = wrap(c, t.text, width - 60, 1)
        c.fillText(`${mark}  ${line ?? ""}`, left, y)
        y += 48
      }
    } else {
      const t = brief.tally
      const parts = [
        t.read  && `${t.read} lu${t.read > 1 ? "s" : ""}`,
        t.write && `${t.write} écrit${t.write > 1 ? "s" : ""}`,
        t.run   && `${t.run} commande${t.run > 1 ? "s" : ""}`,
        t.web   && `${t.web} recherche${t.web > 1 ? "s" : ""}`,
      ].filter(Boolean) as string[]
      c.font = `40px ${HAND}`
      c.fillStyle = CHALK
      c.fillText(parts.length ? parts.join("  ·  ") : "on s'y met…", left, y)
      if (t.errors > 0) {
        y += 56
        c.fillStyle = CHALK_RED
        c.fillText(`${t.errors} échec${t.errors > 1 ? "s" : ""}`, left, y)
      }
    }
  }
  chalkify(c, 0, 0, TEX_W, TEX_H)

  g.clearRect(0, 0, TEX_W, TEX_H)
  g.drawImage(slateGround(), 0, 0)
  g.drawImage(ink, 0, 0)
}
