// ── Normalized event type ────────────────────────────────────────────────────
// Must mirror evt.rs exactly (serde_json serialises snake_case by default).

export type EvtKind =
  | { t: "thinking" }
  | { t: "text";       chars: number }
  | { t: "tool_start"; tool_id: string; name: string; hint: string }
  | { t: "tool_end";   tool_id: string; ok: boolean; ms: number }
  | { t: "turn_end";   reason: string }
  | { t: "error";      message: string }
  /** Something the person typed, clipped. */
  | { t: "prompt";     text: string }
  /** The assistant is blocked on the person. Written by bureau-hook, which is
   *  the only thing that sees a dialog: the transcript never records one. */
  | { t: "attention";  reason: AttentionReason; detail: string }
  | { t: "unknown";    raw_kind: string }

export type AttentionReason = "permission" | "question" | "idle"

export interface TodoItem {
  text:   string
  /** "pending", "in_progress" or "completed", as the tool wrote it. */
  status: string
}

/** A change to the assistant's task list. TodoWrite hands over the whole list;
 *  TaskCreate / TaskUpdate edit it one item at a time. */
export type TodoOp =
  | { op: "replace"; items: TodoItem[] }
  | { op: "add";     text: string }
  | { op: "update";  id: string; status: string }

export interface Usage {
  input:       number
  output:      number
  cache_read:  number
  cache_write: number
  thinking:    number
}

export interface Evt {
  /** Which assistant produced this: "claude", "codex", "gemini"… */
  source:      string
  id:          string
  parent_id:   string | null
  session_id:  string
  agent_id:    string
  is_subagent: boolean
  at:          number   // unix ms
  kind:        EvtKind
  usage?:      Usage
  todo?:       TodoOp
}

// ── Agent state (for the 3D scene) ──────────────────────────────────────────

export type AgentStatus = "idle" | "thinking" | "tool" | "writing" | "busy" | "error" | "waiting"

export interface AgentState {
  id:           string
  source:       string
  label:        string
  isSubagent:   boolean
  status:       AgentStatus
  currentTool?: string
  currentHint?: string
  totalInput:   number
  totalOutput:  number
  startedAt:    number
  /** Wall-clock time of the last event, for idle detection. */
  lastSeenAt:   number
  lastEvt?:     Evt
  // position in the room (assigned on creation)
  slot:         number
  /** Every tool this agent has called, counted. Kept apart from the event
   *  ring buffer so a long session does not forget its own history. */
  toolCounts:   Record<string, number>
  /** How many events this agent produced. */
  evtCount:     number
  /** Set while the agent waits on the person; cleared by its next event. */
  attention?:   Attention
}

export interface Attention {
  reason: AttentionReason
  detail: string
  /** Transcript time of the request, to tell a stale one from a live one. */
  since:  number
}

// ── Tool-to-furniture mapping ─────────────────────────────────────────────────

export type Furniture =
  | "filing_cabinet"   // Read, Glob
  | "drafting_table"   // Write, Edit
  | "workbench"        // Bash
  | "bookshelf"        // WebSearch, WebFetch
  | "desk"             // Text, Thinking (main desk)
  | "door"             // Agent spawn / exit
  | "whiteboard"       // TurnEnd, system events

export function toolToFurniture(name: string): Furniture {
  const lower = name.toLowerCase()
  if (["read", "glob", "grep"].some(t => lower.includes(t)))        return "filing_cabinet"
  if (["write", "edit", "notebook"].some(t => lower.includes(t)))   return "drafting_table"
  if (["bash", "execute", "shell"].some(t => lower.includes(t)))    return "workbench"
  if (["web", "fetch", "search"].some(t => lower.includes(t)))      return "bookshelf"
  if (["agent", "task"].some(t => lower.includes(t)))               return "door"
  return "desk"
}


// ── What the watcher found ───────────────────────────────────────────────────
// Mirrors bureau_core::watch::Status.

export interface SourceInfo {
  id:          string
  label:       string
  /** Where Bureau looked. Shown verbatim: "no assistants detected" without
   *  the path is impossible to act on. */
  root:        string
  present:     boolean
  transcripts: number
}

export interface WatchStatus {
  sources:     SourceInfo[]
  /** True while the counts are still being worked out. */
  scanning?:   boolean
  transcripts: number
  /** How many were recent enough to replay. */
  active:      number
  watching:    boolean
}

/** Stamped at build time by vite.config.ts. */
declare const __BUILD_STAMP__: string
export const BUILD_STAMP: string =
  typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "?"
