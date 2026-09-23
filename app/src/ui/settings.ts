/**
 * settings.ts — what the person chose in the settings panel.
 *
 * Kept apart from the main store: that one is rebuilt from the transcripts on
 * every launch, this one is the person's and survives restarts (localStorage,
 * which the webview keeps per machine). The URL flags (?fx=0, ?q=low, ?hour=)
 * still win over it, so the automated captures stay reproducible.
 *
 * Starting with Windows and opening with Claude Code are not here: they live
 * outside the window (the autostart plugin, a file the hook reads) and are
 * read from Rust each time the panel opens.
 */

import { create } from "zustand"
import { wake } from "../anim/activity"

export type LightMode = "real" | "fixed" | "cycle"

export interface Settings {
  showBrief:    boolean
  showJournal:  boolean
  showTimeline: boolean
  showStats:    boolean
  /** The speech bubbles over the figures. */
  bubbles:      boolean
  /** Ambient occlusion, bloom and vignette. */
  effects:      boolean
  quality:      "high" | "low"
  light:        LightMode
  /** The hour shown when `light` is "fixed", 0–24. */
  hour:         number
  /** Journal times with seconds. */
  seconds:      boolean
  /** Fold repeated identical steps into one journal line. */
  group:        boolean
  /** Panels folded down to their title bar. */
  briefOpen:    boolean
  journalOpen:  boolean
}

export const DEFAULTS: Settings = {
  showBrief:    true,
  showJournal:  true,
  showTimeline: true,
  showStats:    true,
  bubbles:      true,
  effects:      true,
  quality:      "high",
  light:        "real",
  hour:         15,
  seconds:      true,
  group:        true,
  briefOpen:    true,
  journalOpen:  true,
}

const KEY = "bureau.settings"

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch { /* unreadable or blocked: defaults */ }
  return { ...DEFAULTS }
}

function save(s: Settings) {
  try {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) out[k] = s[k]
    localStorage.setItem(KEY, JSON.stringify(out))
  } catch { /* nothing to do: the choice holds until the window closes */ }
}

/** The bubbles are written straight into the DOM by the actors, so they are
 *  hidden by a rule on the root rather than by React. */
function applyDom(s: Settings) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.bubbles = s.bubbles ? "on" : "off"
}

interface SettingsStore extends Settings {
  panelOpen: boolean
  set:       (patch: Partial<Settings>) => void
  reset:     () => void
  openPanel: (on: boolean) => void
}

export const useSettings = create<SettingsStore>((setState, get) => {
  const initial = load()
  applyDom(initial)
  return {
    ...initial,
    panelOpen: false,
    set: patch => {
      setState(patch)
      const s = get()
      save(s)
      applyDom(s)
      // The canvas only draws when something moves: a changed setting is
      // something moving.
      wake(1500)
    },
    reset: () => {
      setState({ ...DEFAULTS })
      save(DEFAULTS)
      applyDom(DEFAULTS)
      wake(1500)
    },
    openPanel: on => setState({ panelOpen: on }),
  }
})
