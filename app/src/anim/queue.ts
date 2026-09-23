/**
 * queue.ts — reconciling event rate with animation rate.
 *
 * THE PROBLEM. Claude Code emits tool calls in bursts: measured peak on a real
 * session was 13 events/second, while a walk-to-the-cabinet-and-search beat
 * takes 3–4 seconds to play. Naively animating one beat per event puts the
 * room minutes behind reality within a few seconds, and it never recovers.
 *
 * THREE MECHANISMS, in the order they apply:
 *
 *  1. BURST MERGING. Consecutive events that resolve to the SAME station
 *     collapse into one beat with a count. Twelve Reads in a row become one
 *     trip to the filing cabinet carrying twelve folders — which is both far
 *     cheaper and a more honest depiction of what happened than twelve
 *     identical trips.
 *
 *  2. ELASTIC CATCHUP. Playback speed scales with queue depth, up to 3×. A
 *     backed-up agent visibly hurries; that reads as busy rather than broken.
 *
 *  3. HARD COLLAPSE. Past a depth ceiling the queue folds its tail together
 *     regardless of station, so an extreme burst degrades to a fast montage
 *     instead of an unbounded backlog.
 *
 * The queue deliberately lives OUTSIDE React state. It changes at event rate
 * and is read at frame rate; routing it through setState would re-render the
 * whole scene graph dozens of times a second for no visual gain.
 */

import { Evt } from "../types"
import { StationId, commandLine, stationForTool } from "./stations"

/** `oops` and `ack` are reactions, played where the figure stands: a hand to
 *  the head when a tool fails, a nod at the viewer when a request arrives. */
export type BeatKind = "work" | "think" | "write" | "idle" | "oops" | "ack"

export interface Beat {
  id:       string
  kind:     BeatKind
  station:  StationId
  toolName: string
  /** What the latest folded event was about: a file, a command. */
  hint:     string
  /** Every command folded into a bench beat, in order (the last few): the
   *  terminal shows them all, not just the one that happened to come last. */
  lines:    string[]
  /** How many source events folded into this beat. */
  count:    number
  /** Timestamp of the earliest event in the beat. */
  at:       number
}

const MAX_DEPTH   = 14      // beyond this the tail collapses
const MERGE_LIMIT = 24      // a single beat never claims more than this
const MAX_LINES   = 6       // commands a bench beat remembers for the terminal

export class ActorQueue {
  private items: Beat[] = []
  /** Beats dropped by hard collapse — surfaced so the HUD can be honest. */
  collapsed = 0

  get depth(): number { return this.items.length }

  /**
   * Playback multiplier. Grows with backlog so the figure catches up, but is
   * capped: past 3× the motion stops reading as walking and starts reading as
   * a glitch.
   */
  get speed(): number {
    const d = this.items.length
    if (d <= 1) return 1
    return Math.min(3, 1 + (d - 1) * 0.34)
  }

  /** Approximate seconds of animation still owed. */
  get lagSeconds(): number {
    const owed = this.items.reduce((s, b) => s + beatDuration(b), 0)
    return owed / this.speed
  }

  push(evt: Evt): void {
    const beat = toBeat(evt)
    if (!beat) return

    const tail = this.items[this.items.length - 1]
    if (tail && canMerge(tail, beat)) {
      tail.count = Math.min(MERGE_LIMIT, tail.count + beat.count)
      if (beat.hint) { tail.hint = beat.hint; tail.toolName = beat.toolName }
      tail.lines = [...tail.lines, ...beat.lines].slice(-MAX_LINES)
      return
    }

    this.items.push(beat)

    if (this.items.length > MAX_DEPTH) this.collapse()
  }

  /**
   * Fold the tail of an over-long queue together. Same-station runs merge
   * first; if that is not enough, adjacent beats merge regardless of station
   * and the survivor keeps the later station, so the figure ends up where the
   * most recent work actually was.
   */
  private collapse(): void {
    const keep = this.items.slice(0, 4)
    const tail = this.items.slice(4)
    const folded: Beat[] = []

    for (const b of tail) {
      const last = folded[folded.length - 1]
      if (last && (last.station === b.station || folded.length > 5)) {
        last.count = Math.min(MERGE_LIMIT, last.count + b.count)
        last.station = b.station
        last.toolName = b.toolName
        last.hint = b.hint
        last.kind = b.kind
        last.lines = [...last.lines, ...b.lines].slice(-MAX_LINES)
        this.collapsed++
      } else {
        folded.push(b)
      }
    }
    this.items = [...keep, ...folded]
  }

