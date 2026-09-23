/**
 * AgentLayer.tsx — turns the agent store into bodies moving around the room.
 *
 * Each agent gets an actor (see anim/useActor.ts) that owns its position and
 * every joint. This component's only job is to mount the right meshes and hand
 * the actor its handles; it deliberately does NOT re-render on animation,
 * because animation runs entirely in useFrame.
 */

import { useRef, useMemo, useEffect } from "react"
import * as THREE from "three"
import { Html } from "@react-three/drei"
import type { ThreeEvent } from "@react-three/fiber"
import { Character, StatusHalo, type Accessory } from "./Character"
import { useStore } from "../store"
import { AgentState, AgentStatus, Attention } from "../types"
import { PAL } from "../three/palette"
import { chamfer } from "../three/kit"
import { M } from "../three/materials"
import { useActor } from "../anim/useActor"
import { queueFor } from "../anim/queue"
import { StationId } from "../anim/stations"
import { assistantFor, shirtFor } from "../anim/assistants"
import { entranceScript, exitScript, SUB_IDLE_EXIT_MS } from "../anim/chores"
import { DOOR_OUTSIDE } from "../anim/stage"
import { wake } from "../anim/activity"
import { INK } from "../ui/ink"

// ── Where each agent lives when it has nothing to do ─────────────────────────

const HOMES: StationId[] = ["desk", "drafting", "workbench", "bookshelf"]

/** A different assistant gets a different desk, so two AIs never overlap. */
const SOURCE_HOME: Record<string, StationId> = {
  claude:  "desk",
  codex:   "drafting",
  gemini:  "workbench",
  copilot: "bookshelf",
  cursor:  "drafting",
  cline:   "workbench",
}

// Four distinct people rather than four copies of one. Skin and hair are what
// the eye picks up first at room scale, before shirt colour.
const SKIN_TONES = ["#e8b894", "#c98d63", "#8d5a3c", "#f0c9a8", "#6f4430"] as const
/** Glasses, headphones, a pencil behind the ear — or nothing. */
const ACCESSORIES: Accessory[] = [1, 0, 2, 3, 0, 1]

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle:     PAL.statIdle,
  thinking: PAL.statThink,
  tool:     PAL.statTool,
  writing:  PAL.statWrite,
  busy:     PAL.agentSub,
  error:    PAL.statError,
  waiting:  INK.wait,
}

// ── Carried material ─────────────────────────────────────────────────────────

/**
 * The armful of folders an agent walks back with after a burst of reads. All
 * six are built; the actor shows as many as were actually fetched. Past about
 * six the stack stops reading as folders and starts reading as a block.
 */
const MAX_FOLDERS = 6

function CarriedFolders() {
  const tints = ["#c9a06a", "#b98d55", "#d8b784", "#a97f4c", "#c49a62", "#b08650"]
  const n = MAX_FOLDERS
  return (
    <group position={[0, 1.176, 0.238]} rotation={[0.17, 0, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh
          key={i}
          geometry={chamfer(0.30, 0.013, 0.215, 0.004)}
          material={M.folder(tints[i % tints.length])}
          position={[
            (i % 2) * 0.008 - 0.004,
            i * 0.015,
            (i % 3) * 0.005 - 0.005,
          ]}
          rotation={[0, (i - n / 2) * 0.03, (i % 2 ? 1 : -1) * 0.012]}
          castShadow
        />
      ))}
    </group>
  )
}

// ── Speech bubble ────────────────────────────────────────────────────────────

/**
 * What the figure is doing, in words, above its head. The actor writes the
 * text straight into these nodes (see useActor's writeBubble); React only
 * mounts them. It never takes the pointer: clicks go through to the figure.
 */
function Bubble({ bubbleRef, color }: {
  bubbleRef: React.MutableRefObject<HTMLDivElement | null>
  color: string
}) {
  return (
    <Html
      position={[0, 2.12, 0]}
      // Under the HUD panels (z-index 10+), above the canvas.
      zIndexRange={[8, 1]}
      style={{ pointerEvents: "none" }}
    >
      <div ref={bubbleRef} className="bubble" data-on="0" data-kind="work"
           style={{ ["--accent" as string]: color }}>
        <span className="bubble-who" data-who="" />
        <span className="bubble-text" data-t="" />
      </div>
    </Html>
  )
}

// ── One agent ────────────────────────────────────────────────────────────────

