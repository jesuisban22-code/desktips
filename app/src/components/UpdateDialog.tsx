/**
 * UpdateDialog.tsx — "Rechercher une mise à jour", then Confirmer / Annuler.
 *
 * Opened from the tray menu (bureau://update-check) or the settings panel.
 * The latest version is the latest GitHub Release of the project's repository
 * (app/depot-github.txt); its tag is compared with the running version.
 * Nothing is downloaded until the person confirms.
 */

import { useEffect, useState } from "react"
import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { listen } from "@tauri-apps/api/event"
import { INK } from "../ui/ink"
import { Icon } from "../ui/icons"
import { panelFrame } from "../ui/Panel"
import { inTauri } from "../ui/widget"

interface Release {
  tag:       string
  current:   string
  notes:     string
  published: number
  url:       string
  size:      number
  page:      string
}

type State =
  | { step: "closed" }
  | { step: "checking" }
  | { step: "none"; current: string; repo: string }
  | { step: "ask"; release: Release }
  | { step: "starting" }
  | { step: "started" }
  | { step: "error"; message: string }

const useUpdate = create<{ s: State; set: (s: State) => void }>(set => ({
  s: { step: "closed" },
  set: s => set({ s }),
}))

/** "v0.2.0" → [0, 2, 0]. */
function parts(v: string): number[] {
  return v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0)
}
export function newer(tag: string, current: string): boolean {
  const a = parts(tag), b = parts(current)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** Opens the dialog and asks GitHub for the latest release. */
export async function checkForUpdate(): Promise<void> {
  const { set } = useUpdate.getState()
  set({ step: "checking" })
  if (!inTauri()) {
    set({ step: "error", message: "Disponible dans l’application installée." })
    return
  }
  try {
    const repo = await invoke<string | null>("bureau_update_repo")
    if (!repo) {
      set({ step: "error", message: "Aucun dépôt GitHub n’est configuré : écris-le dans app/depot-github.txt, puis reconstruis Bureau." })
      return
    }
    const current = await getVersion()
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    })
    if (r.status === 404) {
      set({ step: "error", message: `Aucune version publiée sur github.com/${repo} pour l’instant.` })
      return
    }
    if (!r.ok) throw new Error(`GitHub a répondu ${r.status}${r.status === 403 ? " (trop de demandes, réessaie dans une heure)" : ""}.`)
    const rel = await r.json() as {
      tag_name: string; body?: string; published_at?: string; html_url: string
      assets: { name: string; browser_download_url: string; size: number }[]
    }
    if (!newer(rel.tag_name, current)) {
      set({ step: "none", current, repo })
      return
    }
    const setup = rel.assets.find(a => /-setup\.exe$/i.test(a.name))
    if (!setup) {
      set({ step: "error", message: `La version ${rel.tag_name} n’a pas encore d’installeur Windows (elle est peut-être en cours de construction).` })
      return
    }
    set({ step: "ask", release: {
      tag: rel.tag_name, current, notes: (rel.body ?? "").trim(),
      published: rel.published_at ? Date.parse(rel.published_at) : 0,
      url: setup.browser_download_url, size: setup.size, page: rel.html_url,
    } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    set({ step: "error", message: msg.includes("not found")
      ? "Cette version de Bureau ne sait pas encore se mettre à jour : relance installeur.bat une fois."
      : msg.includes("Failed to fetch") ? "GitHub est injoignable. Vérifie ta connexion." : msg })
  }
}

async function confirm(url: string) {
  const { set } = useUpdate.getState()
  set({ step: "starting" })
  try {
    await invoke("bureau_update_install", { url })
    set({ step: "started" })
  } catch (e) {
    set({ step: "error", message: String(e) })
  }
}

function when(ms: number): string {
  if (!ms) return "—"
  return new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function UpdateDialog() {
  const s = useUpdate(u => u.s)
  const set = useUpdate(u => u.set)
  const close = () => set({ step: "closed" })

  // The tray's "Rechercher une mise à jour".
  useEffect(() => {
    if (!inTauri()) return
    const un = listen("bureau://update-check", () => void checkForUpdate())
    return () => { void un.then(f => f()) }
  }, [])

  useEffect(() => {
    if (s.step === "closed") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && s.step !== "starting") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const [, tick] = useState(0)
  useEffect(() => { if (s.step === "checking") { const id = setInterval(() => tick(n => n + 1), 300); return () => clearInterval(id) } }, [s.step])

  if (s.step === "closed") return null

  let icon: Parameters<typeof Icon>[0]["name"] = "reset"
  let title = ""
  let body: React.ReactNode = null
  let buttons: React.ReactNode = <button type="button" className="text-btn" onClick={close}>OK</button>

  switch (s.step) {
    case "checking":
      title = "Recherche d’une mise à jour…"
      body = <p style={P}>Interrogation de GitHub pour la dernière version publiée.</p>
      buttons = null
      break
    case "none":
      icon = "check"
      title = "Bureau est à jour"
      body = <p style={P}>Tu as la dernière version publiée sur github.com/{s.repo} (v{s.current.replace(/^v/, "")}).</p>
      break
    case "ask": {
      const rel = s.release
      icon = "reset"
      title = `Bureau ${rel.tag} est disponible`
      body = (
        <>
          <p style={P}>
            Tu as la version <b style={{ color: INK.bright }}>v{rel.current.replace(/^v/, "")}</b>.
            {rel.published > 0 && <> Publiée le {when(rel.published)},</>} installeur de {(rel.size / 1_048_576).toFixed(1).replace(".", ",")} Mo.
          </p>
          {rel.notes && (
            <div className="bureau-scroll" style={NOTES}>{rel.notes.slice(0, 1500)}</div>
          )}
          <p style={P}>
            En confirmant, l’installeur est téléchargé depuis GitHub, puis Bureau se ferme,
            s’installe et redémarre tout seul.
          </p>
        </>
      )
      buttons = (
        <>
          <button type="button" className="text-btn" onClick={close}>Annuler</button>
          <button type="button" className="text-btn primary" onClick={() => void confirm(rel.url)} autoFocus>Confirmer</button>
        </>
      )
      break
    }
    case "starting":
      title = "Lancement de la mise à jour…"
      buttons = null
      break
    case "started":
      icon = "terminal"
      title = "Mise à jour lancée"
      body = <p style={P}>Le téléchargement se déroule dans la fenêtre « Bureau - mise à jour ». Bureau va se fermer puis redémarrer dans la nouvelle version. En cas d’échec, cette version reste en place et la fenêtre dit pourquoi.</p>
      break
    case "error":
      icon = "alert"
      title = "Mise à jour impossible"
      body = <p style={{ ...P, color: INK.alarm }}>{s.message}</p>
      break
  }

  return (
    <div
      onClick={() => { if (s.step !== "starting" && s.step !== "checking") close() }}
      style={{
        position: "fixed", inset: 0, zIndex: 30,
        display: "grid", placeItems: "center",
        background: "rgba(8, 5, 2, 0.55)",
        animation: "settings-in 0.18s ease-out",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{ ...panelFrame, width: 420, maxWidth: "calc(100vw - 24px)", padding: "18px 20px 16px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: body ? 10 : 4 }}>
          <span style={{ color: s.step === "error" ? INK.alarm : INK.wait }}>
            <Icon name={icon} size={18} className={s.step === "checking" || s.step === "starting" ? "spin" : undefined} />
          </span>
          <span style={{ color: INK.bright, fontSize: 15, fontWeight: 600 }}>{title}</span>
        </div>
        {body}
        {buttons && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>{buttons}</div>}
      </div>
    </div>
  )
}

const P: React.CSSProperties = { margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.5, color: INK.body }
const NOTES: React.CSSProperties = {
  margin: "0 0 10px", padding: "8px 10px", maxHeight: 150, overflowY: "auto",
  borderRadius: 8, background: "rgba(0,0,0,0.22)", border: "1px solid rgba(205,176,128,0.10)",
  fontSize: 12, lineHeight: 1.45, color: INK.body, whiteSpace: "pre-wrap",
}
