/**
 * Journal.tsx — what actually happened, one line per step.
 *
 * It used to print one line per raw event: the tool starting, then a second
 * line "✓ terminé · 0.4 s" for the same tool, then a third for the next Read
 * of the same file. Half the log was bookkeeping. Now a step is one line: the
 * tool, what it touched, and how it ended, written onto the line it started
 * (the tool_id ties them together). Identical steps in a row fold into "×4".
 */

import { useEffect, useMemo, useRef } from "react"
import { useStore } from "../store"
import type { Evt } from "../types"
import { bareToolName, stationForTool } from "../anim/stations"
import { INK } from "../ui/ink"
import { Icon, STATION_COLOR, STATION_ICON, type IconName } from "../ui/icons"
import { Glyph, Panel } from "../ui/Panel"
import { useSettings } from "../ui/settings"

const THINK = "#9b7fb8"
const WRITE = "#8fae72"

interface Entry {
  key:    string
  at:     number
  kind:   "tool" | "think" | "write" | "error" | "wait" | "prompt" | "turn"
  icon:   IconName
  color:  string
  title:  string
  detail: string
  count:  number
  /** Tools only: still running, finished, or failed (any of a folded run). */
  state?: "run" | "ok" | "fail"
  ms:     number
  /** Folding key: two steps fold when this matches. */
  same:   string
  /** The agent it belongs to. */
  who:    string
}

function turnLabel(reason: string): string {
  switch (reason) {
    case "max_tokens":  return "Coupé : limite de longueur"
    case "interrupted": return "Interrompu"
    case "refusal":     return "Refus"
    default:            return "Tour terminé"
  }
}

function build(events: Evt[], group: boolean): Entry[] {
  const out: Entry[] = []
  const byTool = new Map<string, Entry>()
  const start = Math.max(0, events.length - 160)

  for (let i = start; i < events.length; i++) {
    const e = events[i]
    const k = e.kind
    const who = `${e.source}:${e.agent_id}`
    // Event ids are not unique across a replay; the position makes them so.
    const key = `${e.id}#${i}`
    let next: Entry | null = null

    switch (k.t) {
      case "tool_start": {
        const st = stationForTool(k.name)
        next = {
          key, at: e.at, kind: "tool",
          icon: STATION_ICON[st], color: STATION_COLOR[st],
          title: bareToolName(k.name), detail: k.hint,
          count: 1, state: "run", ms: 0,
          same: `${who}|tool|${k.name}|${k.hint}`, who,
        }
        break
      }
      case "tool_end": {
        const row = byTool.get(`${e.source}:${k.tool_id}`)
        if (row) {
          if (!k.ok) row.state = "fail"
          else if (row.state !== "fail") row.state = "ok"
          row.ms += k.ms
        }
        continue
      }
      case "thinking":
        next = { key, at: e.at, kind: "think", icon: "spark", color: THINK,
                 title: "Réflexion", detail: "", count: 1, ms: 0, same: `${who}|think`, who }
        break
      case "text":
        next = { key, at: e.at, kind: "write", icon: "lines", color: WRITE,
                 title: "Rédaction", detail: `${k.chars.toLocaleString("fr-FR")} car.`,
                 count: 1, ms: k.chars, same: `${who}|text`, who }
        break
      case "error":
        next = { key, at: e.at, kind: "error", icon: "alert", color: INK.alarm,
                 title: "Erreur", detail: k.message, count: 1, ms: 0, same: e.id, who }
        break
      case "attention":
        next = {
          key, at: e.at, kind: "wait", icon: "hand", color: INK.wait,
          title: k.reason === "permission" ? "Autorisation demandée"
               : k.reason === "question"   ? "Question"
               : "Attend ta réponse",
          detail: k.detail, count: 1, ms: 0, same: e.id, who,
        }
        break
      case "prompt":
        next = { key, at: e.at, kind: "prompt", icon: "bubble", color: INK.bright,
                 title: "Ta demande", detail: k.text, count: 1, ms: 0, same: e.id, who }
        break
      case "turn_end":
        if (k.reason === "tool_use") continue
        next = { key, at: e.at, kind: "turn", icon: "check", color: INK.ghost,
                 title: turnLabel(k.reason), detail: "", count: 1, ms: 0, same: "turn", who }
        break
      default:
        continue
    }

    const prev = out[out.length - 1]
    if (prev && next.kind === "turn" && prev.kind === "turn") continue
    if (group && prev && prev.same === next.same && next.kind !== "turn") {
      prev.count++
      prev.at = next.at
      if (next.kind === "write") {
        prev.ms += next.ms
        prev.detail = `${prev.ms.toLocaleString("fr-FR")} car.`
      }
      if (next.kind === "tool") {
        // A new call in the run: the row is running again until it ends.
        if (prev.state !== "fail") prev.state = "run"
        if (k.t === "tool_start") byTool.set(`${e.source}:${k.tool_id}`, prev)
      }
      continue
    }
    out.push(next)
    if (k.t === "tool_start") byTool.set(`${e.source}:${k.tool_id}`, next)
  }
  // Only an agent's latest step can still be under way, and nothing before
  // the end of a turn. An older step whose end never reached us is simply
  // over, not "running" for the rest of the day.
  const seen = new Set<string>()
  let turnOver = false
  for (let j = out.length - 1; j >= 0; j--) {
    const en = out[j]
    if (en.kind === "turn") { turnOver = true; continue }
    if (en.state === "run" && (turnOver || seen.has(en.who))) en.state = undefined
    seen.add(en.who)
  }
  return out.slice(-60)
}

