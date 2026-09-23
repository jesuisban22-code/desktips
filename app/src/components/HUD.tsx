/**
 * HUD.tsx — everything drawn over the room: the counters along the top, the
 * log of what actually happened, and the assistant badges.
 *
 * Design rule, learned by looking at the thing running full-screen on a real
 * machine: the room is warm, so the overlay is warm too. The counters used to
 * be blue, orange, violet and green — four saturated hues from four different
 * families, sitting on top of an amber room. It read as a debug overlay bolted
 * onto an illustration.
 *
 * So colour here now means exactly one thing: WHICH ASSISTANT. Claude's blue
 * and Codex's green earn their saturation because they tell two agents apart.
 * Everything else — labels, figures, timestamps, rules — is the room's own
 * cream at different weights, and separates by value, not hue.
 */

import { useStore } from "../store"
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { globalLag } from "../anim/queue"
import { Timeline, elapsedLabel } from "./Timeline"
import { assistantFor } from "../anim/assistants"
import { bareToolName } from "../anim/stations"
import { INK, fmtNum } from "../ui/ink"
import { Icon } from "../ui/icons"
import { statusLook } from "../ui/status"
import { useSettings } from "../ui/settings"
import { toggleWidget } from "../ui/widget"
import { AttentionBanner } from "./AttentionBanner"
import { AgentCard } from "./AgentCard"
import { BriefPanel } from "./BriefPanel"
import { Journal } from "./Journal"
import { SettingsPanel } from "./SettingsPanel"
import { Toast } from "./Toast"
import { UpdateDialog } from "./UpdateDialog"

/**
 * The queue is deliberately outside React state, so the HUD polls it a few
 * times a second rather than subscribing. Showing the backlog honestly matters:
 * when events outrun the animation the room IS behind, and saying so is better
 * than silently pretending the figures are current.
 */
function useLag() {
  const [lag, setLag] = useState({ seconds: 0, depth: 0, collapsed: 0 })
  useEffect(() => {
    const id = setInterval(() => setLag(globalLag()), 400)
    return () => clearInterval(id)
  }, [])
  return lag
}

/**
 * Which assistants are on stage. Bureau watches Claude, Codex, Gemini, Copilot,
 * Cursor and Cline; showing only a session id would leave you guessing which
 * of them the room is currently depicting.
 */
function SourceBadges() {
  const sessions = useStore(s => s.sessions)
  const ignored  = useStore(s => s.ignored)
  const agents   = useStore(s => s.agents)
  // An assistant with a figure on stage already has its own badge, in its own
  // colour; a second pill saying the same name only crowded the bar off the
  // edge of the window.
  const onStage = new Set(Array.from(agents.values(), a => a.source))
  const active  = Object.keys(sessions).filter(src => !onStage.has(src))
  if (active.length === 0 && ignored === 0) return null

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {active.map(src => {
        const a = assistantFor(src)
        return (
          <div
            key={src}
            title={`session ${sessions[src].slice(0, 8)}`}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 999,
              background: "rgba(205,176,128,0.05)",
              border: `1px solid ${a.color}3a`,
              fontFamily: INK.mono, fontSize: 11, color: INK.body,
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: a.color, boxShadow: `0 0 5px ${a.color}`,
            }} />
            {a.label}
          </div>
        )
      })}
      {ignored > 0 && (
        <span
          title={`${ignored} événements d'autres conversations écartés`}
          style={{ color: INK.ghost, fontFamily: INK.mono, fontSize: 10.5 }}
        >
          {ignored} écartés
        </span>
      )}
    </div>
  )
}

/**
 * Only speaks up when the room is genuinely behind. It used to appear at a
 * fifth of a second of lag — which is every single burst — so the finished app
 * permanently wore a line of diagnostics across its top edge.
 */
function LagBadge() {
  const { seconds, depth, collapsed } = useLag()
  if (seconds < 6) return null

  const hot = seconds > 20
  const color = hot ? INK.alarm : "#c8a97e"
  return (
    <div
      title={
        `La pièce a ${depth} événement(s) de retard sur le journal` +
        (collapsed > 0 ? `, et ${collapsed} gestes ont été fondus pour rattraper.` : ".")
      }
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "3px 10px", borderRadius: 999,
        background: "rgba(205,176,128,0.05)",
        border: `1px solid ${color}3a`,
        fontFamily: INK.mono, fontSize: 11, color,
      }}
    >
      <span style={{ opacity: 0.7 }}>la pièce a</span>
      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {seconds.toFixed(0)} s
      </span>
      <span style={{ opacity: 0.7 }}>de retard</span>
    </div>
  )
}

