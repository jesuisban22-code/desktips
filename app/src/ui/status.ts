import type { AgentStatus } from "../types"
import { INK } from "./ink"

/** Dot colour and word for an agent's status. `tint` is the assistant's own
 *  colour, which is what "using a tool" is shown in. */
export function statusLook(status: AgentStatus, tint: string): [string, string] {
  switch (status) {
    case "idle":     return ["#6a5d49", "au repos"]
    case "thinking": return ["#9b7fb8", "réfléchit"]
    case "tool":     return [tint,      "outil"]
    case "writing":  return ["#8fae72", "rédige"]
    case "busy":     return ["#d59b5e", "occupé"]
    case "error":    return [INK.alarm, "erreur"]
    case "waiting":  return [INK.wait,  "t'attend"]
  }
}
