/**
 * What Bureau says when it has nothing to show.
 *
 * An empty room is ambiguous: it looks the same whether Claude Code is idle,
 * has never been run, keeps its transcripts somewhere else, or the watcher
 * failed. So when no event has arrived, the room says which folders it looked
 * in and what it found in each — the one thing that makes the problem
 * actionable without opening a terminal.
 */
import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useStore } from "../store"
import { BUILD_STAMP, type WatchStatus } from "../types"

const GRACE_MS = 2500     // don't flash on a normal start
/** Past this with still no survey, the engine is not answering. Saying so is
 *  worth more than a spinner that never resolves. */
const SILENT_MS = 9000

export default function EmptyState() {
  const total  = useStore(s => s.totalEvt)
  const status = useStore(s => s.status)
  const notes  = useStore(s => s.notes)
  const widget = useStore(s => s.widget)
  const setStatus = useStore(s => s.setStatus)
  const [waited, setWaited] = useState(false)
  const [silent, setSilent] = useState(false)
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    const a = setTimeout(() => setWaited(true), GRACE_MS)
    const b = setTimeout(() => setSilent(true), SILENT_MS)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [])

  if (total > 0 || !waited) return null

  // Somewhere to start typing: the first folder that exists but yielded
  // nothing is the most likely near-miss.
  const hint =
    status?.sources.find(s => s.present && s.transcripts === 0)?.root ??
    status?.sources[0]?.root ??
    ""

  async function connect() {
    const p = path.trim()
    if (!p) return
    setBusy(true)
    setResult(null)
    try {
      const n = await invoke<number>("bureau_add_folder", { path: p })
      setResult(
        n > 0
          ? `${n} conversation${n > 1 ? "s" : ""} trouvée${n > 1 ? "s" : ""}. La pièce va se remplir.`
          : "Dossier ajouté, mais il ne contient aucune conversation pour l'instant. Il reste surveillé.",
      )
      invoke<WatchStatus>("bureau_status").then(setStatus).catch(() => {})
    } catch (e) {
      setResult(`Impossible : ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const present = status?.sources.filter(s => s.present) ?? []
  const missing = status?.sources.filter(s => !s.present) ?? []
  const hasFiles = (status?.transcripts ?? 0) > 0

  // The widget is too small for the survey table. One line, and the way to
  // the full explanation.
  if (widget) {
    return (
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 12, display: "grid", placeItems: "center",
        pointerEvents: "none", zIndex: 8,
      }}>
        <span style={{
          padding: "5px 12px", borderRadius: 999,
          background: "rgba(20,14,6,0.90)", border: "1px solid rgba(200,170,120,0.22)",
          color: "#d8c4a2", fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace", fontSize: 11,
        }}>
          En attente d'une conversation — ⤢ pour les détails
        </span>
      </div>
    )
  }

  const headline = !status
    ? (silent ? "Le moteur ne répond pas" : "Bureau démarre…")
    : status.scanning
      ? "Je regarde les dossiers…"
      : present.length === 0
      ? "Aucun assistant trouvé sur cette machine"
      : hasFiles
        ? "Rien en cours pour l'instant"
        : "Assistant trouvé, mais aucune conversation enregistrée"

  const explain = status?.scanning
    ? "Les dossiers ci-dessous existent. Je compte ce qu'ils contiennent — sur une machine avec des milliers de conversations, ça prend quelques secondes."
    : !status
    ? (silent
        ? "La fenêtre s'est ouverte mais la partie qui lit les conversations n'a rien renvoyé. Lancez bureau-scan.exe : il fait le même travail hors de l'application et dira si le problème est la lecture du disque ou le lien avec la fenêtre."
        : "Recherche des conversations en cours.")
    : present.length === 0
      ? "Bureau lit les fichiers que les assistants écrivent déjà sur le disque. Il n'appelle aucune API et ne consomme aucun jeton — mais il lui faut au moins une conversation à lire."
      : hasFiles
        ? "Les conversations trouvées datent de plus de six heures. Reprenez le travail dans votre assistant : la pièce se remplira toute seule, sans relancer Bureau."
        : "Le dossier existe mais il est vide. Lancez une conversation, puis revenez ici."

  return (
    <div style={{
      position: "fixed", inset: 0, display: "grid", placeItems: "center",
      pointerEvents: "none", zIndex: 8,
    }}>
      <div style={{
        pointerEvents: "auto",
        maxWidth: 620, padding: "22px 26px",
        background: "rgba(20,14,6,0.90)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(200,170,120,0.22)",
        borderRadius: 10,
        color: "#d8c4a2",
        font: "13px/1.55 ui-sans-serif, system-ui, sans-serif",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#e6cfa6", marginBottom: 8 }}>
          {headline}
        </div>
        <div style={{ color: "#a9977c", marginBottom: 16 }}>{explain}</div>

        {status && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {[...present, ...missing].map(s => (
                <tr key={s.id} style={{ opacity: s.present ? 1 : 0.5 }}>
                  <td style={{ padding: "3px 10px 3px 0", whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                      marginRight: 7,
                      background: s.present ? "#27ae60" : "#5a5145",
                    }} />
                    {s.label}
                  </td>
                  <td style={{ padding: "3px 10px 3px 0", whiteSpace: "nowrap", color: "#8d7f68" }}>
                    {s.present ? `${s.transcripts} conversation${s.transcripts > 1 ? "s" : ""}` : "absent"}
                  </td>
                  <td style={{
                    padding: "3px 0", color: "#6f6454",
                    fontFamily: "ui-monospace, monospace", fontSize: 11,
                    overflow: "hidden", textOverflow: "ellipsis", maxWidth: 330,
                  }}>
                    {s.root}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* The detection above is a list of guesses plus a bounded search.
            Both can be wrong on a given machine, and when they are, pointing
            at the folder yourself beats staring at an empty room. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(200,170,120,0.14)" }}>
          <div style={{ color: "#a9977c", marginBottom: 8, fontSize: 12 }}>
            Tes conversations sont ailleurs ? Colle le dossier :
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={path}
              onChange={e => setPath(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void connect() }}
              placeholder={hint || "C:\\Users\\...\\AppData\\Local\\Temp\\claude"}
              spellCheck={false}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: 6,
                background: "rgba(0,0,0,0.30)",
                border: "1px solid rgba(200,170,120,0.25)",
                color: "#e6cfa6", font: "12px ui-monospace, monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => void connect()}
              disabled={busy || !path.trim()}
              style={{
                padding: "7px 16px", borderRadius: 6, cursor: busy ? "default" : "pointer",
                background: busy ? "rgba(200,170,120,0.10)" : "rgba(200,170,120,0.18)",
                border: "1px solid rgba(200,170,120,0.35)",
                color: "#e6cfa6", font: "600 12px ui-sans-serif, system-ui, sans-serif",
              }}
            >
              {busy ? "…" : "Connecter"}
            </button>
          </div>
          {hint && !path && (
            <button
              onClick={() => setPath(hint)}
              style={{
                marginTop: 6, padding: 0, background: "none", border: "none",
                color: "#8d7f68", font: "11px ui-monospace, monospace",
                cursor: "pointer", textDecoration: "underline",
              }}
            >
              utiliser {hint}
            </button>
          )}
          {result && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#c29a62" }}>{result}</div>
          )}
        </div>

        {notes.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(200,170,120,0.14)" }}>
            {notes.map((n, i) => (
              <div key={i} style={{ color: "#c29a62", fontSize: 12 }}>{n}</div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 11, color: "#6f6454" }}>
          Bureau continue de surveiller. Fermer la fenêtre ne l'arrête pas —
          utilisez l'icône dans la barre des tâches.
          <span style={{ float: "right", opacity: 0.7 }}>build {BUILD_STAMP}</span>
        </div>
      </div>
    </div>
  )
}
