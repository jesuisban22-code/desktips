/**
 * icons.tsx — the overlay's pictograms, drawn as lines.
 *
 * Emoji came out in whatever colour and weight the system font decided, one
 * per row, and made the panels read like a chat log. These are one stroke
 * weight, take the colour of the text around them, and line up on a grid.
 */

import type { SVGProps } from "react"
import type { StationId } from "../anim/stations"

const PATHS = {
  folder:   "M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
  pen:      "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l3 3",
  terminal: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2.5L7 15M12.5 15H17",
  globe:    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c2.4 2.6 3.5 5.6 3.5 9s-1.1 6.4-3.5 9c-2.4-2.6-3.5-5.6-3.5-9S9.6 5.6 12 3z",
  agent:    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.5 3 5.2",
  bubble:   "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  spark:    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  lines:    "M4 6h16M4 10h16M4 14h10M4 18h7",
  alert:    "M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2v.3",
  hand:     "M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v4.5c0 4-2.7 6.5-6.5 6.5-2.6 0-4.3-1.1-5.8-3.3L5 13.8a1.5 1.5 0 0 1 2.4-1.8L8 13",
  quote:    "M5 18l2.5-6H5V6h6v6l-2.5 6zM14 18l2.5-6H14V6h6v6l-2.5 6z",
  check:    "M5 12.5l4.5 4.5L19 7.5",
  x:        "M6 6l12 12M18 6L6 18",
  chevron:  "M6 9l6 6 6-6",
  gear:     "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.5 7.5 0 0 1-2 1.2L14.8 21h-4l-.3-2.1a7.5 7.5 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-2.9L4.6 9.7l2-3.4 1.9.7a7.5 7.5 0 0 1 2-1.2L10.8 3h4l.3 2.1a7.5 7.5 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 2.9z",
  widget:   "M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12.5 12h6v5h-6z",
  board:    "M4 4h16v11H4zM8 19l2-4M16 19l-2-4M8 8h5M8 11h8",
  list:     "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  clock:    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  wrench:   "M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2zM14.5 6.5l3-3",
  reset:    "M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5",
  eye:      "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  sun:      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
  cube:     "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  power:    "M12 3v8M7 6.2a7.5 7.5 0 1 0 10 0",
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 14, strokeWidth = 1.7, ...rest }:
  { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ flex: "0 0 auto", display: "block" }}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export const STATION_ICON: Record<StationId, IconName> = {
  cabinet:   "folder",
  drafting:  "pen",
  workbench: "terminal",
  bookshelf: "globe",
  door:      "agent",
  desk:      "wrench",
}

/**
 * One colour per piece of furniture, shared with the timeline so a row in the
 * journal and its mark on the strip are visibly the same thing.
 */
export const STATION_COLOR: Record<StationId, string> = {
  cabinet:   "#6f93b8",   // classeur — cool slate
  drafting:  "#7fa471",   // table à dessin — sage
  workbench: "#d89a5a",   // établi — amber
  bookshelf: "#a98bbd",   // bibliothèque — dusty violet
  door:      "#d8bd72",   // porte — brass
  desk:      "#9c8a70",   // bureau — plain
}
