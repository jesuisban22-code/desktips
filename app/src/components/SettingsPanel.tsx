/**
 * SettingsPanel.tsx — the choices a person makes once and keeps.
 *
 * Before this, every option was either a URL flag (?fx=0, ?hour=23), which
 * nobody using the installed app can type, or a tray menu item. The tray items
 * are here too, read back from Rust each time the panel opens, so the two
 * places can never disagree.
 */

import { useEffect, useState, type ReactNode } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { INK } from "../ui/ink"
import { Icon, type IconName } from "../ui/icons"
import { IconButton, panelFrame } from "../ui/Panel"
import { useSettings, type LightMode } from "../ui/settings"
import { inTauri } from "../ui/widget"
import { BUILD_STAMP } from "../types"
import { checkForUpdate } from "./UpdateDialog"

// ── Controls ─────────────────────────────────────────────────────────────────

function Switch({ on, onChange, label, disabled }: {
  on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="switch"
      data-on={on ? "1" : "0"}
    >
      <span className="switch-knob" />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-on={value === o.value ? "1" : "0"}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ title, hint, children, stacked }: {
  title: string; hint?: string; children: ReactNode; stacked?: boolean
}) {
  return (
    <div style={{
      display: "flex", flexDirection: stacked ? "column" : "row",
      alignItems: stacked ? "stretch" : "center", gap: stacked ? 8 : 14,
      padding: "10px 14px",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: INK.bright, fontSize: 12.5, fontWeight: 500 }}>{title}</div>
        {hint && <div style={{ color: INK.faint, fontSize: 11.5, marginTop: 2, lineHeight: 1.35 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 14 }}>
      <h3 style={{
        display: "flex", alignItems: "center", gap: 7,
        margin: "0 4px 6px", color: INK.faint,
        fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase",
      }}>
        <Icon name={icon} size={13} />
        {title}
      </h3>
      <div className="settings-card">{children}</div>
    </section>
  )
}

function hourLabel(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60)
  return `${hh} h ${String(mm).padStart(2, "0")}`
}

// ── What lives outside the window ────────────────────────────────────────────

interface Prefs { autostart: boolean; auto_open: boolean }

function useSystemPrefs(active: boolean) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!active || !inTauri()) return
    let gone = false
    const read = () => invoke<Prefs>("bureau_prefs")
      .then(p => { if (!gone) setPrefs(p) })
      .catch(e => { if (!gone) setError(String(e)) })
    void read()
    // The tray can change them too while the panel is open.
    const un = listen("bureau://prefs", () => void read())
    return () => { gone = true; void un.then(f => f()) }
  }, [active])

  const change = async (key: keyof Prefs, on: boolean) => {
    setError("")
    try {
      setPrefs(await invoke<Prefs>("bureau_set_pref", { key, on }))
    } catch (e) {
      // An app built before this panel existed has no such command.
      setError(String(e).includes("not found")
        ? "Reconstruis l’application pour activer ce réglage."
        : String(e))
    }
  }
  return { prefs, error, change }
}

// ── The panel ────────────────────────────────────────────────────────────────

