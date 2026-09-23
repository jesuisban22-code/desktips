/**
 * daylight.ts — the light in the room follows the real time of day.
 *
 * The room was always a late afternoon. Bureau stays open all day and much of
 * the night, so the windows now go from a cool dawn to a white noon, the late
 * gold the room was designed in, a red sunset and a blue night — with the
 * lamps doing more of the work as the sun does less. The clock on the back
 * wall shows the same hour.
 *
 * Everything is a multiplier on the original look (the 17:30 key is all ones
 * and the original colours), so the scene as designed is still exactly one of
 * the states it passes through.
 *
 *   ?hour=22       fix the hour (decimal hours) — for checks and captures
 *   ?hour=cycle    a whole day in about a minute and a half
 */

import { useEffect, useState } from "react"
import * as THREE from "three"
import { useSettings, type LightMode } from "../ui/settings"

export interface Daylight {
  /** The hour this was computed for, 0–24. */
  hour:     number
  /** Sun (or moon) intensity, as a factor of the designed 2.35. */
  sun:      number
  sunColor: THREE.Color
  /** Tint multiplied into the sky seen through the windows. */
  sky:      THREE.Color
  /** Practical lamps, factor of their designed intensity. */
  lamps:    number
  /** Cool skylight fill and the hemisphere, factors. */
  fill:     number
  hemi:     number
  /** Visible shafts of light, and the dust that floats in them. */
  shaft:    number
  dust:     number
  /** Light spilling in at each window opening. */
  window:   number
  night:    boolean
}

type Key = [hour: number, sun: number, sunColor: string, sky: string, lamps: number,
            fill: number, hemi: number, shaft: number, dust: number, window: number]

// hour  sun   sun colour  sky tint   lamps fill  hemi  shaft dust  window
const KEYS: Key[] = [
  [0,    0.10, "#8ea9d9", "#1b2542", 1.40, 0.55, 0.42, 0.22, 0.00, 0.30],
  [5,    0.10, "#8ea9d9", "#232d4a", 1.40, 0.55, 0.42, 0.22, 0.00, 0.30],
  [6.5,  0.35, "#ffb899", "#8f8aa8", 1.25, 0.70, 0.62, 0.55, 0.35, 0.60],
  [8.5,  0.80, "#ffe6c4", "#d2dcec", 0.75, 1.05, 1.05, 0.95, 0.90, 1.10],
  [12.5, 1.05, "#fff6e8", "#e6f1f8", 0.45, 1.20, 1.22, 1.00, 1.00, 1.25],
  [15.5, 1.02, "#ffe9c2", "#f6f2ea", 0.70, 1.10, 1.10, 1.00, 1.00, 1.10],
  [17.5, 1.00, "#ffd9a0", "#ffffff", 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
  [19.5, 0.62, "#ff9c5e", "#e8a482", 1.20, 0.80, 0.80, 0.90, 0.75, 0.80],
  [21,   0.14, "#8ea9d9", "#2a3452", 1.40, 0.55, 0.45, 0.28, 0.00, 0.35],
  [24,   0.10, "#8ea9d9", "#1b2542", 1.40, 0.55, 0.42, 0.22, 0.00, 0.30],
]

const tmpA = new THREE.Color()
const tmpB = new THREE.Color()

export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++
  const a = KEYS[i], b = KEYS[i + 1]
  const t = (h - a[0]) / Math.max(1e-6, b[0] - a[0])
  // Smoothstep: dawn and dusk ease in and out instead of kinking at the keys.
  const s = t * t * (3 - 2 * t)
  const lerp = (x: number, y: number) => x + (y - x) * s
  const mix = (x: string, y: string) => new THREE.Color().copy(tmpA.set(x)).lerp(tmpB.set(y), s)
  return {
    hour: h,
    sun: lerp(a[1], b[1]),
    sunColor: mix(a[2], b[2]),
    sky: mix(a[3], b[3]),
    lamps: lerp(a[4], b[4]),
    fill: lerp(a[5], b[5]),
    hemi: lerp(a[6], b[6]),
    shaft: lerp(a[7], b[7]),
    dust: lerp(a[8], b[8]),
    window: lerp(a[9], b[9]),
    night: h < 6 || h >= 20.5,
  }
}

function urlHour(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("hour")
}

/** `?hour=` first, then the settings panel, then the clock. */
function lightMode(): { mode: LightMode; hour: number } {
  const q = urlHour()
  if (q === "cycle") return { mode: "cycle", hour: 0 }
  if (q !== null && q !== "" && !Number.isNaN(Number(q))) return { mode: "fixed", hour: Number(q) }
  const s = useSettings.getState()
  return { mode: s.light, hour: s.hour }
}

/** The hour the room should show now. */
export function currentHour(): number {
  const { mode, hour } = lightMode()
  if (mode === "cycle") return ((performance.now() / 1000) * (24 / 90)) % 24
  if (mode === "fixed") return hour
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}

/**
 * Recomputed every half minute — the light changes by the hour, there is no
 * point doing it per frame — or quickly in `cycle` mode.
 */
export function useDaylight(): Daylight {
  const [day, setDay] = useState(() => daylightAt(currentHour()))
  // Changed in the settings: relit at once, not at the next half minute.
  const light = useSettings(s => s.light)
  const hour  = useSettings(s => s.hour)
  useEffect(() => {
    setDay(daylightAt(currentHour()))
    const every = lightMode().mode === "cycle" ? 120 : 30_000
    const id = setInterval(() => setDay(daylightAt(currentHour())), every)
    return () => clearInterval(id)
  }, [light, hour])
  return day
}
