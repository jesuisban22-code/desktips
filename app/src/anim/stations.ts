/**
 * stations.ts — where an agent goes to do a thing.
 *
 * Each tool maps to a piece of furniture, and each piece of furniture has a
 * STAND point (where the character's feet go) distinct from the furniture's
 * own position — you stand beside a cabinet, not inside it. Facing is derived
 * so the character always turns to address the furniture on arrival.
 *
 * Coordinates follow the room map in Scene.tsx: X ∈ [-6, 6], Z ∈ [-6, 6],
 * back wall at Z = -6, left wall at X = -6.
 */

export type StationId =
  | "desk" | "cabinet" | "drafting" | "workbench" | "bookshelf" | "door"

export type ActionKind =
  | "sit"        // at the desk, working
  | "search"     // pulling files / books — crouch-ish, repeated reach
  | "draw"       // at the drafting table
  | "operate"    // at the workbench
  | "browse"     // scanning the shelves
  | "greet"      // at the door

export interface Station {
  id:       StationId
  /** Where the character stands (x, z). */
  stand:    [number, number]
  /** What the character is addressing — used to derive facing. */
  target:   [number, number]
  action:   ActionKind
  /** Height the hands work at, for reach animation. */
  workY:    number
  /** True if the character sits rather than stands. */
  seated?:  boolean
  label:    string
}

export const STATIONS: Record<StationId, Station> = {
  desk: {
    id: "desk",
    // Close enough to the desk to reach it. At 2.55, with the hips set back
    // onto the seat, the desk's near edge was 565 mm away — further than the
    // whole arm — so a "writing" figure sat there pawing at the air.
    stand:  [ 2.60,  2.29],
    target: [ 2.60,  1.70],
    action: "sit",
    workY:  0.78,
    seated: true,
    label:  "bureau",
  },
  cabinet: {
    id: "cabinet",
    stand:  [ 4.05, -3.95],
    target: [ 4.70, -4.60],
    action: "search",
    workY:  0.95,
    label:  "classeur",
  },
  drafting: {
    id: "drafting",
    stand:  [-1.40, -2.62],
    target: [-1.40, -3.50],
    action: "draw",
    workY:  0.86,
    label:  "table à dessin",
  },
  workbench: {
    id: "workbench",
    stand:  [-4.28,  1.40],
    target: [-5.10,  1.40],
    action: "operate",
    workY:  0.98,
    label:  "établi",
  },
  bookshelf: {
    id: "bookshelf",
    stand:  [ 2.20, -4.72],
    target: [ 2.20, -5.55],
    action: "browse",
    workY:  1.35,
    label:  "bibliothèque",
  },
  door: {
    id: "door",
    stand:  [-4.95,  4.00],
    target: [-5.95,  4.00],
    action: "greet",
    workY:  1.05,
    label:  "porte",
  },
}

/** Facing angle (world Y rotation) for a character standing at a station. */
export function facingOf(s: Station): number {
  const dx = s.target[0] - s.stand[0]
  const dz = s.target[1] - s.stand[1]
  return Math.atan2(dx, dz)          // the figure faces +Z at rotation 0
}

/** Rotation that makes a character face along a travel direction. */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

// ── Tool → station ───────────────────────────────────────────────────────────

/**
 * Matching is by substring, lowercase, most specific first. Unknown tools fall
 * back to the desk rather than to nothing, so a tool Bureau has never seen
 * still produces a coherent animation instead of a frozen agent.
 */
const RULES: Array<[RegExp, StationId]> = [
  // Exact: TaskCreate / TaskUpdate / TaskStop are bookkeeping, and the prefix
  // match this used to be sent the figure to the door for every one of them.
  [/^(agent|task|dispatch)$/,               "door"],
  [/(websearch|webfetch|fetch|search_web|browser|navigate|http)/, "bookshelf"],
  // PowerShell and the MCP runners are this machine's commonest tools after
  // Bash (measured: 317 and 360 calls). Both used to land on the desk.
  [/^(bash|powershell|shell|exec|run|npm|cargo|git|start|stop|play|test|build|computer|user_|preview)/, "workbench"],
  [/^(write|edit|notebook|create|multiedit|multi_edit|insert|generate|update|set_)/, "drafting"],
  [/^(read|glob|grep|ls|find|cat|view|get|list|inspect|script_|search_game)/, "cabinet"],
  [/(search|lookup|query)/,                 "bookshelf"],
  [/(file|dir|path|read|grep)/,             "cabinet"],
  [/(edit|write)/,                          "drafting"],
  [/(exec|run|luau|javascript|console)/,    "workbench"],
]

/** `mcp__Roblox_Studio__execute_luau` → `execute_luau`. The server prefix says
 *  where a tool lives, not what it does — matched whole, no MCP tool ever
 *  reached a station. */
export function bareToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name
  const rest = name.slice(5)
  const i = rest.indexOf("__")
  return i >= 0 ? rest.slice(i + 2) : rest
}

export function stationForTool(toolName: string): StationId {
  const n = bareToolName(toolName).toLowerCase()
  for (const [re, id] of RULES) if (re.test(n)) return id
  return "desk"
}

/** What the bench terminal shows for a command: the prompt its shell would
 *  print, then the command itself. */
export function commandLine(toolName: string, hint: string): string {
  const name = bareToolName(toolName)
  if (/^bash$/i.test(name)) return `$ ${hint || "bash"}`
  if (/^powershell$/i.test(name)) return `PS> ${hint || "powershell"}`
  return `> ${name}${hint ? " " + hint : ""}`
}

/** One glyph per kind of work, so a bubble reads before its words do. */
export function iconForTool(toolName: string): string {
  switch (stationForTool(toolName)) {
    case "cabinet":   return "📂"
    case "drafting":  return "✏️"
    case "workbench": return "⚡"
    case "bookshelf": return "🌐"
    case "door":      return "🤖"
    case "desk":      return "💬"
  }
}

/** Short verb shown in the HUD / above the agent. */
export function verbFor(action: ActionKind): string {
  switch (action) {
    case "search":  return "fouille"
    case "draw":    return "dessine"
    case "operate":  return "bricole"
    case "browse":  return "consulte"
    case "greet":   return "accueille"
    case "sit":     return "travaille"
  }
}
