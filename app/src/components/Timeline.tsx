/**
 * Timeline.tsx — the strip along the bottom showing what has actually happened.
 *
 * The 3D room shows what an agent is doing *now*; it is deliberately behind
 * when events outrun animation, and it merges bursts. The timeline is the
 * opposite: one mark per real event, in real order, never merged. Between them
 * you can see both the shape of the work and the fact that the room is a
 * dramatisation of it.
 *
 * Two things were wrong when I watched it run full-screen.
 *
 * Marks were left-aligned with a 14 px cap, so on a wide window the right-hand
 * half of the strip was empty and the whole thing read as a progress bar that
 * had broken. Now they hug the RIGHT edge: "now" is a fixed place, and history
 * runs away to the left, which is what a timeline actually does.
 *
 * And the colours were a six-hue rainbow — saturated blue, green, orange,
 * violet, yellow — laid across a warm amber room. They are still six
 * distinguishable colours, but all pulled into the room's own temperature.
 */

import { useMemo } from "react"
import { useStore } from "../store"
import { Evt } from "../types"
import { stationForTool, bareToolName } from "../anim/stations"
import { STATION_COLOR } from "../ui/icons"
import { useSettings } from "../ui/settings"

const THINK = "#9b7fb8"
const WRITE = "#8fae72"
const ERROR = "#e07a52"
const WAIT  = "#e8b04a"
const ASKED = "#ead6b2"

interface Mark {
  id:    string
  color: string
  label: string
  at:    number
  kind:  "tool" | "think" | "write" | "error" | "wait" | "prompt"
}

function toMark(e: Evt): Mark | null {
  switch (e.kind.t) {
    case "tool_start":
      return {
        id: e.id, at: e.at, kind: "tool",
        color: STATION_COLOR[stationForTool(e.kind.name)],
        label: e.kind.hint ? `${bareToolName(e.kind.name)} · ${e.kind.hint}` : bareToolName(e.kind.name),
      }
    // The two moments that involve the person: what they asked, and when they
    // were asked for something back. Full height, so the strip reads as turns.
    case "prompt":
      return { id: e.id, at: e.at, kind: "prompt", color: ASKED, label: `demande · ${e.kind.text}` }
    case "attention":
      return { id: e.id, at: e.at, kind: "wait", color: WAIT,
               label: `attend · ${e.kind.detail || e.kind.reason}` }
    case "thinking":
      return { id: e.id, at: e.at, kind: "think", color: THINK, label: "réflexion" }
    case "text":
      return { id: e.id, at: e.at, kind: "write", color: WRITE,
               label: `rédaction · ${e.kind.chars} car.` }
    case "error":
      return { id: e.id, at: e.at, kind: "error", color: ERROR,
               label: `erreur · ${e.kind.message}` }
    default:
      return null
  }
}

const HEIGHT: Record<Mark["kind"], number> = {
  prompt: 26, wait: 26, error: 26, tool: 19, write: 13, think: 9,
}

export function Timeline() {
  const events = useStore(s => s.events)
  const show   = useSettings(s => s.showTimeline)

  // Only the tail is legible at this width; older marks would be sub-pixel.
  const marks = useMemo(() => {
    const out: Mark[] = []
    for (let i = events.length - 1; i >= 0 && out.length < 150; i--) {
      const m = toMark(events[i])
      if (m) out.push(m)
    }
    return out.reverse()
  }, [events])

  if (marks.length === 0 || !show) return null

  const span = marks.length > 1 ? marks[marks.length - 1].at - marks[0].at : 0

  return (
    <div style={{
      position: "fixed", left: 14, right: 14, bottom: 12,
      height: 36,
      background: "rgba(22,15,7,0.82)",
      backdropFilter: "blur(7px)",
      border: "1px solid rgba(205,176,128,0.12)",
      borderRadius: 8,
      boxShadow: "0 8px 26px rgba(0,0,0,0.38)",
      overflow: "hidden",
      zIndex: 9,
    }}>
      {/* The baseline the marks stand on. */}
      <div style={{
        position: "absolute", left: 8, right: 8, bottom: 5, height: 1,
        background: "rgba(205,176,128,0.13)",
      }} />

      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
        gap: 2, padding: "0 8px 6px",
      }}>
        {marks.map((m, i) => (
          <div
            key={`${m.id}#${i}`}
            title={`${new Date(m.at).toLocaleTimeString("fr-FR")} — ${m.label}`}
            style={{
              flex: "0 1 9px",
              minWidth: 2,
              height: HEIGHT[m.kind],
              background: m.color,
              opacity: 0.88,
              borderRadius: 1.5,
            }}
          />
        ))}
      </div>

      {/* "Now" is the right-hand edge, and saying so out loud is what stops the
          strip from looking like it stopped halfway. */}
      <div style={{
        position: "absolute", right: 6, top: 5, bottom: 4, width: 1,
        background: "rgba(234,214,178,0.5)",
      }} />

      {span > 4000 && (
        <span style={{
          position: "absolute", left: 10, top: 4,
          fontSize: 9.5, letterSpacing: 0.8,
          color: "#6a5d49",
          fontFamily: "ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace",
        }}>
          {spanLabel(span)}
        </span>
      )}
    </div>
  )
}

function spanLabel(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return `${Math.round(ms / 1000)} dernières secondes`
  if (m < 60) return `${m} dernières minutes`
  const h = ms / 3_600_000
  return `${h.toFixed(1).replace(".", ",")} dernières heures`
}

// ── Per-agent elapsed timer ──────────────────────────────────────────────────

export function elapsedLabel(sinceMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`
  // Past a day, "742h13" is a number, not an answer.
  const d = Math.floor(h / 24)
  return d < 7 ? `${d} j` : "> 1 sem."
}