export function SettingsPanel({ bottom }: { bottom: number }) {
  const s = useSettings()
  const open = s.panelOpen
  const system = useSystemPrefs(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") s.openPanel(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, s])

  if (!open) return null

  const tauri = inTauri()

  return (
    <aside
      role="dialog"
      aria-label="Paramètres"
      style={{
        ...panelFrame,
        position: "fixed", top: 52, right: 14, bottom,
        width: 380, maxWidth: "calc(100vw - 28px)",
        zIndex: 14,
        display: "flex", flexDirection: "column",
        animation: "settings-in 0.2s ease-out",
      }}
    >
      <header style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 10px 12px 16px",
        borderBottom: `1px solid ${INK.rule}`,
      }}>
        <span style={{ color: INK.body }}><Icon name="gear" size={16} /></span>
        <span style={{ color: INK.bright, fontSize: 14, fontWeight: 600 }}>Paramètres</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="x" label="Fermer (Échap)" onClick={() => s.openPanel(false)} size={15} />
      </header>

      <div className="bureau-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 12px 6px" }}>
        <Section icon="eye" title="Affichage">
          <Row title="Demande en cours" hint="Ta dernière demande et la liste de tâches, en bas à gauche.">
            <Switch label="Demande en cours" on={s.showBrief} onChange={v => s.set({ showBrief: v })} />
          </Row>
          <Row title="Journal" hint="Chaque étape, dans l’ordre, en bas à droite.">
            <Switch label="Journal" on={s.showJournal} onChange={v => s.set({ showJournal: v })} />
          </Row>
          <Row title="Frise chronologique" hint="Une marque par étape, le long du bas.">
            <Switch label="Frise chronologique" on={s.showTimeline} onChange={v => s.set({ showTimeline: v })} />
          </Row>
          <Row title="Compteurs" hint="Tokens reçus, écrits, en cache, et durée, en haut.">
            <Switch label="Compteurs" on={s.showStats} onChange={v => s.set({ showStats: v })} />
          </Row>
          <Row title="Bulles" hint="Ce que fait chaque personnage, au-dessus de sa tête.">
            <Switch label="Bulles" on={s.bubbles} onChange={v => s.set({ bubbles: v })} />
          </Row>
        </Section>

        <Section icon="list" title="Journal">
          <Row title="Regrouper les étapes répétées" hint="Onze lectures du même fichier font une ligne « ×11 ».">
            <Switch label="Regrouper" on={s.group} onChange={v => s.set({ group: v })} />
          </Row>
          <Row title="Afficher les secondes">
            <Switch label="Secondes" on={s.seconds} onChange={v => s.set({ seconds: v })} />
          </Row>
        </Section>

        <Section icon="sun" title="Lumière">
          <Row title="Heure de la pièce" stacked>
            <Segmented<LightMode>
              label="Heure de la pièce"
              value={s.light}
              onChange={v => s.set({ light: v })}
              options={[
                { value: "real",  label: "Heure réelle" },
                { value: "fixed", label: "Fixe" },
                { value: "cycle", label: "Journée en 90 s" },
              ]}
            />
            {s.light === "fixed" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="range" min={0} max={23.75} step={0.25}
                  value={s.hour}
                  onChange={e => s.set({ hour: Number(e.target.value) })}
                  aria-label="Heure"
                  className="range"
                  style={{ flex: 1 }}
                />
                <span style={{
                  width: 58, textAlign: "right", color: INK.bright,
                  fontFamily: INK.mono, fontSize: 12, fontVariantNumeric: "tabular-nums",
                }}>
                  {hourLabel(s.hour)}
                </span>
              </div>
            )}
          </Row>
        </Section>

        <Section icon="cube" title="Rendu">
          <Row title="Effets de lumière" hint="Ombres de contact et halo des lampes. À couper sur une petite carte graphique.">
            <Switch label="Effets de lumière" on={s.effects} onChange={v => s.set({ effects: v })} />
          </Row>
          <Row title="Qualité des ombres">
            <Segmented<"high" | "low">
              label="Qualité des ombres"
              value={s.quality}
              onChange={v => s.set({ quality: v })}
              options={[{ value: "high", label: "Haute" }, { value: "low", label: "Économe" }]}
            />
          </Row>
        </Section>

        <Section icon="power" title="Démarrage">
          <Row title="Lancer au démarrage de Windows">
            <Switch
              label="Lancer au démarrage de Windows"
              disabled={!system.prefs}
              on={system.prefs?.autostart ?? false}
              onChange={v => void system.change("autostart", v)}
            />
          </Row>
          <Row title="S’ouvrir avec Claude Code" hint="En widget, dans le coin de l’écran, à chaque nouvelle session.">
            <Switch
              label="S’ouvrir avec Claude Code"
              disabled={!system.prefs}
              on={system.prefs?.auto_open ?? false}
              onChange={v => void system.change("auto_open", v)}
            />
          </Row>
          {(!tauri || system.error) && (
            <div style={{
              margin: "0 14px 12px", padding: "7px 10px", borderRadius: 7,
              background: "rgba(205,176,128,0.06)", color: system.error ? INK.alarm : INK.faint,
              fontSize: 11.5, lineHeight: 1.4,
            }}>
              {system.error || "Disponible dans l’application installée."}
            </div>
          )}
        </Section>
        <Section icon="reset" title="Mise à jour">
          <Row title="Rechercher une mise à jour" hint="Cherche la dernière version publiée sur GitHub et propose de l’installer.">
            <button type="button" className="text-btn" onClick={() => void checkForUpdate()}>
              Rechercher
            </button>
          </Row>
        </Section>
      </div>

      <footer style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px 10px 16px",
        borderTop: `1px solid ${INK.rule}`,
      }}>
        <span style={{ color: INK.ghost, fontSize: 11, fontFamily: INK.mono }}>
          Bureau 0.1.0 · {BUILD_STAMP}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="text-btn" onClick={s.reset} title="Remettre les réglages de l’affichage par défaut">
          <Icon name="reset" size={13} />
          Réinitialiser
        </button>
      </footer>
    </aside>
  )
}
