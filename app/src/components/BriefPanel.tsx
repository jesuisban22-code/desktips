/**
 * BriefPanel.tsx — the last request, legibly.
 *
 * The chalkboard in the room carries the same words, but at room scale it is a
 * few dozen pixels wide. This is the readable copy, opposite the journal: what
 * was asked, what has been done about it since, and the assistant's own task
 * list item by item. The board icon takes the camera to the chalkboard.
 */

import { useStore } from "../store"
import { INK } from "../ui/ink"
import { Icon, STATION_COLOR, STATION_ICON } from "../ui/icons"
import { IconButton, Panel } from "../ui/Panel"
import { useSettings } from "../ui/settings"
import { elapsedLabel } from "./Timeline"
import type { StationId } from "../anim/stations"
import type { TodoItem } from "../types"

/** Most tasks shown before "+ n autres". */
const MAX_TASKS = 5

type Tally = { read: number; write: number; run: number; web: number; errors: number }

const TALLY: { key: keyof Tally; station: StationId; one: string; many: string }[] = [
  { key: "read",  station: "cabinet",   one: "lecture",   many: "lectures" },
  { key: "write", station: "drafting",  one: "écriture",  many: "écritures" },
  { key: "run",   station: "workbench", one: "commande",  many: "commandes" },
  { key: "web",   station: "bookshelf", one: "recherche", many: "recherches" },
]

function Chip({ color, icon, children }: {
  color: string; icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode
}) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px 2px 6px", borderRadius: 999,
      background: `${color}17`, boxShadow: `inset 0 0 0 1px ${color}2e`,
      color: INK.body, fontSize: 11, whiteSpace: "nowrap",
    }}>
      <span style={{ color }}><Icon name={icon} size={12} strokeWidth={2} /></span>
      {children}
    </span>
  )
}

function TaskRow({ t }: { t: TodoItem }) {
  const done = t.status === "completed"
  const now  = t.status === "in_progress"
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0" }}>
      <span style={{ width: 14, height: 14, marginTop: 1, flex: "0 0 auto", display: "grid", placeItems: "center" }}>
        {done ? (
          <span style={{
            width: 14, height: 14, borderRadius: "50%", display: "grid", placeItems: "center",
            background: "rgba(143,174,114,0.22)", color: "#a9c78c",
          }}>
            <Icon name="check" size={10} strokeWidth={2.6} />
          </span>
        ) : now ? (
          <span className="task-now" style={{
            width: 12, height: 12, borderRadius: "50%",
            border: `2px solid ${INK.wait}`, boxSizing: "border-box",
          }} />
        ) : (
          <span style={{
            width: 12, height: 12, borderRadius: "50%",
            border: `1.5px solid ${INK.ghost}`, boxSizing: "border-box",
          }} />
        )}
      </span>
      <span style={{
        fontSize: 12, lineHeight: 1.35,
        color: done ? INK.ghost : now ? INK.bright : INK.body,
        fontWeight: now ? 600 : 400,
        textDecorationLine: done ? "line-through" : "none",
        textDecorationColor: "rgba(205,176,128,0.35)",
        display: "-webkit-box", WebkitLineClamp: now ? 2 : 1, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {t.text}
      </span>
    </li>
  )
}

export function BriefPanel({ bottom }: { bottom: number }) {
  const brief    = useStore(s => s.brief)
  const allTodos = useStore(s => s.todos)
  const setFocus = useStore(s => s.setFocus)
  const open     = useSettings(s => s.briefOpen)
  const set      = useSettings(s => s.set)

  const todos: TodoItem[] = (brief ? allTodos[brief.source] : Object.values(allTodos)[0]) ?? []
  const live = todos.filter(t => t.status !== "deleted")
  if (!brief && live.length === 0) return null

  const done = live.filter(t => t.status === "completed").length

  // The list is cut around what matters now: the task in progress, and the
  // ones just before and after it, rather than always the first five.
  const nowAt = live.findIndex(t => t.status === "in_progress")
  const firstOpen = live.findIndex(t => t.status !== "completed")
  const anchor = nowAt >= 0 ? nowAt : firstOpen >= 0 ? firstOpen : live.length - 1
  const from = Math.max(0, Math.min(anchor - 1, live.length - MAX_TASKS))
  const shown = live.slice(from, from + MAX_TASKS)
  const hidden = live.length - shown.length

  const chips = brief ? TALLY.filter(t => brief.tally[t.key] > 0) : []
  const pct = live.length ? Math.round((done / live.length) * 100) : 0

  return (
    <Panel
      title="Demande en cours"
      icon="bubble"
      meta={brief ? `il y a ${elapsedLabel(brief.at)}` : undefined}
      open={open}
      onToggle={() => set({ briefOpen: !open })}
      actions={<IconButton icon="board" label="Voir l'ardoise dans la pièce" onClick={() => setFocus({ kind: "board" })} />}
      style={{ position: "fixed", left: 14, bottom, width: 360, zIndex: 10 }}
    >
      {brief && (
        <div style={{ display: "flex", gap: 10, padding: "12px 14px 6px" }}>
          <span style={{ color: INK.ghost, marginTop: 2 }}><Icon name="quote" size={14} /></span>
          <p style={{
            margin: 0,
            fontFamily: INK.serif, fontSize: 14, lineHeight: 1.42, color: INK.bright,
            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {brief.text}
          </p>
        </div>
      )}

      {brief && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 14px 12px" }}>
          {chips.map(t => {
            const n = brief.tally[t.key]
            return (
              <Chip key={t.key} color={STATION_COLOR[t.station]} icon={STATION_ICON[t.station]}>
                <b style={{ color: INK.bright, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{n}</b>
                {n > 1 ? t.many : t.one}
              </Chip>
            )
          })}
          {brief.tally.errors > 0 && (
            <Chip color={INK.alarm} icon="alert">
              <b style={{ color: INK.alarm, fontWeight: 600 }}>{brief.tally.errors}</b>
              échec{brief.tally.errors > 1 ? "s" : ""}
            </Chip>
          )}
          {chips.length === 0 && brief.tally.errors === 0 && (
            <span style={{ color: INK.ghost, fontSize: 11.5 }}>Rien de fait pour l’instant</span>
          )}
        </div>
      )}

      {live.length > 0 && (
        <div style={{ padding: "10px 14px 12px", borderTop: `1px solid ${INK.rule}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ color: INK.faint, fontSize: 11.5, fontWeight: 600 }}>Tâches</span>
            <span style={{
              flex: 1, height: 5, borderRadius: 3, overflow: "hidden",
              background: "rgba(205,176,128,0.10)",
            }}>
              <span style={{
                display: "block", height: "100%", borderRadius: 3, width: `${pct}%`,
                background: "linear-gradient(90deg, #b8935c, #e2c28a)",
                transition: "width 0.4s ease",
              }} />
            </span>
            <span style={{ color: INK.bright, fontFamily: INK.mono, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              {done}/{live.length}
            </span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((t, i) => <TaskRow key={from + i} t={t} />)}
          </ul>
          {hidden > 0 && (
            <div style={{ color: INK.ghost, fontSize: 11, paddingLeft: 22, marginTop: 2 }}>
              + {hidden} autre{hidden > 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
