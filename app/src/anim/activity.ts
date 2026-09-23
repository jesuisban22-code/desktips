/**
 * activity.ts — is anything in the room moving?
 *
 * Bureau is a monitor: it sits open all day, and most of the day nothing in it
 * moves. It used to render sixty frames a second regardless — measured at
 * about 4 000 draw calls a frame, with a 2048² sun shadow, a six-face lamp
 * shadow and an AO pass — to repaint a still image.
 *
 * So the canvas renders on demand. Whatever moves says so here: actors while
 * they walk or work, the door while it swings, the camera while it glides. The
 * frame driver renders at full rate while anyone is busy and slows right down
 * when nobody is. Shadow maps follow the same signal: nothing moved, nothing to
 * re-render them for.
 *
 * Like stage.ts this lives outside React: it is written and read every frame.
 */

const busy = new Set<string>()
let wakeUntil = 0

/** An actor says whether it is in motion, every frame it runs. */
export function reportBusy(id: string, isBusy: boolean): void {
  if (isBusy) busy.add(id)
  else busy.delete(id)
}

export function forgetBusy(id: string): void {
  busy.delete(id)
}

/**
 * Keep rendering at full rate for a while: an event just arrived, a panel
 * moved the camera, a figure has just been added and its shadow must be drawn.
 */
export function wake(ms = 700): void {
  wakeUntil = Math.max(wakeUntil, performance.now() + ms)
}

export function stageBusy(): boolean {
  return busy.size > 0 || performance.now() < wakeUntil
}

let glanceUntil = 0
let glanceShadowUntil = 0

/**
 * A small movement (a blink, a stretch at the desk) that wants smooth frames
 * while it lasts but is not activity. Reported as busy, a blink every few
 * seconds would hold the room at its "something just happened" rate for good;
 * as a glance it gets full-rate frames for its fraction of a second and the
 * driver's slow-down carries on where it was. `shadows`: the movement is big
 * enough to show in the shadow maps (a stretch; not a blink).
 */
export function glance(ms: number, shadows = false): void {
  const until = performance.now() + ms
  glanceUntil = Math.max(glanceUntil, until)
  if (shadows) glanceShadowUntil = Math.max(glanceShadowUntil, until)
}

export function glancing(): boolean {
  return performance.now() < glanceUntil
}

export function glanceMovesShadows(): boolean {
  return performance.now() < glanceShadowUntil
}
