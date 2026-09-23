import { create } from "zustand"
import { AgentState, Attention, Evt, EvtKind, TodoItem, WatchStatus } from "./types"
import { pushEvent, resetQueues } from "./anim/queue"
import { assistantFor } from "./anim/assistants"
import { stationForTool, bareToolName } from "./anim/stations"
import { failed, newSheet } from "./anim/workshop"

/** What the chalkboard shows: the last request, and what has been done since. */
export interface Brief {
  source: string
  text:   string
  at:     number
  /** Tool calls since the request, by the kind of furniture they send you to. */
  tally:  { read: number; write: number; run: number; web: number; other: number; errors: number }
}

/** What the camera is looking at, if anything in particular. `point` is for
 *  the checks (?debug: window.__look) — a close look at any corner. */
export type Focus =
  | { kind: "agent"; id: string }
  | { kind: "board" }
  | { kind: "point"; at: [number, number, number]; zoom: number }
  | null

interface BureauStore {
  agents:   Map<string, AgentState>
  events:   Evt[]           // ring buffer, max 500
  totalEvt: number
  /** The session being followed, per assistant. Following a single global
   *  session would hide every other AI the moment Claude was active. */
  sessions: Record<string, string>
  /** Events seen from sessions we are not following. */
  ignored:  number

  /** What the watcher found on disk, and anything it wants to say. */
  status:   WatchStatus | null
  notes:    string[]

  brief:    Brief | null
  /** The assistant's own task list, per assistant, when it keeps one. */
  todos:    Record<string, TodoItem[]>

  focus:    Focus
  /** Small, borderless, always on top. */
  widget:   boolean
  /** A one-line message that fades on its own: something the person tried
   *  did not work, and saying nothing would look like a dead button. */
  toast:    { text: string; at: number } | null

  ingestEvt:   (evt: Evt) => void
  setStatus:   (s: WatchStatus) => void
  addNote:     (m: string) => void
  /** Remove a sub-agent once it has walked back out through the door. */
  retireAgent: (id: string) => void
  setFocus:    (f: Focus) => void
  setWidget:   (on: boolean) => void
  showToast:   (text: string) => void
}

/**
 * `null` means "leave the status alone". A tool finishing says nothing about
 * what the agent is doing next, and now that tool_end actually fires (it never
 * used to — results arrive on user turns, which the parser used to discard),
 * repainting on every one of them made agents strobe.
 */
function kindToStatus(kind: EvtKind): AgentState["status"] | null {
  switch (kind.t) {
    case "thinking":   return "thinking"
    case "text":       return "writing"
    case "tool_start": return "tool"
    case "turn_end":   return "idle"
    case "error":      return "error"
    case "attention":  return "waiting"
    case "prompt":     return "busy"
    case "tool_end":   return null
    default:           return "busy"
  }
}

/** Tools that stop and wait for the person: the transcript shows these
 *  without any hook, because the question itself is a tool call. */
function questionFrom(kind: EvtKind): Omit<Attention, "since"> | null {
  if (kind.t !== "tool_start") return null
  switch (bareToolName(kind.name)) {
    case "AskUserQuestion": return { reason: "question", detail: kind.hint || "une question" }
    case "ExitPlanMode":    return { reason: "question", detail: "plan à valider" }
    default:                return null
  }
}

/** A request older than this is not worth waving about on startup: the
 *  session it belonged to has most likely been closed. */
const STALE_ATTENTION_MS = 60 * 60 * 1000
/** An error older than this is history, not news: no red lamp for it. */
const FRESH_ERROR_MS = 60 * 1000

const EMPTY_TALLY: Brief["tally"] = { read: 0, write: 0, run: 0, web: 0, other: 0, errors: 0 }

function tallyKey(toolName: string): keyof Brief["tally"] {
  switch (stationForTool(toolName)) {
    case "cabinet":   return "read"
    case "drafting":  return "write"
    case "workbench": return "run"
    case "bookshelf": return "web"
    default:          return "other"
  }
}

/** `?debug` exposes the store for the headless end-to-end checks. Publishing a
 *  read-only getter costs nothing and is the only way to assert that events
 *  actually reached the room rather than being dropped on the way. */
function publishForTests(get: () => BureauStore) {
  if (typeof window === "undefined") return
  if (!new URLSearchParams(window.location.search).has("debug")) return
  // Lets the headless checks drive the panels that only the Rust side can
  // normally populate.
  ;(window as unknown as { __bureauSetStatus?: unknown }).__bureauSetStatus =
    (st: unknown) => useStore.getState().setStatus(st as never)
  ;(window as unknown as { __bureauIngest?: unknown }).__bureauIngest =
    (e: Evt) => useStore.getState().ingestEvt(e)
  ;(window as unknown as { __look?: unknown }).__look =
    (x: number, y: number, z: number, zoom = 3) =>
      useStore.getState().setFocus({ kind: "point", at: [x, y, z], zoom })
  ;(window as unknown as { __bureauStore?: unknown }).__bureauStore = () => {
    const s = get()
    return {
      agents:     Object.fromEntries([...s.agents].map(([k, v]) => [k, v.status])),
      attention:  Object.fromEntries([...s.agents].filter(([, v]) => v.attention).map(([k, v]) => [k, v.attention])),
      eventCount: s.totalEvt,
      ignored:    s.ignored,
      sessions:   s.sessions,
      brief:      s.brief,
      todos:      s.todos,
      focus:      s.focus,
      widget:     s.widget,
    }
  }
}

