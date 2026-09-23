import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { Evt, EvtKind, TodoOp, WatchStatus } from "../types"
import { useStore } from "../store"
import { adoptWidget, setWidget, toggleWidget } from "../ui/widget"

/**
 * Subscribe to bureau://evt from the Rust watcher and feed the store.
 *
 * Outside Tauri (plain `vite dev`, or the headless render checks) it falls
 * back to a synthetic stream. That stream is not a gentle demo: it reproduces
 * the burst shape measured on a real session — long runs of the same tool,
 * occasional 10-events-in-a-second spikes, and a sub-agent appearing partway
 * through — because those are exactly the conditions the animation queue
 * exists to survive.
 */
export function useTauriEvents() {
  const ingest    = useStore(s => s.ingestEvt)
  const setStatus = useStore(s => s.setStatus)
  const addNote   = useStore(s => s.addNote)

  useEffect(() => {
    const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== "undefined"

    if (isTauri) {
      const offs: Array<() => void> = []
      let gone = false
      Promise.all([
        listen<Evt>("bureau://evt", e => ingest(e.payload)),
        // What Bureau found, and anything it needs to tell the user — a folder
        // it cannot watch, a new assistant appearing. Without these the room
        // just sits empty and says nothing about why.
        listen<WatchStatus>("bureau://status", e => setStatus(e.payload)),
        listen<string>("bureau://note", e => addNote(e.payload)),
        // The tray's "Mode widget" entry.
        listen("bureau://widget", () => { void toggleWidget() }),
        // A launch or /desktips asking for a given size. `applied`: the shell
        // already shaped the window at startup, only the layout must follow.
        listen<{ on: boolean; applied?: boolean }>("bureau://widget-set", e => {
          if (e.payload.on && e.payload.applied) void adoptWidget()
          else void setWidget(e.payload.on)
        }),
      ]).then(fns => {
        // Unmounted before the listeners were even attached (StrictMode does
        // exactly this in development): detach them, or every event arrives
        // twice for the rest of the session.
        if (gone) { fns.forEach(f => f()); return }
        offs.push(...fns)
        // Only now is it safe for Rust to flush what it read at startup. The
        // watcher runs in setup(), long before this component mounts, and
        // anything it emitted before this point would be dropped on the floor.
        invoke("frontend_ready").catch(() => {})
      })

      // Ask for the survey directly, and keep asking for a little while.
      //
      // The event path and the command path can fail independently: if the
      // engine thread dies, or its first status never reaches the window, the
      // room shows "Bureau démarre…" forever and says nothing about why. This
      // is the second, simpler way to the same answer.
      let tries = 0
      const ask = () => {
        tries++
        invoke<WatchStatus>("bureau_status")
          .then(s => { setStatus(s); clearInterval(poll) })
          .catch(e => {
            if (tries >= 5) {
              clearInterval(poll)
              addNote(`Le moteur n'a pas répondu : ${String(e)}`)
            }
          })
      }
      const poll = setInterval(ask, 2500)
      ask()

      return () => { gone = true; offs.forEach(f => f()); clearInterval(poll) }
    }

    // Replay a real recorded session instead of the synthetic stream. This is
    // how the frontend gets exercised against genuine data — agent ids, burst
    // shapes, error results and all — without needing Claude Code running.
    const params = new URLSearchParams(window.location.search)
    const replayUrl = params.get("replay")
    if (replayUrl) return replayStream(replayUrl, ingest)

    // ?mock=0: an empty room, driven only by what the checks inject.
    if (params.get("mock") === "0") return

    return mockStream(ingest)
  }, [ingest, setStatus, addNote])
}

// ── Replay of a recorded session ─────────────────────────────────────────────

/**
 * Real sessions span hours, most of it waiting. Gaps are scaled down and then
 * hard-capped, so the shape of a burst survives but the dead air does not.
 */
function replayStream(url: string, ingest: (e: Evt) => void): () => void {
  const SCALE = 0.02          // 50× faster than life
  const MAX_GAP = 1400        // no pause longer than this, whatever happened
  let cancelled = false
  let timer: ReturnType<typeof setTimeout>

  fetch(url)
    .then(r => r.json())
    .then((evts: Evt[]) => {
      if (cancelled || !Array.isArray(evts) || evts.length === 0) return
      const dbg = window as unknown as { __replay?: Record<string, number> }
      dbg.__replay = { loaded: evts.length, fired: 0, starts: (dbg.__replay?.starts ?? 0) + 1, delay: 0 }
      let i = 0
      const step = () => {
        if (cancelled || i >= evts.length) return
        const e = evts[i]
        // Stamp with wall-clock so idle detection and timers behave as they
        // would live; the original timestamp stays available on the event.
        ingest({ ...e, source: e.source || "claude", at: Date.now() })
        i++
        dbg.__replay!.fired = i
        if (i >= evts.length) return
        const gap = Math.max(0, evts[i].at - e.at)
        const delay = Math.min(MAX_GAP, Math.max(60, gap * SCALE))
        dbg.__replay!.delay = delay
        timer = setTimeout(step, delay)
      }
      timer = setTimeout(step, 400)
    })
    .catch(err => console.error("[bureau] replay failed:", err))

  return () => { cancelled = true; clearTimeout(timer) }
}

// ── Synthetic stream ─────────────────────────────────────────────────────────

type Script =
  | {
      tool:  string
      hint:  string
      /** How many of this tool fire back to back. */
      run:   number
      /** Milliseconds between events inside the run. */
      gap:   number
      agent?: "main" | "sub" | "codex"
      todo?: TodoOp
    }
  /** The person types a request. */
  | { prompt: string; gap: number }
  /** Claude stops and waits on the person for `hold` ms, then gets its answer. */
  | { ask: "permission" | "question"; detail: string; hold: number; gap: number }

