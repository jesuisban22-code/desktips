/**
 * AgentCard.tsx — what one figure has been doing, when you click it.
 *
 * The room shows the shape of the work; the journal shows every event for
 * everyone. This is the middle: one agent, what it is on now, which tools it
 * reaches for, and its last few moves — enough to answer "what is that one
 * doing?" without reading the whole log.
 */

import { useMemo } from "react"
import { useStore } from "../store"
import { INK, fmtNum } from "../ui/ink"
import { panelFrame } from "../ui/Panel"
import { statusLook } from "../ui/status"
import { assistantFor } from "../anim/assistants"
import { bareToolName, STATIONS, stationForTool } from "../anim/stations"
import { Icon, STATION_COLOR, STATION_ICON, type IconName } from "../ui/icons"
import { elapsedLabel } from "./Timeline"
import type { Evt } from "../types"

const PHRASE = {
  permission: "attend ton autorisation",
  question:   "te pose une question",
  idle:       "attend ta réponse",
} as const

function line(e: Evt): string {
  const k = e.kind
  switch (k.t) {
    case "tool_start": return `${bareToolName(k.name)}${k.hint ? " · " + k.hint : ""}`
    case "thinking":   return "Réflexion"
    case "text":       return `Rédaction · ${k.chars} car.`
    case "error":      return k.message
    case "attention":  return `${PHRASE[k.reason]}${k.detail ? " · " + k.detail : ""}`
    case "prompt":     return `« ${k.text} »`
    default:           return ""
  }
}

function lineIcon(e: Evt): [IconName, string] {
  const k = e.kind
  switch (k.t) {
    case "tool_start": {
      const st = stationForTool(k.name)
      return [STATION_ICON[st], STATION_COLOR[st]]
    }
    case "thinking":  return ["spark", "#9b7fb8"]
    case "text":      return ["lines", "#8fae72"]
    case "error":     return ["alert", INK.alarm]
    case "attention": return ["hand", INK.wait]
    default:          return ["bubble", INK.bright]
  }
}

export function AgentCard({ compact = false }: { compact?: boolean }) {
  const focus    = useStore(s => s.focus)
  const agents   = useStore(s => s.agents)
  const events   = useStore(s => s.events)
  const setFocus = useStore(s => s.setFocus)

  const agent = focus?.kind === "agent" ? agents.get(focus.id) : undefined

  const recent = useMemo(() => {
    if (!agent) return []
    const out: Evt[] = []
    for (let i = events.length - 1; i >= 0 && out.length < 7; i--) {
      const e = events[i]
      if (`${e.source || "claude"}:${e.agent_id}` !== agent.id) continue
      if (line(e)) out.push(e)
    }
    return out
  }, [agent, events])

  if (!agent) return null

  const a = assistantFor(agent.source)
  const [dot, word] = statusLook(agent.status, a.color)
  const tools = Object.entries(agent.toolCounts).sort((x, y) => y[1] - x[1]).slice(0, compact ? 3 : 5)
  const most = tools[0]?.[1] ?? 1
  const where = agent.currentTool ? STATIONS[stationForTool(agent.currentTool)].label : null

  return (
    <div
      role="dialog"
      aria-label={`Détails de ${agent.label}`}
      style={{
        position: "fixed",
        top: compact ? 30 : 52, left: compact ? 6 : 14,
        width: compact ? "min(270px, calc(100vw - 12px))" : 312,
        zIndex: 11,
        ...panelFrame,
        borderTop: `2px solid ${a.color}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 6px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: `0 0 6px ${dot}` }} />
        <span style={{ color: INK.bright, fontWeight: 600, fontSize: 13 }}>{agent.label}</span>
        <span style={{ color: INK.faint, fontSize: 11 }}>{word}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setFocus(null)}
          title="Revenir à la pièce (Échap)"
          aria-label="Fermer"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: INK.faint, fontSize: 15, lineHeight: 1, padding: "2px 4px",
          }}
        >×</button>
      </div>

      {agent.attention && (
        <div style={{
          margin: "0 10px 6px", padding: "5px 8px", borderRadius: 5,
          background: "rgba(232,176,74,0.10)", border: `1px solid ${INK.wait}44`,
          color: INK.wait, fontSize: 11.5,
        }}>
          {PHRASE[agent.attention.reason]}
          {agent.attention.detail && <span style={{ color: INK.body }}> · {agent.attention.detail}</span>}
        </div>
      )}

      {agent.currentTool && (
        <div style={{ padding: "0 10px 6px", fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ color: INK.faint }}>{where ? `${where} · ` : ""}</span>
          {bareToolName(agent.currentTool)}
          {agent.currentHint && <span style={{ color: INK.faint }}> · {agent.currentHint}</span>}
        </div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4,
        padding: "6px 10px 8px", borderTop: `1px solid ${INK.rule}`, borderBottom: `1px solid ${INK.rule}`,
      }}>
        <Figure label="reçus"  value={fmtNum(agent.totalInput)} />
        <Figure label="écrits" value={fmtNum(agent.totalOutput)} />
        <Figure label="gestes" value={String(agent.evtCount)} />
        <Figure label="depuis" value={elapsedLabel(agent.startedAt)} />
      </div>

      {tools.length > 0 && (
        <div style={{ padding: "7px 10px 6px" }}>
          {tools.map(([name, n]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, margin: "2px 0" }}>
              <span style={{ width: 104, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: STATION_COLOR[stationForTool(name)] }}>
                    <Icon name={STATION_ICON[stationForTool(name)]} size={12} strokeWidth={2} />
                  </span>
                  {name}
                </span>
              </span>
              <span style={{ flex: 1, height: 5, background: "rgba(205,176,128,0.08)", borderRadius: 3 }}>
                <span style={{
                  display: "block", height: "100%", width: `${Math.max(6, (n / most) * 100)}%`,
                  background: a.color, opacity: 0.75, borderRadius: 3,
                }} />
              </span>
              <span style={{ color: INK.bright, fontVariantNumeric: "tabular-nums", minWidth: 24, textAlign: "right" }}>{n}</span>
            </div>
          ))}
        </div>
      )}

      {!compact && recent.length > 0 && (
        <div style={{ borderTop: `1px solid ${INK.rule}`, padding: "5px 0 6px" }}>
          {recent.map(e => (
            <div key={e.id} style={{
              display: "flex", gap: 8, padding: "1px 10px", fontSize: 11,
              color: e.kind.t === "error" ? INK.alarm : INK.body,
            }}>
              <span style={{ color: INK.ghost, fontFamily: INK.mono, fontVariantNumeric: "tabular-nums" }}>
                {new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span style={{ color: lineIcon(e)[1], flex: "0 0 auto", alignSelf: "center" }}>
                <Icon name={lineIcon(e)[0]} size={12} strokeWidth={2} />
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line(e)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9.5, color: INK.faint, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: INK.bright, fontWeight: 600, fontFamily: INK.mono, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  )
}