  shift(): Beat | undefined { return this.items.shift() }
  peek():  Beat | undefined { return this.items[0] }
  clear(): void { this.items = []; this.collapsed = 0 }
}

// ── Event → beat ─────────────────────────────────────────────────────────────

function toBeat(evt: Evt): Beat | null {
  switch (evt.kind.t) {
    case "tool_start": {
      const station = stationForTool(evt.kind.name)
      return {
        id: evt.id, kind: "work", at: evt.at, count: 1,
        toolName: evt.kind.name, hint: evt.kind.hint, station,
        lines: station === "workbench" ? [commandLine(evt.kind.name, evt.kind.hint)] : [],
      }
    }
    case "thinking":
      return { id: evt.id, kind: "think", at: evt.at, count: 1, toolName: "Thinking", hint: "", lines: [], station: "desk" }
    case "text":
      return { id: evt.id, kind: "write", at: evt.at, count: 1, toolName: "Writing", hint: "", lines: [], station: "desk" }
    case "turn_end":
      return { id: evt.id, kind: "idle", at: evt.at, count: 1, toolName: "", hint: "", lines: [], station: "desk" }
    case "error":
      return { id: evt.id, kind: "oops", at: evt.at, count: 1, toolName: "", hint: evt.kind.message, lines: [], station: "desk" }
    case "prompt":
      return { id: evt.id, kind: "ack", at: evt.at, count: 1, toolName: "", hint: "", lines: [], station: "desk" }
    // tool_end and requests for attention do not move anybody through the
    // queue: the HUD and the actor's own attention handling pick those up.
    default:
      return null
  }
}

function canMerge(a: Beat, b: Beat): boolean {
  if (a.count >= MERGE_LIMIT) return false
  if (a.kind !== b.kind) return false
  if (a.kind === "work") return a.station === b.station
  return true            // consecutive thinking / writing / idle always merge
}

/** Base seconds for a beat, before the speed multiplier. */
export function beatDuration(b: Beat): number {
  switch (b.kind) {
    case "work":  return 1.15 + Math.min(b.count, 10) * 0.22
    case "think": return 1.60 + Math.min(b.count, 6) * 0.20
    case "write": return 1.30 + Math.min(b.count, 6) * 0.18
    case "idle":  return 0.80
    case "oops":  return 1.90
    case "ack":   return 1.50
  }
}

/** Reactions play where the figure is; everything else goes to a station. */
export function inPlace(b: Beat): boolean {
  return b.kind === "oops" || b.kind === "ack"
}

// ── Registry ─────────────────────────────────────────────────────────────────

const queues = new Map<string, ActorQueue>()

export function queueFor(agentId: string): ActorQueue {
  let q = queues.get(agentId)
  if (!q) { q = new ActorQueue(); queues.set(agentId, q) }
  return q
}

/** Same key the store gives the agent. Every assistant has an agent called
 *  "main", so the bare agent_id would feed a queue no actor ever reads. */
export function queueKey(evt: Evt): string {
  return `${evt.source || "claude"}:${evt.agent_id}`
}

export function pushEvent(evt: Evt): void {
  queueFor(queueKey(evt)).push(evt)
}

/** Worst backlog across all agents, in seconds — shown on the HUD. */
export function globalLag(): { seconds: number; depth: number; collapsed: number } {
  let seconds = 0, depth = 0, collapsed = 0
  for (const q of queues.values()) {
    seconds = Math.max(seconds, q.lagSeconds)
    depth   = Math.max(depth, q.depth)
    collapsed += q.collapsed
  }
  return { seconds, depth, collapsed }
}

/** Is any figure owed work? The frame driver renders at full rate until not. */
export function anyQueued(): boolean {
  for (const q of queues.values()) if (q.depth > 0) return true
  return false
}

/** Clear every queue, or only those of one assistant when `source` is given. */
export function resetQueues(source?: string): void {
  for (const [key, q] of queues) {
    if (!source || key.startsWith(`${source}:`)) q.clear()
  }
}
