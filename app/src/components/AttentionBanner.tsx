/**
 * AttentionBanner.tsx — "Claude attend ton autorisation", where you will see it.
 *
 * The figure putting its hand up is the room saying it; this is the overlay
 * saying it in words, with the tool and what it wants to touch. It is the one
 * element of the HUD allowed to be loud, because it is the one moment the
 * person has to act.
 */

import { useEffect, useMemo, useRef } from "react"
import { useStore } from "../store"
import { INK } from "../ui/ink"
import { askForAttention } from "../ui/widget"
import type { AgentState, AttentionReason } from "../types"

const PHRASE: Record<AttentionReason, string> = {
  permission: "attend ton autorisation",
  question:   "te pose une question",
  idle:       "attend ta réponse",
}

const ICON: Record<AttentionReason, string> = {
  permission: "✋",
  question:   "❓",
  idle:       "💬",
}

/** Permission and question outrank idle; older waits outrank newer ones. */
function mostUrgent(agents: Map<string, AgentState>): AgentState | undefined {
  const waiting = [...agents.values()].filter(a => a.attention)
  const rank = (a: AgentState) => (a.attention!.reason === "idle" ? 1 : 0)
  waiting.sort((a, b) => rank(a) - rank(b) || a.attention!.since - b.attention!.since)
  return waiting[0]
}

export function AttentionBanner({ compact = false }: { compact?: boolean }) {
  const agents   = useStore(s => s.agents)
  const setFocus = useStore(s => s.setFocus)
  const agent = useMemo(() => mostUrgent(agents), [agents])
  const att = agent?.attention

  // The taskbar button flashes once per request, not once per render.
  const flashed = useRef("")
  useEffect(() => {
    if (!agent || !att || att.reason === "idle") return
    const key = `${agent.id}@${att.since}`
    if (flashed.current === key) return
    flashed.current = key
    void askForAttention()
  }, [agent, att])

  if (!agent || !att) return null
  const loud = att.reason !== "idle"
  const color = loud ? INK.wait : INK.faint

  return (
    <button
      type="button"
      onClick={() => setFocus({ kind: "agent", id: agent.id })}
      title="Voir qui attend"
      className={loud ? "attention attention-loud" : "attention"}
      style={{
        position: "fixed",
        top: compact ? 30 : 50,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 12,
        display: "flex", alignItems: "baseline", gap: 8,
        maxWidth: compact ? "calc(100vw - 24px)" : 640,
        padding: compact ? "4px 10px" : "6px 14px 7px",
        borderRadius: 999,
        border: `1px solid ${color}66`,
        background: "rgba(30, 20, 8, 0.92)",
        boxShadow: loud ? `0 0 0 1px ${color}22, 0 8px 26px rgba(0,0,0,0.45)` : "0 6px 20px rgba(0,0,0,0.35)",
        color: INK.bright,
        fontFamily: INK.mono, fontSize: compact ? 11 : 12,
        cursor: "pointer",
        whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      <span>{ICON[att.reason]}</span>
      <span style={{ fontWeight: 600, color: loud ? color : INK.body }}>
        {agent.label} {PHRASE[att.reason]}
      </span>
      {att.detail && (
        <span style={{ color: INK.body, overflow: "hidden", textOverflow: "ellipsis" }}>
          · {att.detail}
        </span>
      )}
    </button>
  )
}
