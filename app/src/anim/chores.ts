/**
 * chores.ts — scripted sequences that take precedence over event-driven work.
 *
 * A sub-agent does not simply appear at a desk. It comes through the door,
 * walks over to the agent that dispatched it, takes a folder, and only then
 * goes to work; when it is finished it hands back a report and leaves the same
 * way. That is a fixed piece of choreography, not something the event stream
 * describes, so it is expressed here as a small script the actor plays out
 * before it touches its queue.
 *
 * Chores may push further chores, which is how `meet` expands into "walk to
 * wherever they are standing right now, then hold facing them".
 */

import { StationId } from "./stations"
import { DOOR_INSIDE, DOOR_OUTSIDE } from "./stage"
import type { Pose } from "../components/Character"

export type Chore =
  /** Hold the door open (refcounted) or release it. */
  | { c: "door"; hold: boolean }
  /** Walk to an arbitrary point. */
  | { c: "walk"; to: [number, number] }
  /** Walk to a station's stand point and adopt its facing. */
  | { c: "station"; id: StationId }
  /**
   * Walk to whoever `agent` is, then hold facing them.
   *
   * The spot is resolved when the chore starts, but the target keeps working
   * and may have walked off by the time we arrive — so on arrival the actor
   * re-checks the distance and reissues the meet. `tries` bounds that, because
   * chasing an agent that is itself criss-crossing the room would never settle.
   */
  | { c: "meet"; agent: string; hold: number; tries?: number }
  /** Stand still in a pose for a while (used after `meet` resolves). */
  | {
      c: "hold"; pose: Pose; seconds: number; face?: string
      /** Set when this hold terminates a `meet`, so arrival can re-check range. */
      thenMeet?: { agent: string; hold: number; tries: number }
    }
  /** Show or hide carried material. */
  | { c: "carry"; n: number }
  /** Remove this agent from the scene. */
  | { c: "despawn" }

/**
 * Arriving. The pause at the door is deliberate: entering and immediately
 * striding off reads as teleporting-with-extra-steps, whereas a beat on the
 * threshold reads as someone walking in.
 */
export function entranceScript(parentId: string, home: StationId): Chore[] {
  return [
    { c: "door",    hold: true },
    { c: "walk",    to: DOOR_INSIDE },
    { c: "hold",    pose: "idle", seconds: 0.35 },
    { c: "door",    hold: false },
    { c: "meet",    agent: parentId, hold: 1.15 },
    { c: "carry",   n: 3 },
    { c: "hold",    pose: "carrying", seconds: 0.45 },
    { c: "station", id: home },
    { c: "carry",   n: 0 },
  ]
}

/** Leaving: hand the work back, then go out the way you came. */
export function exitScript(parentId: string): Chore[] {
  return [
    { c: "carry",   n: 2 },
    { c: "meet",    agent: parentId, hold: 1.05 },
    { c: "carry",   n: 0 },
    { c: "hold",    pose: "idle", seconds: 0.30 },
    { c: "door",    hold: true },
    { c: "walk",    to: DOOR_INSIDE },
    { c: "walk",    to: DOOR_OUTSIDE },
    { c: "door",    hold: false },
    { c: "despawn" },
  ]
}

/**
 * How long a sub-agent may sit with nothing queued before it packs up.
 * Long enough to survive a lull between tool calls, short enough that a
 * finished sub-agent does not loiter forever.
 */
export const SUB_IDLE_EXIT_MS = 18_000
