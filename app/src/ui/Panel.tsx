/**
 * Panel.tsx — the frame every side panel shares: a title bar with its icon,
 * a figure or two on the right, and a fold.
 *
 * The request and the journal each used to draw their own box, with a
 * letter-spaced mono caption for a title. Side by side they looked like two
 * debug consoles. One frame, one title style, and a fold so either can be
 * put away without going to the settings.
 */

import type { CSSProperties, ReactNode } from "react"
import { INK } from "./ink"
import { Icon, type IconName } from "./icons"

export const PANEL_BG =
  "linear-gradient(180deg, rgba(36, 25, 13, 0.92) 0%, rgba(22, 15, 7, 0.92) 100%)"

export const panelFrame: CSSProperties = {
  background: PANEL_BG,
  backdropFilter: "blur(10px) saturate(1.15)",
  border: "1px solid rgba(205, 176, 128, 0.16)",
  borderRadius: 12,
  boxShadow: "0 18px 44px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255, 236, 200, 0.05)",
  color: INK.body,
  fontFamily: INK.sans,
  overflow: "hidden",
}

interface PanelProps {
  title:     string
  icon:      IconName
  /** Small figure beside the title: a count, an age. */
  meta?:     ReactNode
  /** Buttons before the fold. */
  actions?:  ReactNode
  open:      boolean
  onToggle:  () => void
  style?:    CSSProperties
  children:  ReactNode
  label?:    string
}

export function Panel({ title, icon, meta, actions, open, onToggle, style, children, label }: PanelProps) {
  return (
    <section aria-label={label ?? title} style={{ ...panelFrame, ...style }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 8,
        height: 36, padding: "0 6px 0 12px",
        borderBottom: open ? `1px solid ${INK.rule}` : "1px solid transparent",
      }}>
        <span style={{ color: INK.faint, display: "grid", placeItems: "center" }}>
          <Icon name={icon} size={14} />
        </span>
        <span style={{ color: INK.bright, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.2 }}>
          {title}
        </span>
        {meta != null && (
          <span style={{
            color: INK.faint, fontSize: 11.5,
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
          }}>
            {meta}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {actions}
        <IconButton
          icon="chevron"
          label={open ? "Replier" : "Déplier"}
          onClick={onToggle}
          iconStyle={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s ease" }}
        />
      </header>
      {open && children}
    </section>
  )
}

export function IconButton({ icon, label, onClick, iconStyle, size = 14 }: {
  icon: IconName; label: string; onClick: () => void; iconStyle?: CSSProperties; size?: number
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={e => { e.stopPropagation(); onClick() }}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} size={size} style={{ display: "block", ...iconStyle }} />
    </button>
  )
}

/** A small rounded square holding an icon, tinted by what it stands for. */
export function Glyph({ icon, color, size = 22 }: { icon: IconName; color: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, flex: "0 0 auto",
      display: "grid", placeItems: "center",
      borderRadius: 6,
      color,
      background: `${color}1f`,
      boxShadow: `inset 0 0 0 1px ${color}33`,
    }}>
      <Icon name={icon} size={Math.round(size * 0.58)} strokeWidth={1.9} />
    </span>
  )
}