let slotCounter = 0
/** Sub-agents are numbered per assistant: "Claude ·1", "Claude ·2". The global
 *  slot counter this used to borrow skipped numbers every time a main figure
 *  or another assistant's agent came in between. */
const subCounter: Record<string, number> = {}

export const useStore = create<BureauStore>((set, get) => {
  publishForTests(get)
  return {
  agents:   new Map(),
  events:   [],
  totalEvt: 0,
  sessions: {},
  ignored:  0,
  status:   null,
  notes:    [],
  brief:    null,
  todos:    {},
  focus:    null,
  widget:   false,
  toast:    null,

  setStatus(status: WatchStatus) { set({ status }) },
  addNote(m: string) { set(st => ({ notes: [...st.notes, m].slice(-6) })) },
  setFocus(focus: Focus) { set({ focus }) },
  setWidget(widget: boolean) { set({ widget }) },
  showToast(text: string) { set({ toast: { text, at: Date.now() } }) },

  ingestEvt(evt: Evt) {
    // Follow ONE session. Sub-agents share their parent's sessionId (their own
    // identity is in agentId), so this keeps a run together while keeping a
    // second Claude Code window's agents out of the same room. The newest
    // event wins: start working in another session and the room follows you.
    {
      const st = get()
      const src = evt.source || "claude"
      const following = st.sessions[src]
      if (evt.session_id) {
        if (!following) {
          set({ sessions: { ...st.sessions, [src]: evt.session_id } })
        } else if (evt.session_id !== following) {
          // Newest activity wins, but only within this assistant: Claude
          // switching conversations must not evict Codex from the room.
          const newestForSrc = st.events
            .filter(e => (e.source || "claude") === src)
            .reduce((m, e) => Math.max(m, e.at), 0)
          if (evt.at >= newestForSrc) {
            // Beats still owed to the old session would play on the new one.
            resetQueues(src)
            const agents = new Map(
              Array.from(st.agents).filter(([, a]) => a.source !== src),
            )
            const focus = st.focus?.kind === "agent" && !agents.has(st.focus.id) ? null : st.focus
            const todos = { ...st.todos }
            delete todos[src]
            set({
              sessions: { ...st.sessions, [src]: evt.session_id },
              agents,
              events: st.events.filter(e => (e.source || "claude") !== src),
              brief: st.brief?.source === src ? null : st.brief,
              todos,
              focus,
            })
          } else {
            set({ ignored: st.ignored + 1 })
            return
          }
        }
      }
    }

    const src = evt.source || "claude"
    // Every assistant has an agent called "main"; without a namespace they
    // would all drive the same figure.
    const key = `${src}:${evt.agent_id}`

    // A request that something newer has already answered is history. This is
    // what keeps a startup replay from waving about a dialog closed an hour ago:
    // the hook's line and the transcript's answer come from different files, in
    // no guaranteed order.
    if (evt.kind.t === "attention") {
      const known = get().agents.get(key)
      if ((known?.lastEvt && known.lastEvt.at > evt.at)
          || Date.now() - evt.at > STALE_ATTENTION_MS) {
        return
      }
    }

    // The animation queue lives outside React on purpose — it changes at event
    // rate and is read at frame rate, so routing it through state would
    // re-render the scene graph dozens of times a second for no visual gain.
    pushEvent(evt)

    // The two things in the room no figure acts out. A new request files the
    // drawing in progress; a failure lights the lamp over the door — but not
    // for one replayed from an hour ago as the window opens.
    if (evt.kind.t === "prompt") newSheet()
    if (evt.kind.t === "error" && Date.now() - evt.at < FRESH_ERROR_MS) failed()

    set(state => {
      const agents = new Map(state.agents)
      const existing = agents.get(key)

      const attention = nextAttention(existing?.attention, evt)
      const base = kindToStatus(evt.kind) ?? existing?.status ?? "busy"
      // Waiting is a fact about the attention flag, not about the last event:
      // an answered question must not leave the figure marked as waiting.
      const status = attention ? "waiting" : base === "waiting" ? "busy" : base
      const currentTool = evt.kind.t === "tool_start" ? evt.kind.name : existing?.currentTool
      const currentHint = evt.kind.t === "tool_start" ? evt.kind.hint : existing?.currentHint

      const toolCounts = { ...(existing?.toolCounts ?? {}) }
      if (evt.kind.t === "tool_start") {
        const n = bareToolName(evt.kind.name)
        toolCounts[n] = (toolCounts[n] ?? 0) + 1
      }

      if (!existing) {
        // A sub-agent implies a parent. In a real transcript the sub-agent's
        // first line can land before the main agent has done anything Bureau
        // records, and then the entrance walk and the folder handoff are aimed
        // at a figure that does not exist — the sub-agent comes through the
        // door and hands its work to nobody. So the parent is created first.
        const mainKey = `${src}:main`
        if (evt.is_subagent && !agents.has(mainKey)) {
          agents.set(mainKey, {
            id:          mainKey,
            source:      src,
            label:       assistantFor(src).label,
            isSubagent:  false,
            status:      "busy",
            currentTool: undefined,
            currentHint: undefined,
            totalInput:  0,
            totalOutput: 0,
            startedAt:   evt.at,
            lastSeenAt:  Date.now(),
            lastEvt:     evt,
            slot:        slotCounter++,
            toolCounts:  {},
            evtCount:    0,
          })
        }

        const n = evt.is_subagent ? (subCounter[src] = (subCounter[src] ?? 0) + 1) : 0
        agents.set(key, {
          id:          key,
          source:      src,
          label:       evt.is_subagent
            ? `${assistantFor(src).label} ·${n}`
            : assistantFor(src).label,
          isSubagent:  evt.is_subagent,
          status,
          currentTool,
          currentHint,
          totalInput:  evt.usage?.input  ?? 0,
          totalOutput: evt.usage?.output ?? 0,
          startedAt:   evt.at,
          // Wall-clock, not the transcript timestamp: a replayed session
          // carries old timestamps, and idle-exit has to measure real time.
          lastSeenAt:  Date.now(),
          lastEvt:     evt,
          slot:        slotCounter++,
          toolCounts,
          evtCount:    1,
          attention,
        })
      } else {
        agents.set(key, {
          ...existing,
          status,
          currentTool: currentTool ?? existing.currentTool,
          currentHint: currentHint ?? existing.currentHint,
          totalInput:  existing.totalInput  + (evt.usage?.input  ?? 0),
          totalOutput: existing.totalOutput + (evt.usage?.output ?? 0),
          lastSeenAt:  Date.now(),
          // An attention line is the hook's, stamped when the dialog opened;
          // it must not stand in for the transcript's own clock.
          lastEvt:     evt.kind.t === "attention" ? existing.lastEvt : evt,
          toolCounts,
          evtCount:    existing.evtCount + 1,
          attention,
        })
      }

      // Ring buffer: keep last 500 events
      const events = [...state.events, evt].slice(-500)

      return {
        agents, events, totalEvt: state.totalEvt + 1,
        brief: nextBrief(state.brief, evt),
        todos: nextTodos(state.todos, evt),
      }
    })
  },

  retireAgent(id: string) {
    set(state => {
      if (!state.agents.has(id)) return state
      const agents = new Map(state.agents)
      agents.delete(id)
      const focus = state.focus?.kind === "agent" && state.focus.id === id ? null : state.focus
      return { agents, focus }
    })
  },
}
})