const TODOS = [
  "Lire le watcher et le hook",
  "Corriger le lancement du hook",
  "Ajouter le mode widget",
  "Recompiler et tester",
]
const todoList = (done: number): TodoOp => ({
  op: "replace",
  items: TODOS.map((text, i) => ({
    text, status: i < done ? "completed" : i === done ? "in_progress" : "pending",
  })),
})

const SCRIPT: Script[] = [
  { prompt: "Ajoute un mode widget à Bureau et corrige le hook qui ne se lance jamais", gap: 900 },
  { tool: "Thinking",  hint: "",                    run: 1,  gap: 1400 },
  { tool: "TodoWrite", hint: "4 tâches",            run: 1,  gap: 700, todo: todoList(0) },
  { tool: "Glob",      hint: "src/**/*.rs",         run: 1,  gap: 700  },
  // A realistic read burst: this is the case that used to desynchronise
  // everything, and should now collapse into one trip to the cabinet.
  { tool: "Read",      hint: "watcher.rs",          run: 11, gap: 80   },
  { tool: "Thinking",  hint: "",                    run: 1,  gap: 1200 },
  { tool: "TodoWrite", hint: "4 tâches",            run: 1,  gap: 500, todo: todoList(1) },
  { tool: "Edit",      hint: "bureau-hook.rs",      run: 3,  gap: 260  },
  // The moment the whole attention feature exists for.
  { ask: "permission", detail: "PowerShell · cargo build --release", hold: 6500, gap: 600 },
  { tool: "PowerShell", hint: "cargo build --release", run: 1, gap: 1800 },
  { tool: "mcp__Roblox_Studio__execute_luau", hint: "print(workspace.Name)", run: 1, gap: 1500, agent: "codex" },
  { tool: "WebSearch", hint: "tauri always on top", run: 2,  gap: 900  },
  { tool: "TodoWrite", hint: "4 tâches",            run: 1,  gap: 500, todo: todoList(2) },
  { tool: "Agent",     hint: "review the watcher",  run: 1,  gap: 1500 },
  { tool: "Read",      hint: "lib.rs",              run: 4,  gap: 140, agent: "sub" },
  { tool: "Bash",      hint: "cargo test",          run: 1,  gap: 1200, agent: "sub" },
  { tool: "Write",     hint: "report.md",           run: 2,  gap: 500, agent: "sub" },
  { ask: "question",   detail: "Garder la position du widget entre deux lancements ?", hold: 5000, gap: 600 },
  { tool: "Text",      hint: "",                    run: 1,  gap: 1600 },
  { tool: "Edit",      hint: "widget.ts",           run: 2,  gap: 400  },
  { tool: "TodoWrite", hint: "4 tâches",            run: 1,  gap: 500, todo: todoList(4) },
  { tool: "Bash",      hint: "npm run tauri build", run: 1,  gap: 2200 },
]

function mockStream(ingest: (e: Evt) => void): () => void {
  let step = 0, within = 0, n = 0
  let timer: ReturnType<typeof setTimeout>
  let cancelled = false

  const emit = (kind: EvtKind, opts: { sub?: boolean; source?: string; todo?: TodoOp } = {}) => {
    ingest({
      source: opts.source ?? "claude",
      id: `mock-${n++}`,
      parent_id: null,
      // Real sub-agents share their parent's sessionId; a distinct one made
      // the store switch sessions and evict the main figure.
      session_id: "mock-session",
      agent_id: opts.sub ? "sub-001" : "main",
      is_subagent: !!opts.sub,
      at: Date.now(),
      kind,
      usage: {
        input: 60 + Math.floor(Math.random() * 260),
        output: 25 + Math.floor(Math.random() * 120),
        cache_read: 0, cache_write: 0, thinking: 0,
      },
      todo: opts.todo,
    })
  }

  const advance = (delay: number) => {
    timer = setTimeout(fire, delay)
  }

  const fire = () => {
    if (cancelled) return
    const sc = SCRIPT[step % SCRIPT.length]

    if ("prompt" in sc) {
      emit({ t: "prompt", text: sc.prompt })
      step++
      return advance(sc.gap)
    }
    if ("ask" in sc) {
      if (sc.ask === "question") {
        // A question is a tool call in the transcript: no hook needed.
        emit({ t: "tool_start", tool_id: `q-${n}`, name: "AskUserQuestion", hint: sc.detail })
      } else {
        emit({ t: "attention", reason: "permission", detail: sc.detail })
      }
      step++
      timer = setTimeout(() => {
        if (cancelled) return
        emit({ t: "tool_end", tool_id: `a-${n}`, ok: true, ms: sc.hold })
        advance(sc.gap)
      }, sc.hold)
      return
    }

    const sub = sc.agent === "sub"
    const source = sc.agent === "codex" ? "codex" : "claude"
    if (sc.tool === "Thinking") {
      emit({ t: "thinking" }, { sub, source })
    } else if (sc.tool === "Text") {
      emit({ t: "text", chars: 220 + Math.floor(Math.random() * 900) }, { sub, source })
    } else {
      emit({ t: "tool_start", tool_id: `t-${n}`, name: sc.tool, hint: sc.hint }, { sub, source, todo: sc.todo })
    }

    within++
    if (within >= sc.run) { within = 0; step++ }
    const next = SCRIPT[step % SCRIPT.length]
    advance(within === 0 ? next.gap : sc.gap)
  }

  advance(600)
  return () => { cancelled = true; clearTimeout(timer) }
}
