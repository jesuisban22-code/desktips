/**
 * useActor.ts — one agent's body, driven per frame.
 *
 * The actor owns everything about where a figure is and what it is doing:
 * position, facing, seat height, and every joint rotation. Nothing here goes
 * through React state — it all runs in useFrame and writes straight to the
 * Object3D graph, because this changes 60 times a second and React re-renders
 * of a scene this size would cost far more than the animation itself.
 *
 * Work comes from three places, in priority order:
 *
 *   CHORES  scripted choreography (arriving through the door, handing over a
 *           folder, leaving). Fixed sequences the event stream never describes.
 *   QUEUE   the event-driven beats: go to the furniture this tool maps to and
 *           do the matching action.
 *   CALL    the assistant is blocked on the person (a permission dialog, a
 *           question). Once the queue has drained, the figure steps out
 *           towards the viewer and puts a hand up until it is answered.
 *
 * With all three empty the actor drifts back to its home station, carrying
 * whatever it last fetched — which is what produces the "goes to the cabinet,
 * digs through it, comes back with an armful of folders" beat.
 *
 * The speech bubble is written from here too, straight into its DOM node: what
 * it says has to match what the body is doing, and the body is behind the
 * event stream whenever a burst is being worked through.
 */

import { useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"

import {
  JOINT_NAMES, SEATED, SEATED_ROOT_Y, SEATED_ROOT_Z,
  type Joint, type PoseMap, type Pose,
} from "../components/Character"
import {
  STATIONS, StationId, facingOf, bareToolName, iconForTool, type ActionKind,
} from "./stations"
import { findPath, isBlocked, pathLength, samplePath, type Path } from "./nav"
import { ActorQueue, Beat, beatDuration, inPlace } from "./queue"
import { Chore } from "./chores"
import {
  holdDoor, releaseDoor, reportPlacement, forgetPlacement,
  meetingSpotFor, placementOf, allPlacements,
} from "./stage"
import {
  walkPose, walkCarryPose, walkBob, workPose, idlePose, thinkPose, writePose,
  carryPose, callPose, typePose, scratchPose, nodPose, stretchPose, lookAroundPose,
  armsFoldedPose, STRIDE,
} from "./motion"
import { reportBusy, forgetBusy, wake, glance } from "./activity"
import { atCabinet, drew, typed } from "./workshop"
import type { Attention } from "../types"

const WALK_SPEED = 1.25          // m/s at 1× playback
const TURN_RATE  = 7.0           // rad/s
const BLEND      = 9.0           // joint lerp rate
const GLANCE_R   = 1.45          // how near someone must be to earn a look
/** A dialog answered within this was never worth a walk. Auto-approved
 *  permissions come and go in a blink; waving at every one would be noise. */
const CALL_DELAY = 0.9           // s
const CALL_STEP  = 0.8           // m towards the viewer
/** How long a bubble lingers once its action is over. */
const BUBBLE_LINGER = 1400       // ms
const MAX_FOLDERS = 6

/** ?debug in the URL exposes actor state on window for the headless checks. */
const DEBUG = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("debug")

/** What to do once a walk finishes. */
type Follow =
  | { f: "beat"; beat: Beat }
  | { f: "chore" }
  | { f: "home" }
  | { f: "station" }
  | { f: "call" }

/** Small things a figure does on its own while nothing is asked of it. */
type Fidget = "stretch" | "look" | "fold"

type State =
  | { s: "idle" }
  | { s: "walk"; path: Path; len: number; travelled: number; follow: Follow; face?: number }
  | { s: "work"; beat: Beat; t: number; dur: number }
  | { s: "hold"; pose: Pose; t: number; dur: number; face?: string }
  | { s: "call"; t: number }
  /** A reaction beat (oops, ack), played where the figure stands or sits. */
  | { s: "react"; beat: Beat; t: number; dur: number }
  | { s: "fidget"; kind: Fidget; t: number; dur: number }
  | { s: "gone" }

/** Idle this long, give or take, and a figure finds something to do. */
const FIDGET_MIN = 9
const FIDGET_SPAN = 10

export interface ActorHandles {
  root:   React.MutableRefObject<THREE.Group | null>
  halo:   React.MutableRefObject<THREE.Group | null>
  carry:  React.MutableRefObject<THREE.Group | null>
  bubble: React.MutableRefObject<HTMLDivElement | null>
  /** What the bubble hangs from: it sits down with the figure, like the halo. */
  anchor: React.MutableRefObject<THREE.Group | null>
}

export interface ActorOptions {
  home:        StationId
  /** Scripted sequence played before any queued work. */
  intro?:      Chore[]
  /** Where to start, if not the home station. */
  startAt?:    [number, number]
  seedPhase?:  number
  /** Called once the actor plays a despawn chore. */
  onDespawn?:  () => void
  /** True once this agent should pack up; triggers the outro. */
  retiring?:   React.MutableRefObject<boolean>
  outro?:      () => Chore[]
  /** Set while the assistant waits on the person. */
  attention?:  React.MutableRefObject<Attention | undefined>
  /** The pointer is over this figure: the bubble names it. */
  hovered?:    React.MutableRefObject<boolean>
  label?:      string
}

interface Face {
  eyes:   THREE.Object3D[]
  /** Each brow with the position and roll it was built with. */
  brows:  Array<{ o: THREE.Object3D; y: number; z: number; side: number }>
  mouth:  THREE.Object3D | null
  torso:  THREE.Object3D | null
}

interface Rig {
  joints: Map<Joint, THREE.Object3D>
  body:   THREE.Object3D | null
  face:   Face
}

function buildRig(root: THREE.Object3D): Rig {
  const joints = new Map<Joint, THREE.Object3D>()
  for (const name of JOINT_NAMES) {
    const o = root.getObjectByName(name)
    if (o) joints.set(name as Joint, o)
  }
  const brows = (["browL", "browR"] as const)
    .map(n => root.getObjectByName(n))
    .filter((o): o is THREE.Object3D => !!o)
    .map(o => ({ o, y: o.position.y, z: o.rotation.z, side: o.name === "browL" ? 1 : -1 }))
  return {
    joints,
    body: root.getObjectByName("bodyRoot") ?? null,
    face: {
      eyes: (["eyeL", "eyeR"] as const).map(n => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o),
      brows,
      mouth: root.getObjectByName("mouth") ?? null,
      torso: root.getObjectByName("torso") ?? null,
    },
  }
}

/** What the face is doing: brows up or down, their inner ends in or out, and
 *  how open the mouth is — each eased toward, never snapped. */
interface Expression { lift: number; knit: number; open: number; wide: number; talk: boolean; quizzical: boolean }
const NEUTRAL: Expression = { lift: 0, knit: 0, open: 1, wide: 1, talk: false, quizzical: false }

/** A stable coin toss per beat, so a beat keeps its variant while it plays. */
function variantOf(beat: Beat): number {
  let h = 0
  for (let i = 0; i < beat.id.length; i++) h = (h * 31 + beat.id.charCodeAt(i)) | 0
  return Math.abs(h) % 2
}

const ZERO: [number, number, number] = [0, 0, 0]

function applyPose(rig: Rig, target: PoseMap, alpha: number): void {
  for (const [name, obj] of rig.joints) {
    const t = target[name] ?? ZERO
    obj.rotation.x += (t[0] - obj.rotation.x) * alpha
    obj.rotation.y += (t[1] - obj.rotation.y) * alpha
    obj.rotation.z += (t[2] - obj.rotation.z) * alpha
  }
}

/** Shortest signed angular difference, so turning never takes the long way. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Only these put a hand up. "Idle" — Claude finished and waits for your next
 *  message — is said by the bubble alone: it is not an interruption. */
function isCall(a: Attention | undefined): boolean {
  return !!a && (a.reason === "permission" || a.reason === "question")
}

export function useActor(
  agentId: string,
  queue: ActorQueue,
  handles: ActorHandles,
  opts: ActorOptions,
): void {
  const { home, seedPhase = 0 } = opts

  const rig      = useRef<Rig | null>(null)
  const state    = useRef<State>({ s: "idle" })
  const chores   = useRef<Chore[]>(opts.intro ? [...opts.intro] : [])
  const station  = useRef<StationId>(home)
  /** Stepped away from the station's stand point (to answer a call). */
  const offStation = useRef(false)
  const phase    = useRef(seedPhase)
  const clock    = useRef(0)
  const carrying = useRef(0)
  const outroDone = useRef(false)
  const callFor  = useRef(0)
  const bubble   = useRef({ text: "", kind: "", who: false, lastSaid: 0, on: false })
  /** Seconds of genuine idleness, and when the next fidget is due. */
  const idleFor  = useRef(0)
  const fidgetAt = useRef(FIDGET_MIN + (seedPhase * 3.7) % FIDGET_SPAN)
  /** Seconds since it last did anything asked of it (fidgets don't count). */
  const restFor  = useRef(0)
  /** Blinks: time to the next one, and how far into the current one. */
  const blink    = useRef({ next: 1.5 + (seedPhase % 3), t: -1 })
  const face     = useRef<Expression>({ ...NEUTRAL })
  const start    = opts.startAt ?? STATIONS[home].stand
  const pos      = useRef(new THREE.Vector2(start[0], start[1]))
  const facing   = useRef(facingOf(STATIONS[home]))

  useFrame((frame, rawDt) => {
    const root = handles.root.current
    if (!root) return
    if (!rig.current) rig.current = buildRig(root)
    const R = rig.current

    if (state.current.s === "gone") { root.visible = false; forgetBusy(agentId); return }

    const cam = frame.camera.position
    const att = opts.attention?.current
    const calling = isCall(att)
    callFor.current = calling ? callFor.current + rawDt : 0

    if (DEBUG) {
      const dbg = window as unknown as { __bureau?: Record<string, unknown> }
      if (!dbg.__bureau) dbg.__bureau = {}
      ;(dbg.__bureau as Record<string, unknown>)[agentId] = {
        station: station.current, state: state.current.s,
        chores: chores.current.length, queue: queue.depth,
        speed: Number(queue.speed.toFixed(2)),
        x: Number(pos.current.x.toFixed(2)), z: Number(pos.current.y.toFixed(2)),
        carrying: carrying.current, off: offStation.current,
        bubble: bubble.current.on ? bubble.current.text : "",
      }
    }

    // Catchup: everything downstream of here runs on scaled time. The clamp
    // guards a huge step after a stall from teleporting a walking figure; at
    // 1/20 s it was so tight that on a slow machine animation time ran behind
    // real time and the queue grew without bound.
    const speed = queue.speed
    const dt = Math.min(rawDt, 0.25) * speed
    clock.current += dt

    let target: PoseMap = {}
    let seated = false
    const st = state.current

    // ── advance ───────────────────────────────────────────────────────────
    if (st.s === "idle") {
      // A retiring sub-agent packs up once its real work is done.
      if (opts.retiring?.current && !outroDone.current
          && chores.current.length === 0 && queue.depth === 0) {
        outroDone.current = true
        chores.current = opts.outro ? opts.outro() : []
      }
      if (chores.current.length > 0) {
        runChore(chores.current.shift()!)
      } else {
        const beat = queue.shift()
        if (beat) startBeat(beat)
        else if (calling && callFor.current >= CALL_DELAY) answerCall(cam)
        else if (station.current !== home) goHome()
        else if (offStation.current) backToStation()
        else if (!att) {
          // Nothing asked of it: now and then, it does something on its own.
          idleFor.current += rawDt
          restFor.current += rawDt
          if (idleFor.current >= fidgetAt.current) startFidget()
        }
      }
      if (state.current.s !== "idle") idleFor.current = 0
      if (state.current.s !== "idle" && state.current.s !== "fidget") restFor.current = 0
    }

    else if (st.s === "walk") {
      st.travelled += WALK_SPEED * dt
      const sample = samplePath(st.path, st.travelled)
      pos.current.set(sample.x, sample.z)
      phase.current += (WALK_SPEED * dt / STRIDE) * Math.PI * 2

      // Face along travel, except on the last few centimetres where the
      // destination's own facing takes over — otherwise the figure arrives
      // side-on to the furniture it is about to use.
      const remaining = st.len - st.travelled
      const want = remaining < 0.35 && st.face !== undefined ? st.face : sample.heading
      facing.current += angleDelta(facing.current, want) * Math.min(1, TURN_RATE * dt)

      target = carrying.current > 0
        ? walkCarryPose(phase.current, speed)
        : walkPose(phase.current, speed)

      if (st.travelled >= st.len) finishWalk(st.follow)
    }

    else if (st.s === "work") {
      st.t += dt
      const S = STATIONS[st.beat.station]
      seated = !!S.seated
      facing.current += angleDelta(facing.current, facingOf(S)) * Math.min(1, TURN_RATE * dt)
      target = poseForBeat(st.beat, S.action, st.t, variantOf(st.beat))

      if (st.t >= st.dur) {
        if (st.beat.station === "cabinet" || st.beat.station === "bookshelf") {
          carrying.current = Math.min(st.beat.count, 12)
        } else if (st.beat.station === "desk") {
          carrying.current = 0
        } else if (st.beat.station === "drafting" && st.beat.kind === "work") {
          // Two lines per edit folded into the beat: a burst of edits leaves a
          // visibly fuller drawing than a single one.
          drew(Math.min(10, st.beat.count * 2))
        }
        state.current = { s: "idle" }
        clock.current = 0
      }
    }

    else if (st.s === "hold") {
      st.t += dt
      target = st.pose === "carrying" ? carryPose() : idlePose(st.t)
      if (st.face) {
        const p = placementOf(st.face)
        if (p) {
          const want = Math.atan2(p.x - pos.current.x, p.z - pos.current.y)
          facing.current += angleDelta(facing.current, want) * Math.min(1, TURN_RATE * dt)
        }
      }
      if (st.t >= st.dur) { state.current = { s: "idle" }; clock.current = 0 }
    }

    else if (st.s === "call") {
      st.t += rawDt
      target = callPose(st.t)
      // Towards the viewer, wherever the orbit has put them.
      const want = Math.atan2(cam.x - pos.current.x, cam.z - pos.current.y)
      facing.current += angleDelta(facing.current, want) * Math.min(1, TURN_RATE * rawDt)
      if (!calling) { state.current = { s: "idle" }; clock.current = 0 }
    }

    else if (st.s === "react") {
      st.t += rawDt
      seated = !!STATIONS[station.current].seated && !offStation.current
      if (st.beat.kind === "ack") {
        target = nodPose(st.t, st.dur)
        // A request is addressed to the person watching: look up at them —
        // turning only the head when seated, not the whole body out of the chair.
        if (!seated) {
          const want = Math.atan2(cam.x - pos.current.x, cam.z - pos.current.y)
          facing.current += angleDelta(facing.current, want) * Math.min(1, TURN_RATE * rawDt)
        }
      } else {
        target = scratchPose(st.t, st.dur)
      }
      if (st.t >= st.dur) { state.current = { s: "idle" }; clock.current = 0 }
    }

    else if (st.s === "fidget") {
      st.t += rawDt
      // Smooth frames for as long as it lasts, shadows included — but not
      // reported as busy (see reportBusy below).
      glance(120, true)
      seated = !!STATIONS[station.current].seated && !offStation.current
      target = st.kind === "stretch" ? stretchPose(st.t, st.dur)
             : st.kind === "look"    ? lookAroundPose(st.t, st.dur)
             : armsFoldedPose(st.t, st.dur)
      // Anything real interrupts a fidget.
      if (st.t >= st.dur || queue.depth > 0 || chores.current.length > 0 || att) {
        state.current = { s: "idle" }
        clock.current = 0
      }
    }

    // Idle pose only when genuinely idle.
    if (state.current.s === "idle") {
      const S = STATIONS[station.current]
      seated = !!S.seated && !offStation.current
      target = seated ? writePose(clock.current * 0.5) : idlePose(clock.current)

      // Look at anyone standing close by. This is what makes a handoff read as
      // two people rather than one person walking up to a mannequin.
      const near = nearestOther(agentId, pos.current)
      const want = near
        ? Math.atan2(near.x - pos.current.x, near.z - pos.current.y)
        : facingOf(S)
      facing.current += angleDelta(facing.current, want) * Math.min(1, TURN_RATE * dt)
    }

    // ── write the transform ───────────────────────────────────────────────
    const now = state.current
    const bob = now.s === "walk" ? walkBob(phase.current) : 0
    root.position.set(pos.current.x, bob, pos.current.y)
    root.rotation.y = facing.current
    reportPlacement(agentId, { x: pos.current.x, z: pos.current.y, facing: facing.current })

    if (R.body) {
      const k = Math.min(1, BLEND * rawDt)
      const wantY = seated ? SEATED_ROOT_Y : 0
      const wantZ = seated ? SEATED_ROOT_Z : 0
      R.body.position.y += (wantY - R.body.position.y) * k
      R.body.position.z += (wantZ - R.body.position.z) * k
    }

    const finalPose = seated ? { ...target, ...SEATED } : target
    applyPose(R, finalPose, Math.min(1, BLEND * rawDt))
    updateFace(R.face, now, rawDt, att)

    const halo = handles.halo.current
    if (halo) {
      halo.rotation.y += rawDt * (now.s === "work" ? 1.6 : 0.6)
      const haloY = seated ? 1.94 + SEATED_ROOT_Y : 1.94
      halo.position.y += (haloY - halo.position.y) * Math.min(1, BLEND * rawDt)
      // A slow pulse while someone is waited on: found at a glance, not a strobe.
      halo.scale.setScalar(att ? 1 + 0.16 * Math.sin(clock.current * 4.2) : 1)
    }
    const anchor = handles.anchor.current
    if (anchor) {
      const wantY = seated ? SEATED_ROOT_Y : 0
      anchor.position.y += (wantY - anchor.position.y) * Math.min(1, BLEND * rawDt)
    }

    const carry = handles.carry.current
    if (carry) {
      carry.visible = carrying.current > 0 && (now.s === "walk" || now.s === "hold")
      // The stack shows how much was actually fetched, up to what still reads
      // as folders; it used to be four whatever the count.
      const stack = carry.children[0]
      if (stack) {
        const n = Math.min(MAX_FOLDERS, carrying.current)
        stack.children.forEach((c, i) => { c.visible = i < n })
      }
    }

    writeBubble(att, now)

    // The drawer stays out exactly as long as someone is in it.
    atCabinet(agentId, now.s === "work" && now.beat.station === "cabinet")

    // Waving, walking and working all need every frame; standing at a desk
    // breathing does not, and a fidget asks for its own frames as a glance:
    // reported as busy it would restart the room's slow-down every few
    // seconds, and a figure left idle all afternoon would keep it at 12 fps.
    reportBusy(agentId, (now.s !== "idle" && now.s !== "fidget") || chores.current.length > 0 || queue.depth > 0)
  })

  // ── helpers, closed over the refs above ─────────────────────────────────

  function runChore(ch: Chore): void {
    switch (ch.c) {
      case "door":
        ch.hold ? holdDoor(agentId) : releaseDoor(agentId)
        break
      case "walk":
        walkTo(ch.to, { f: "chore" })
        break
      case "station":
        station.current = ch.id
        offStation.current = false
        walkTo(STATIONS[ch.id].stand, { f: "chore" }, facingOf(STATIONS[ch.id]))
        break
      case "meet": {
        const spot = meetingSpotFor(ch.agent)
        const tries = ch.tries ?? 2
        // On arrival: if they have wandered off and we have retries left, go
        // again; otherwise settle for where we are and just face them.
        chores.current.unshift({
          c: "hold", pose: "idle", seconds: ch.hold, face: ch.agent,
          thenMeet: tries > 0 ? { agent: ch.agent, hold: ch.hold, tries: tries - 1 } : undefined,
        })
        walkTo(spot, { f: "chore" })
        break
      }
      case "hold": {
        // If this hold is the tail of a `meet` and the target has moved out of
        // conversational range, chase once more instead of talking to thin air.
        if (ch.thenMeet) {
          const p = placementOf(ch.thenMeet.agent)
          const far = p && Math.hypot(p.x - pos.current.x, p.z - pos.current.y) > 1.8
          if (far) {
            chores.current.unshift({ c: "meet", ...ch.thenMeet })
            break
          }
        }
        state.current = { s: "hold", pose: ch.pose, t: 0, dur: ch.seconds, face: ch.face }
        clock.current = 0
        break
      }
      case "carry":
        carrying.current = ch.n
        break
      case "despawn":
        releaseDoor(agentId)
        forgetPlacement(agentId)
        forgetBusy(agentId)
        atCabinet(agentId, false)
        state.current = { s: "gone" }
        // A few more frames so the shadow maps are redrawn without this figure.
        wake(600)
        opts.onDespawn?.()
        break
    }
  }

  /** The body arrives at its work: what it does there now shows in the room. */
  function beginWork(beat: Beat): void {
    state.current = { s: "work", beat, t: 0, dur: beatDuration(beat) }
    clock.current = 0
    if (beat.kind === "work" && beat.station === "workbench") typed(beat.lines)
  }

  /** Something to do while nothing is asked: stretch, look about, fold arms. */
  function startFidget(): void {
    const seatedHere = !!STATIONS[station.current].seated && !offStation.current
    const choices: Fidget[] = seatedHere ? ["stretch", "look", "look"] : ["look", "fold", "stretch"]
    const kind = choices[Math.floor(Math.random() * choices.length)]
    const dur = kind === "look" ? 3.2 : kind === "fold" ? 4.6 : 2.6
    state.current = { s: "fidget", kind, t: 0, dur }
    idleFor.current = 0
    // Fidgets thin out the longer nothing is asked: every ten seconds or so
    // just after a task, once a minute or two by the end of a quiet hour.
    const rest = Math.min(6, 1 + restFor.current / 120)
    fidgetAt.current = (FIDGET_MIN + Math.random() * FIDGET_SPAN) * rest
  }

  /**
   * Blinks, breath and expression. All tiny, all on named parts of the head
   * and chest (Character.tsx) — the difference between a figure and a doll.
   */
  function updateFace(F: Face, st: State, dt: number, att: Attention | undefined): void {
    // Blink: a sixth of a second, every two to seven.
    const b = blink.current
    let lid = 1
    if (b.t < 0) {
      b.next -= dt
      // Due: it starts next frame, and asks for smooth ones while it lasts —
      // at the idle frame rate a sixth of a second falls between two frames.
      if (b.next <= 0) { b.t = 0; glance(260) }
    } else {
      // At most a twentieth per frame, so even slow frames show the lids shut.
      b.t += Math.min(dt, 0.05)
      const u = b.t / 0.16
      lid = u < 0.5 ? 1 - u * 1.8 : 0.1 + (u - 0.5) * 1.8
      if (u >= 1) { b.t = -1; b.next = 2.2 + Math.random() * 4.8; lid = 1 }
    }
    for (const e of F.eyes) e.scale.y = Math.max(0.1, Math.min(1, lid))

    // Breath: the chest, a percent.
    if (F.torso) {
      const br = Math.sin(performance.now() / 1000 * 1.7 + seedPhase)
      F.torso.scale.set(1 + br * 0.006, 1 + br * 0.010, 1 + br * 0.006)
    }

    // Expression, eased toward.
    const want = expressionFor(st, att)
    const f = face.current
    const k = Math.min(1, dt * 10)
    f.lift += (want.lift - f.lift) * k
    f.knit += (want.knit - f.knit) * k
    f.open += (want.open - f.open) * k
    f.wide += (want.wide - f.wide) * k
    for (const br of F.brows) {
      const extra = want.quizzical && br.side > 0 ? 0.008 : 0
      br.o.position.y = br.y + f.lift + extra
      br.o.rotation.z = br.z + br.side * f.knit
    }
    if (F.mouth) {
      const talk = want.talk ? Math.abs(Math.sin(performance.now() / 1000 * 9.5)) * 1.6 : 0
      F.mouth.scale.set(f.wide, f.open + talk, 1)
    }
  }

  function startBeat(beat: Beat): void {
    // Reactions happen where the figure is: no walk to the desk to be surprised.
    if (inPlace(beat)) {
      state.current = { s: "react", beat, t: 0, dur: beatDuration(beat) }
      clock.current = 0
      return
    }
    if (beat.station === station.current && !offStation.current) {
      beginWork(beat)
    } else {
      station.current = beat.station
      offStation.current = false
      walkTo(STATIONS[beat.station].stand, { f: "beat", beat },
             facingOf(STATIONS[beat.station]))
    }
  }

  function goHome(): void {
    station.current = home
    offStation.current = false
    walkTo(STATIONS[home].stand, { f: "home" }, facingOf(STATIONS[home]))
  }

  function backToStation(): void {
    offStation.current = false
    const S = STATIONS[station.current]
    walkTo(S.stand, { f: "station" }, facingOf(S))
  }

  /** Step out towards the viewer — out of the chair if need be — and wave. */
  function answerCall(cam: THREE.Vector3): void {
    const dx = cam.x - pos.current.x
    const dz = cam.z - pos.current.y
    const len = Math.hypot(dx, dz) || 1
    const spot: [number, number] = [
      pos.current.x + (dx / len) * CALL_STEP,
      pos.current.y + (dz / len) * CALL_STEP,
    ]
    offStation.current = true
    if (isBlocked(spot[0], spot[1])) {
      state.current = { s: "call", t: 0 }
    } else {
      walkTo(spot, { f: "call" })
    }
  }

  function walkTo(to: [number, number], follow: Follow, face?: number): void {
    const path = findPath([pos.current.x, pos.current.y], to)
    if (!path) {
      // Unreachable should not happen, but never strand the actor: jump the
      // logical state forward rather than freezing the machine.
      pos.current.set(to[0], to[1])
      finishWalk(follow)
      return
    }
    state.current = {
      s: "walk", path, len: pathLength(path), travelled: 0, follow, face,
    }
    clock.current = 0
  }

  function finishWalk(follow: Follow): void {
    if (follow.f === "beat") {
      beginWork(follow.beat)
      return
    } else if (follow.f === "call" && isCall(opts.attention?.current)) {
      state.current = { s: "call", t: 0 }
    } else {
      if (follow.f === "home") carrying.current = 0
      state.current = { s: "idle" }
    }
    clock.current = 0
  }

  /**
   * What the bubble should say, written only when it changes. It follows the
   * BODY, not the event stream: during a burst the log is ahead of the room,
   * and a bubble saying "Edit" over a figure still rummaging in the cabinet
   * would make the room look wrong rather than merely behind.
   */
  function writeBubble(att: Attention | undefined, st: State): void {
    const el = handles.bubble.current
    if (!el) return
    const b = bubble.current
    const t = performance.now()

    let text = ""
    let kind = "work"
    if (att) {
      kind = att.reason
      text = att.reason === "permission" ? `✋ autorisation${att.detail ? " · " + att.detail : ""}`
           : att.reason === "question"   ? `❓ ${att.detail || "une question"}`
           : "💬 à toi"
    } else if (st.s === "react") {
      kind = st.beat.kind
      text = st.beat.kind === "oops" ? `❗ ${st.beat.hint || "échec"}` : "🗨 bien reçu"
    } else if (st.s === "work") {
      text = beatText(st.beat)
    } else if (st.s === "walk" && st.follow.f === "beat") {
      text = beatText(st.follow.beat)
    }
    const who = !!opts.hovered?.current

    if (text) b.lastSaid = t
    // Keep saying the last thing for a moment: a bubble that vanishes the
    // instant a beat ends flickers between back-to-back beats. Not a request,
    // though — once answered, "autorisation" hanging on would be a lie.
    const linger = b.on && b.kind === "work" && t - b.lastSaid < BUBBLE_LINGER
    const on = !!text || linger || who
    const shown = text || (on ? b.text : "")

    if (shown !== b.text || kind !== b.kind || who !== b.who || on !== b.on) {
      const textEl = el.querySelector<HTMLElement>("[data-t]")
      const whoEl  = el.querySelector<HTMLElement>("[data-who]")
      if (textEl) textEl.textContent = shown
      if (whoEl) whoEl.textContent = who || att ? (opts.label ?? "") : ""
      el.dataset.kind = kind
      el.dataset.on = on ? "1" : "0"
      b.text = shown; b.kind = kind; b.who = who; b.on = on
    }
  }
}

function beatText(beat: Beat): string {
  switch (beat.kind) {
    case "think": return "💭 réfléchit"
    case "write": return "✍️ rédige"
    case "idle":
    case "oops":
    case "ack":   return ""
    case "work": {
      const name = bareToolName(beat.toolName)
      const hint = beat.hint ? ` · ${beat.hint}` : ""
      const n = beat.count > 1 ? ` ×${beat.count}` : ""
      return `${iconForTool(beat.toolName)} ${name}${hint}${n}`
    }
  }
}

function poseForBeat(beat: Beat, action: ActionKind, t: number, variant: number): PoseMap {
  switch (beat.kind) {
    case "think": return thinkPose(t)
    // At the desk, sometimes writing by hand and sometimes typing.
    case "write": return variant ? typePose(t) : writePose(t)
    case "work":  return workPose(action, t, variant)
    case "idle":
    case "oops":
    case "ack":   return idlePose(t)
  }
}

/** What the face does in each state. */
function expressionFor(st: State, att: Attention | undefined): Expression {
  if (st.s === "react") {
    return st.beat.kind === "oops"
      ? { lift: 0.011, knit: -0.10, open: 2.8, wide: 0.75, talk: false, quizzical: false }
      : { lift: 0.007, knit: -0.04, open: 1, wide: 1.30, talk: false, quizzical: false }
  }
  if (st.s === "call" || (att && att.reason !== "idle")) {
    return { lift: 0.006, knit: -0.06, open: 1.8, wide: 0.9, talk: false, quizzical: false }
  }
  if (st.s === "hold") return { ...NEUTRAL, talk: true }
  if (st.s === "fidget" && st.kind === "stretch") {
    // Stretching, and a yawn with it.
    return { lift: 0.006, knit: -0.03, open: 3.2, wide: 0.8, talk: false, quizzical: false }
  }
  if (st.s === "work") {
    if (st.beat.kind === "think") return { ...NEUTRAL, quizzical: true, knit: 0.04 }
    return { lift: -0.004, knit: 0.14, open: 1, wide: 0.9, talk: false, quizzical: false }
  }
  return NEUTRAL
}

/** Closest other agent within glancing distance, if any. */
function nearestOther(self: string, p: THREE.Vector2): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null
  let bestD = GLANCE_R
  for (const [id, q] of allPlacements()) {
    if (id === self) continue
    const d = Math.hypot(q.x - p.x, q.z - p.y)
    if (d < bestD) { bestD = d; best = q }
  }
  return best
}