function AgentUnit({ agent }: { agent: AgentState }) {
  const rootRef   = useRef<THREE.Group>(null)
  const haloRef   = useRef<THREE.Group>(null)
  const carryRef  = useRef<THREE.Group>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<THREE.Group>(null)

  const queue   = useMemo(() => queueFor(agent.id), [agent.id])
  // The main figure of each assistant owns that assistant's desk; its
  // sub-agents spread over the remaining stations.
  const home = agent.isSubagent
    ? HOMES[agent.slot % HOMES.length]
    : SOURCE_HOME[agent.source] ?? HOMES[agent.slot % HOMES.length]
  const retire   = useStore(s => s.retireAgent)
  const setFocus = useStore(s => s.setFocus)
  const retiring = useRef(false)
  const hovered  = useRef(false)

  // The actor reads these every frame; a ref keeps that off React's schedule.
  const attention = useRef<Attention | undefined>(agent.attention)
  attention.current = agent.attention

  // A new figure has to be drawn, shadow included, even if it stands still.
  useEffect(() => { wake(1500) }, [])
  useEffect(() => { wake(900) }, [agent.attention])

  // A sub-agent that has had nothing to do for a while has finished. Checked
  // on an interval rather than per frame: this is a slow, coarse decision and
  // the render loop should not carry it.
  useEffect(() => {
    if (!agent.isSubagent) return
    const id = setInterval(() => {
      if (Date.now() - agent.lastSeenAt > SUB_IDLE_EXIT_MS) retiring.current = true
    }, 2000)
    return () => clearInterval(id)
  }, [agent.isSubagent, agent.lastSeenAt])

  // A sub-agent reports to the main figure OF ITS OWN ASSISTANT. Agent ids are
  // namespaced by source, so the bare "main" this used to pass matched nothing
  // once a second AI was in the room — and a Codex sub-agent would have walked
  // over to hand its folder to Claude.
  const parentId = `${agent.source}:main`

  const intro = useMemo(
    () => (agent.isSubagent ? entranceScript(parentId, home) : undefined),
    [agent.isSubagent, home, parentId],
  )

  useActor(agent.id, queue, {
    root: rootRef, halo: haloRef, carry: carryRef, bubble: bubbleRef, anchor: anchorRef,
  }, {
    home,
    intro,
    startAt:   agent.isSubagent ? DOOR_OUTSIDE : undefined,
    seedPhase: agent.slot * 1.7,
    retiring,
    outro:     () => exitScript(parentId),
    onDespawn: () => retire(agent.id),
    attention,
    hovered,
    label:     agent.label,
  })

  const shirt = shirtFor(agent.source, agent.isSubagent)
  const color = STATUS_COLOR[agent.status]

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    hovered.current = true
    document.body.style.cursor = "pointer"
    wake(300)
  }
  const onOut = () => {
    hovered.current = false
    document.body.style.cursor = ""
    wake(300)
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    setFocus({ kind: "agent", id: agent.id })
  }
  // The cursor must not stay a hand after the figure is gone.
  useEffect(() => () => { if (hovered.current) document.body.style.cursor = "" }, [])

  return (
    <group ref={rootRef} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
      <Character
        shirtColor={shirt}
        hairStyle={(agent.slot % 3) as 0 | 1 | 2}
        skinTone={SKIN_TONES[agent.slot % SKIN_TONES.length]}
        seed={agent.slot * 17 + 3}
        accessory={ACCESSORIES[agent.slot % ACCESSORIES.length]}
      />
      <group ref={haloRef} position={[0, 1.94, 0]}>
        <StatusHalo color={color} y={0} />
      </group>
      <group ref={carryRef} visible={false}>
        <CarriedFolders />
      </group>
      <group ref={anchorRef}>
        <Bubble bubbleRef={bubbleRef} color={assistantFor(agent.source).color} />
      </group>
    </group>
  )
}

// ── All agents ───────────────────────────────────────────────────────────────

/**
 * A single workflow run can spawn seven sub-agents at once. Putting all of
 * them on stage means seven figures queueing at one door and sharing four
 * desks — unreadable, and it buries the main agent. The room shows the most
 * recently active handful; the HUD still counts everyone.
 */
const MAX_SUBS_ON_STAGE = 4

export function AgentLayer() {
  const agents = useStore(s => s.agents)

  const cast = useMemo(() => {
    const all = Array.from(agents.values())
    const main = all.filter(a => !a.isSubagent)
    const subs = all
      .filter(a => a.isSubagent)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_SUBS_ON_STAGE)
    return [...main, ...subs]
  }, [agents])

  return (
    <>
      {cast.map(a => <AgentUnit key={a.id} agent={a} />)}
    </>
  )
}