export function HUD() {
  const widget = useStore(s => s.widget)
  return widget ? <WidgetHUD /> : <FullHUD />
}

function FullHUD() {
  const agents   = useStore(s => s.agents)
  const totalEvt = useStore(s => s.totalEvt)
  // Shallow: a fresh object from the selector every render would loop forever
  // under zustand 5.
  const show     = useSettings(useShallow(s => ({ brief: s.showBrief, journal: s.showJournal, timeline: s.showTimeline, stats: s.showStats })))
  const settingsOpen = useSettings(s => s.panelOpen)
  const openPanel    = useSettings(s => s.openPanel)
  // The side panels sit on the timeline when there is one, on the edge when not.
  const bottom = show.timeline ? 58 : 14

  const totalIn  = Array.from(agents.values()).reduce((s, a) => s + a.totalInput,  0)
  const totalOut = Array.from(agents.values()).reduce((s, a) => s + a.totalOutput, 0)
  const cacheRead = useStore(s =>
    s.events.reduce((n, e) => n + (e.usage?.cache_read ?? 0), 0))

  // Session clock, from the first agent that appeared.
  const startedAt = Array.from(agents.values())
    .reduce((min, a) => Math.min(min, a.startedAt || Date.now()), Date.now())
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        display: "flex", alignItems: "center", gap: 18,
        padding: "9px 18px 11px",
        // A gradient instead of a hairline border: a 1 px rule across the top
        // of an illustration cuts it in half. This just fades out.
        background: "linear-gradient(to bottom, rgba(18,12,5,0.94) 0%, rgba(18,12,5,0.74) 62%, rgba(18,12,5,0) 100%)",
        zIndex: 10,
        pointerEvents: "none",
      }}>
        <span style={{
          color: INK.bright, fontWeight: 600, fontSize: 14, letterSpacing: 3.2,
          fontFamily: "Georgia, 'Iowan Old Style', serif",
        }}>
          BUREAU
        </span>

        {show.stats && <>
          <Rule />
          <Stat label="reçus"  value={fmtNum(totalIn)} />
          <Stat label="écrits" value={fmtNum(totalOut)} />
          <Stat label="cache"  value={fmtNum(cacheRead)} />
          <Stat label="gestes" value={String(totalEvt)} />
          <Stat label="durée"  value={agents.size > 0 ? elapsedLabel(startedAt) : "—"} />
        </>}

        <div style={{ flex: 1 }} />

        {/* The badges give way when the window is narrow; the widget button
            never does — it is the way out of a crowded window. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          pointerEvents: "auto", minWidth: 0, overflow: "hidden",
        }}>
          <SourceBadges />
          <LagBadge />
          {Array.from(agents.values()).map(a => (
            <AgentBadge key={a.id} agent={a} />
          ))}
        </div>
        <Rule />
        <div style={{ display: "flex", gap: 6, pointerEvents: "auto", flex: "0 0 auto" }}>
          <button
            type="button"
            className="bar-btn"
            onClick={() => void toggleWidget()}
            title="Mode widget : petit, sans bordure, toujours au premier plan"
          >
            <Icon name="widget" size={13} />
            Widget
          </button>
          <button
            type="button"
            className="bar-btn"
            data-on={settingsOpen ? "1" : "0"}
            aria-expanded={settingsOpen}
            onClick={() => openPanel(!settingsOpen)}
            title="Paramètres"
          >
            <Icon name="gear" size={13} />
            Paramètres
          </button>
        </div>
      </div>

      <AttentionBanner />
      <AgentCard />
      {show.brief && <BriefPanel bottom={bottom} />}
      {show.journal && <Journal bottom={bottom} />}
      <SettingsPanel bottom={bottom} />
      <UpdateDialog />
      <Toast />

      <Timeline />
    </>
  )
}

const pillButton: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "3px 10px",
  background: "rgba(205,176,128,0.05)",
  borderRadius: 999,
  border: `1px solid ${INK.rule}`,
  color: INK.body,
  fontFamily: INK.mono, fontSize: 11,
  cursor: "pointer",
}

/**
 * The widget's whole overlay: a bar thin enough to leave the room visible,
 * which is also the handle to drag the borderless window by. Everything else
 * — counters, journal, timeline — is for the full window.
 */
function WidgetHUD() {
  const agents = useStore(s => s.agents)
  const setFocus = useStore(s => s.setFocus)
  return (
    <>
      <div
        data-tauri-drag-region
        style={{
          position: "fixed", top: 0, left: 0, right: 0, height: 26,
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 4px 0 10px",
          background: "linear-gradient(to bottom, rgba(18,12,5,0.95), rgba(18,12,5,0.70))",
          borderBottom: `1px solid ${INK.rule}`,
          zIndex: 12,
          userSelect: "none",
        }}
      >
        <span data-tauri-drag-region style={{
          color: INK.bright, fontWeight: 600, fontSize: 11, letterSpacing: 2.6, fontFamily: INK.serif,
        }}>
          BUREAU
        </span>
        {Array.from(agents.values()).map(a => {
          const [dot] = statusLook(a.status, assistantFor(a.source).color)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setFocus({ kind: "agent", id: a.id })}
              title={a.label}
              style={{
                width: 16, height: 16, padding: 0, border: "none", background: "none", cursor: "pointer",
                display: "grid", placeItems: "center",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: `0 0 5px ${dot}` }} />
            </button>
          )
        })}
        <span data-tauri-drag-region style={{ flex: 1, alignSelf: "stretch" }} />
        <button
          type="button"
          onClick={() => void toggleWidget()}
          title="Revenir à la grande fenêtre"
          aria-label="Agrandir"
          style={{ ...pillButton, padding: "1px 8px", fontSize: 12 }}
        >
          ⤢
        </button>
      </div>
      <AttentionBanner compact />
      <AgentCard compact />
      <UpdateDialog />
      <Toast compact />
    </>
  )
}

