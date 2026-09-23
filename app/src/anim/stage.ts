/**
 * stage.ts — the small amount of state that actors must share.
 *
 * Two things cross actor boundaries: the door (one agent opening it has to be
 * visible to the component that draws it) and everyone's position (a sub-agent
 * walking over to receive a folder needs to know where its parent is standing).
 *
 * Like the animation queue, this lives outside React. It is written and read
 * every frame by several components; routing it through state would re-render
 * the room continuously for values that only the render loop cares about.
 */

import { STATIONS } from "./stations"

// ── The door ─────────────────────────────────────────────────────────────────

interface DoorState {
  /** Current swing, 0 = closed, 1 = fully open. Lerped by Room. */
  open: number
  /** How many agents currently need it open. Refcounted, not boolean: two
   *  sub-agents arriving at once must not have the first one's exit slam the
   *  door on the second. */
  holders: Set<string>
}

/** Seeded at the resting ajar angle so the first frame does not snap. */
export const door: DoorState = { open: 0.209, holders: new Set() }

export function holdDoor(agentId: string): void { door.holders.add(agentId) }
export function releaseDoor(agentId: string): void { door.holders.delete(agentId) }
export function doorWanted(): number { return door.holders.size > 0 ? 1 : 0 }

/** Where an agent stands just outside the door, before it has entered. */
export const DOOR_OUTSIDE: [number, number] = [-6.55, 4.00]
/** Just inside the threshold. */
export const DOOR_INSIDE: [number, number] = [-4.85, 3.90]

// ── Who is where ─────────────────────────────────────────────────────────────

export interface Placement { x: number; z: number; facing: number }

const placements = new Map<string, Placement>()

export function reportPlacement(id: string, p: Placement): void {
  placements.set(id, p)
}
export function placementOf(id: string): Placement | undefined {
  return placements.get(id)
}
export function forgetPlacement(id: string): void {
  placements.delete(id)
}

/** Everyone currently on stage. Live view — do not retain across frames. */
export function allPlacements(): ReadonlyMap<string, Placement> {
  return placements
}

/**
 * A spot to stand in front of `id`, at conversational distance, offset so the
 * two figures are face to face rather than overlapping. Falls back to the desk
 * when the target is not on stage yet.
 */
export function meetingSpotFor(id: string, distance = 0.95): [number, number] {
  const p = placements.get(id)
  if (!p) {
    const d = STATIONS.desk.stand
    return [d[0] - distance, d[1]]
  }
  // Stand in front of where they are facing.
  return [p.x + Math.sin(p.facing) * distance, p.z + Math.cos(p.facing) * distance]
}
