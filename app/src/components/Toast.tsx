/**
 * Toast.tsx — one line, bottom centre, gone after a few seconds.
 *
 * For the rare moment something the person asked for could not be done: a
 * button that does nothing and says nothing reads as broken, and the reason
 * is usually one short sentence.
 */

import { useEffect, useState } from "react"
import { useStore } from "../store"
import { INK } from "../ui/ink"

const SHOW_MS = 6000

export function Toast({ compact = false }: { compact?: boolean }) {
  const toast = useStore(s => s.toast)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const id = setTimeout(() => setVisible(false), SHOW_MS)
    return () => clearTimeout(id)
  }, [toast])

  if (!toast || !visible) return null
  return (
    <div role="status" style={{
      position: "fixed", left: "50%", bottom: compact ? 10 : 60, transform: "translateX(-50%)",
      zIndex: 13, maxWidth: "calc(100vw - 24px)",
      padding: "6px 12px", borderRadius: 8,
      background: "rgba(30, 20, 8, 0.94)", border: `1px solid ${INK.alarm}66`,
      color: INK.bright, fontFamily: INK.mono, fontSize: 11.5,
      boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }}>
      {toast.text}
    </div>
  )
}
