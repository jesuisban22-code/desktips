/**
 * assistants.ts — how each AI is presented in the room.
 *
 * Bureau watches more than Claude. When several are working at once they have
 * to be distinguishable before you read any label, so each gets a shirt colour
 * and a short name. Sub-agents wear a lighter shade of their parent's colour,
 * which keeps a run visually grouped.
 */

import { PAL } from "../three/palette"

export interface Assistant {
  id:     string
  label:  string
  color:  string
}

const TABLE: Record<string, Assistant> = {
  claude:  { id: "claude",  label: "Claude",  color: PAL.srcClaude  },
  codex:   { id: "codex",   label: "Codex",   color: PAL.srcCodex   },
  gemini:  { id: "gemini",  label: "Gemini",  color: PAL.srcGemini  },
  copilot: { id: "copilot", label: "Copilot", color: PAL.srcCopilot },
  cursor:  { id: "cursor",  label: "Cursor",  color: PAL.srcCursor  },
  cline:   { id: "cline",   label: "Cline",   color: PAL.srcCline   },
}

export function assistantFor(source: string): Assistant {
  return TABLE[source] ?? {
    id: source || "other",
    // An assistant Bureau has no entry for still gets a readable name rather
    // than an empty badge.
    label: source ? source[0].toUpperCase() + source.slice(1) : "Autre",
    color: PAL.srcOther,
  }
}

/** Sub-agents wear a lighter shade of whoever dispatched them. */
export function shirtFor(source: string, isSub: boolean): string {
  const base = assistantFor(source).color
  if (!isSub) return base
  const n = parseInt(base.slice(1), 16)
  const lift = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.34))
  const r = lift((n >> 16) & 255), g = lift((n >> 8) & 255), b = lift(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
}
