/**
 * workshop.ts — what the work leaves behind in the room.
 *
 * The figures show what is being done; the furniture should show what HAS been
 * done. Commands typed at the bench stay on the terminal's screen, every edit
 * adds a few lines to the drawing on the board, a new request files the
 * finished sheet on the pile, the drawer stays out while someone rummages in
 * it, and the lamp over the door says when something failed.
 *
 * Written by the actors as they PLAY beats — so the terminal shows a command
 * when the figure is at the bench typing it, not seconds earlier when the log
 * received it — and by the store for the two things no body acts out: a
 * request arriving, and a tool failing. Read by the props in Workshop.tsx.
 *
 * Like stage.ts it lives outside React: the props poll `version` in their
 * frame loop and redraw only when it moved.
 */

import { wake } from "./activity"

/** Commands kept on the terminal: what fits on its screen. */
const TERMINAL_LINES = 7
/** A drawing is finished long before this many strokes; past it, nothing
 *  new would be visible anyway. */
const MAX_STROKES = 64

export const workshop = {
  /** Bumped on every change a prop may need to redraw for. */
  version:  0,
  commands: [] as string[],
  /** Lines on the sheet currently pinned to the drafting board. */
  strokes:  0,
  /** Sheets finished and filed on the pile. */
  sheets:   0,
  /** Which drawing this is: seeds its composition, so each sheet differs. */
  sheetNo:  1,
  /** Agents working at the cabinet right now: the drawer is out while any is. */
  cabinet:  new Set<string>(),
  /** performance.now() of the last failure. */
  errorAt:  -1e9,
}

// ?debug: read by the headless checks.
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")) {
  ;(window as unknown as { __workshop?: unknown }).__workshop = workshop
}

function changed(ms = 400): void {
  workshop.version++
  wake(ms)
}

/** Commands reach the bench terminal, in the order they were typed. */
export function typed(lines: string[]): void {
  const fresh = lines.map(l => l.trim()).filter(Boolean)
  if (fresh.length === 0) return
  workshop.commands = [...workshop.commands, ...fresh].slice(-TERMINAL_LINES)
  changed()
}

/** Work at the drafting board adds lines to the drawing. */
export function drew(lines: number): void {
  const next = Math.min(MAX_STROKES, workshop.strokes + Math.max(1, lines))
  if (next === workshop.strokes) return
  workshop.strokes = next
  changed()
}

/** A new request: the drawing in progress goes on the pile, a blank sheet
 *  goes up. A sheet nobody drew on stays where it is. */
export function newSheet(): void {
  if (workshop.strokes === 0) return
  workshop.sheets++
  workshop.sheetNo++
  workshop.strokes = 0
  changed(800)
}

export function atCabinet(agentId: string, busy: boolean): void {
  if (busy === workshop.cabinet.has(agentId)) return
  if (busy) workshop.cabinet.add(agentId)
  else workshop.cabinet.delete(agentId)
  changed(900)
}

export function failed(): void {
  workshop.errorAt = performance.now()
  changed(3500)
}