function msLabel(ms: number): string {
  if (ms <= 0) return ""
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`
  return `${Math.round(ms / 60_000)} min`
}

function timeLabel(at: number, seconds: boolean): string {
  return new Date(at).toLocaleTimeString("fr-FR", seconds
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" })
}

function Row({ entry, seconds }: { entry: Entry; seconds: boolean }) {
  if (entry.kind === "turn") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 12px", color: INK.ghost, fontSize: 10.5,
      }}>
        <span style={{ flex: 1, height: 1, background: INK.rule }} />
        {entry.title}
        <span style={{ flex: 1, height: 1, background: INK.rule }} />
      </div>
    )
  }

  const loud = entry.kind === "error" || entry.kind === "wait"
  const prompt = entry.kind === "prompt"
  return (
    <div
      className="journal-row"
      title={`${timeLabel(entry.at, true)} — ${entry.title}${entry.detail ? " · " + entry.detail : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "4px 10px 4px 12px",
        background: loud ? `${entry.color}12` : prompt ? "rgba(234,214,178,0.05)" : undefined,
      }}
    >
      <span style={{
        width: seconds ? 52 : 34, flex: "0 0 auto",
        color: INK.ghost, fontFamily: INK.mono, fontSize: 10.5,
        fontVariantNumeric: "tabular-nums",
      }}>
        {timeLabel(entry.at, seconds)}
      </span>
      <Glyph icon={entry.icon} color={entry.color} size={20} />
      <span style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0, flex: 1 }}>
        <span style={{
          flex: "0 0 auto",
          color: loud ? entry.color : entry.kind === "think" ? INK.faint : INK.bright,
          fontSize: 12, fontWeight: entry.kind === "think" ? 400 : 600,
          fontStyle: entry.kind === "think" ? "italic" : "normal",
        }}>
          {entry.title}
        </span>
        {entry.detail && (
          <span style={{
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: prompt ? INK.body : INK.faint,
            fontFamily: prompt ? INK.sans : INK.mono,
            fontSize: prompt ? 12 : 11,
            fontStyle: prompt ? "italic" : "normal",
          }}>
            {prompt ? `« ${entry.detail} »` : entry.detail}
          </span>
        )}
      </span>
      {entry.count > 1 && (
        <span style={{
          flex: "0 0 auto", padding: "0 6px", borderRadius: 999,
          background: "rgba(205,176,128,0.10)", color: INK.body,
          fontFamily: INK.mono, fontSize: 10, lineHeight: "16px",
        }}>
          ×{entry.count}
        </span>
      )}
      {entry.kind === "tool" && entry.state && <Outcome entry={entry} />}
    </div>
  )
}

function Outcome({ entry }: { entry: Entry }) {
  if (entry.state === "run") {
    return <span className="journal-running" title="en cours" style={{
      width: 6, height: 6, margin: "0 4px", borderRadius: "50%", flex: "0 0 auto",
      background: entry.color,
    }} />
  }
  const fail = entry.state === "fail"
  return (
    <span style={{
      display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto",
      color: fail ? INK.alarm : INK.ghost, fontFamily: INK.mono, fontSize: 10,
    }}>
      {!fail && msLabel(entry.ms)}
      <Icon name={fail ? "x" : "check"} size={12} strokeWidth={2.2} />
    </span>
  )
}

export function Journal({ bottom }: { bottom: number }) {
  const events   = useStore(s => s.events)
  const totalEvt = useStore(s => s.totalEvt)
  const open     = useSettings(s => s.journalOpen)
  const seconds  = useSettings(s => s.seconds)
  const group    = useSettings(s => s.group)
  const set      = useSettings(s => s.set)

  const entries = useMemo(() => build(events, group), [events, group])

  // Follow the bottom, unless the person has scrolled up to read something.
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries, open])

  return (
    <Panel
      title="Journal"
      icon="list"
      meta={totalEvt > 0 ? `${totalEvt.toLocaleString("fr-FR")} gestes` : undefined}
      open={open}
      onToggle={() => set({ journalOpen: !open })}
      style={{ position: "fixed", right: 14, bottom, width: 360, zIndex: 10 }}
    >
      <div
        ref={ref}
        className="bureau-scroll"
        onScroll={e => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        style={{ maxHeight: 232, overflowY: "auto", padding: "4px 0" }}
      >
        {entries.map(en => <Row key={en.key} entry={en} seconds={seconds} />)}
        {entries.length === 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "14px 12px", color: INK.faint, fontSize: 12,
          }}>
            <Icon name="clock" size={14} />
            En attente d’activité…
          </div>
        )}
      </div>
    </Panel>
  )
}
