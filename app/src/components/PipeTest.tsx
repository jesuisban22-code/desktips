/**
 * `?debug=pipe` — the event pipeline with no 3D at all.
 *
 * Under a software renderer a frame takes seconds, so timers are starved and a
 * replay crawls: the room can look dead when nothing is actually wrong. This
 * mounts the same ingest path and the same animation queues without a canvas,
 * so the logic can be exercised at full speed and asserted headlessly.
 */
import { useEffect, useState } from "react"
import { useTauriEvents } from "../hooks/useTauriEvents"
import { useStore } from "../store"
import { queueFor } from "../anim/queue"

export default function PipeTest() {
  useTauriEvents()
  const agents = useStore(s => s.agents)
  const total  = useStore(s => s.totalEvt)
  const ignored = useStore(s => s.ignored)
  const [, tick] = useState(0)

  // Queues live outside React on purpose; poll them for the readout.
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [])

  const rows = [...agents.values()]
  return (
    <div style={{ font: "13px ui-monospace, monospace", color: "#e8dcc6", padding: 16 }}>
      <div>événements : {total} · ignorés : {ignored} · agents : {rows.length}</div>
      <table style={{ marginTop: 12, borderSpacing: "14px 2px" }}>
        <tbody>
          {rows.map(a => {
            const q = queueFor(a.id)
            return (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.status}</td>
                <td>{a.currentTool ?? "—"}</td>
                <td>file {q ? q.depth : 0}</td>
                <td>{a.totalInput}/{a.totalOutput}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
