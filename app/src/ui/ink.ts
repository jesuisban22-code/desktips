/**
 * ink.ts — the overlay's colours, shared by every panel drawn over the room.
 *
 * The rule (see HUD.tsx): the room is warm, so the overlay is warm too. Colour
 * means WHICH ASSISTANT and nothing else; everything else is the room's cream at
 * different weights. The one exception is a person being needed — waiting and
 * alarm are the only hues allowed to shout.
 */

export const INK = {
  bright: "#ead6b2",   // figures
  body:   "#c3ac86",   // ordinary text
  faint:  "#8d7c62",   // labels
  ghost:  "#6a5d49",   // timestamps, rules
  panel:  "rgba(22, 15, 7, 0.86)",
  rule:   "rgba(205, 176, 128, 0.14)",
  alarm:  "#e07a52",
  /** Waiting on the person: amber, warmer than any assistant's colour. */
  wait:   "#e8b04a",
  mono:   "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace",
  serif:  "Georgia, 'Iowan Old Style', serif",
  /** Words people read: titles, requests, task names. Mono is kept for what
   *  lines up in columns — times, figures, file names. */
  sans:   "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
} as const

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + " M"
  if (n >= 10_000)    return Math.round(n / 1_000) + " k"
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + " k"
  return String(n)
}