function Rule() {
  return (
    <span style={{
      width: 1, height: 17, background: INK.rule, flex: "0 0 auto",
    }} />
  )
}

/**
 * Label and figure on one line, not stacked. Stacked, five of them made a row
 * of tiny two-storey blocks that nothing lined up with.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    // Never wraps: "19 k" broke into "19" over "k" once the badges filled the bar.
    <span style={{
      display: "flex", alignItems: "baseline", gap: 6, fontFamily: INK.mono,
      whiteSpace: "nowrap", flex: "0 0 auto",
    }}>
      <span style={{ fontSize: 11.5, color: INK.faint, fontFamily: INK.sans }}>{label}</span>
      <span style={{
        fontSize: 13, color: INK.bright, fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </span>
  )
}

function AgentBadge({ agent }: { agent: import("../types").AgentState }) {
  const tint = assistantFor(agent.source).color
  const [dot, word] = statusLook(agent.status, tint)
  const setFocus = useStore(s => s.setFocus)
  const focused = useStore(s => s.focus?.kind === "agent" && s.focus.id === agent.id)
  return (
    <button
      type="button"
      onClick={() => setFocus(focused ? null : { kind: "agent", id: agent.id })}
      title={`${agent.label} — ${word}. Clique pour le suivre.`}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "3px 10px",
        background: focused ? "rgba(205,176,128,0.14)" : "rgba(205,176,128,0.05)",
        borderRadius: 999,
        border: `1px solid ${agent.attention ? INK.wait : tint}${agent.attention ? "99" : "3a"}`,
        fontFamily: INK.mono,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: dot, boxShadow: `0 0 5px ${dot}`,
      }} />
      <span style={{ color: INK.body, fontSize: 11 }}>{agent.label}</span>
      {agent.currentTool && (
        <span style={{
          color: INK.faint, fontSize: 10.5,
          maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis",
        }}>{bareToolName(agent.currentTool)}</span>
      )}
      <span style={{ color: INK.ghost, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
        {elapsedLabel(agent.lastSeenAt)}
      </span>
    </button>
  )
}