/**
 * Whether the agent is still waiting on the person after `evt`.
 *
 * Any later event means they answered: a permission granted runs the tool, a
 * refusal comes back as an error, a question answered comes back as its result.
 */
function nextAttention(current: Attention | undefined, evt: Evt): Attention | undefined {
  if (evt.kind.t === "attention") {
    const { reason, detail } = evt.kind
    // PermissionRequest and the permission notification both fire for the same
    // dialog; the second says less ("Bash" after "Bash · npm test").
    const keep = current && current.reason === reason && current.detail.startsWith(detail)
    return { reason, detail: keep ? current.detail : detail, since: keep ? current.since : evt.at }
  }
  const q = questionFrom(evt.kind)
  if (q) return { ...q, since: evt.at }
  // Strictly later: the other blocks of the very message that asked carry
  // the same timestamp, and must not count as the answer.
  if (current && evt.at > current.since) return undefined
  return current
}

function nextBrief(brief: Brief | null, evt: Evt): Brief | null {
  const src = evt.source || "claude"
  if (evt.kind.t === "prompt") {
    return { source: src, text: evt.kind.text, at: evt.at, tally: { ...EMPTY_TALLY } }
  }
  if (!brief || brief.source !== src || evt.at < brief.at) return brief
  if (evt.kind.t === "tool_start") {
    const k = tallyKey(evt.kind.name)
    return { ...brief, tally: { ...brief.tally, [k]: brief.tally[k] + 1 } }
  }
  if (evt.kind.t === "error") {
    return { ...brief, tally: { ...brief.tally, errors: brief.tally.errors + 1 } }
  }
  return brief
}

function nextTodos(todos: Record<string, TodoItem[]>, evt: Evt): Record<string, TodoItem[]> {
  const op = evt.todo
  if (!op) return todos
  const src = evt.source || "claude"
  const list = todos[src] ?? []
  switch (op.op) {
    case "replace":
      return { ...todos, [src]: op.items }
    case "add":
      return { ...todos, [src]: [...list, { text: op.text, status: "pending" }] }
    case "update": {
      // Claude Code numbers tasks from 1 in the order they were created.
      const i = Number(op.id) - 1
      if (!Number.isInteger(i) || i < 0 || i >= list.length) return todos
      const next = list.slice()
      next[i] = { ...next[i], status: op.status }
      return { ...todos, [src]: next }
    }
  }
}
