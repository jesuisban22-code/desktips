//! Which assistants Bureau watches, and where each one keeps its transcripts.
//!
//! The PATHS here are verified against published layouts. The SCHEMAS are not:
//! every tool writes a different JSON shape, several have changed it between
//! releases, and I have no way to test most of them. So the paths are declared
//! precisely and the parsing is deliberately tolerant (see evt.rs) — a source
//! whose format has moved on degrades to fewer event kinds rather than
//! crashing or, worse, silently misreporting.
//!
//! Adding an assistant is one entry here plus, if its shape is exotic, a case
//! in the parser.

use std::path::{Path, PathBuf};

/// The JSON shape a source's lines are written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    /// Anthropic transcript: `{type, message:{content:[{type:"tool_use"…}]}}`.
    /// Verified against real Claude Code and Cowork sessions.
    Anthropic,
    /// OpenAI response items: `{timestamp, type, payload:{type:"function_call"…}}`.
    OpenAiItems,
    /// Anything else — handled by the shape sniffer.
    Generic,
}

#[derive(Debug, Clone)]
pub struct Source {
    pub id:    &'static str,
    pub label: &'static str,
    pub root:  PathBuf,
    pub shape: Shape,
    /// How deep to recurse below `root`.
    pub depth: usize,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Honour a tool's own home override before falling back to the default.
fn env_or(var: &str, fallback: PathBuf) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or(fallback)
}

/// Every assistant Bureau knows how to read, whether or not it is installed.
pub fn catalogue() -> Vec<Source> {
    let h = home();
    vec![
        // Claude Code and Cowork share this tree and this format — Cowork
        // sessions land in it exactly like CLI ones.
        Source {
            id: "claude", label: "Claude",
            root: env_or("CLAUDE_CONFIG_DIR", h.join(".claude")).join("projects"),
            shape: Shape::Anthropic, depth: 6,
        },
        Source {
            id: "codex", label: "Codex",
            root: env_or("CODEX_HOME", h.join(".codex")).join("sessions"),
            shape: Shape::OpenAiItems, depth: 5,
        },
        Source {
            id: "copilot", label: "Copilot",
            root: h.join(".copilot").join("session-state"),
            shape: Shape::Generic, depth: 4,
        },
        Source {
            id: "cursor", label: "Cursor",
            root: h.join(".cursor").join("projects"),
            shape: Shape::Generic, depth: 6,
        },
        Source {
            id: "gemini", label: "Gemini",
            root: h.join(".gemini").join("tmp"),
            shape: Shape::Generic, depth: 5,
        },
        Source {
            id: "cline", label: "Cline",
            root: h.join(".cline"),
            shape: Shape::Generic, depth: 5,
        },
    ]
}

/// Where Bureau keeps its own configuration and its drop folder.
pub fn bureau_dir() -> PathBuf {
    env_or("BUREAU_HOME", home().join(".bureau"))
}

/// The drop folder for conversations that are not on this machine.
///
/// A Cowork session running in the cloud writes its transcript inside that
/// cloud container — there is no file on this disk to watch, and no amount of
/// looking harder will produce one. What does exist is a way for the cloud
/// session to WRITE here: it can save into any folder you have connected to
/// it. So Bureau watches a folder of its own, and anything dropped in it is
/// read exactly like a local session.
pub fn drop_dir() -> PathBuf {
    bureau_dir().join("sessions")
}

/// Extra folders to watch, one absolute path per line, in `.bureau/watch.txt`.
/// Blank lines and lines starting with `#` are ignored. This is how a folder
/// that a cloud session already writes into — a shared Downloads folder, say —
/// gets picked up without copying anything by hand.
pub fn extra_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(v) = std::env::var_os("BUREAU_WATCH") {
        for part in v.to_string_lossy().split(';') {
            let p = part.trim();
            if !p.is_empty() {
                out.push(PathBuf::from(p));
            }
        }
    }
    out.extend(extra_dirs_in(&bureau_dir()));
    out.retain(|p| p.is_dir());
    out.dedup();
    out
}

/// The watch list held in `dir/watch.txt`, with no reference to the
/// environment.
///
/// Splitting this out is not tidiness. The test for it used to point
/// BUREAU_HOME at a temporary folder, and the process environment is shared by
/// every test cargo runs in parallel — including ones that read the config
/// without taking any lock. It passed here and failed on the machine it was
/// written for, twice. A function that takes its directory cannot race.
pub fn extra_dirs_in(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(text) = std::fs::read_to_string(dir.join("watch.txt")) {
        for line in text.lines() {
            let p = line.trim();
            if p.is_empty() || p.starts_with('#') {
                continue
            }
            out.push(PathBuf::from(p));
        }
    }
    out.retain(|p| p.is_dir());
    out.dedup();
    out
}

/// Add a folder to `watch.txt`, so it is still watched after a restart.
pub fn remember_folder(path: &Path) -> std::io::Result<()> {
    remember_folder_in(&bureau_dir(), path)
}

/// As above, against a directory given explicitly — the form the tests use.
pub fn remember_folder_in(dir: &Path, path: &Path) -> std::io::Result<()> {
    let dir = dir.to_path_buf();
    std::fs::create_dir_all(&dir)?;
    let file = dir.join("watch.txt");
    let existing = std::fs::read_to_string(&file).unwrap_or_default();
    let wanted = path.to_string_lossy();
    if existing.lines().any(|l| l.trim() == wanted) {
        return Ok(())
    }
    let mut out = existing;
    if out.is_empty() {
        out.push_str("# Dossiers surveillés en plus. Un chemin absolu par ligne.\n");
    } else if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&wanted);
    out.push('\n');
    std::fs::write(file, out)
}

/// Make sure the drop folder exists, so it can be found and used without the
/// user having to guess the path or create it first.
pub fn ensure_drop_dir() -> std::io::Result<PathBuf> {
    let d = drop_dir();
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

/// Sources that are actually present on this machine, plus the drop folder and
/// anything listed in watch.txt.
pub fn discover() -> Vec<Source> {
    let mut found: Vec<Source> =
        catalogue().into_iter().filter(|s| s.root.is_dir()).collect();

    let drop = drop_dir();
    if drop.is_dir() {
        found.push(Source {
            id: "cloud", label: "Cloud", root: drop,
            shape: Shape::Anthropic, depth: 6,
        });
    }
    for (i, root) in extra_dirs().into_iter().enumerate() {
        // Leaked so the id can stay &'static like the rest of the catalogue;
        // there are a handful of these at most, once, at startup.
        let id: &'static str = Box::leak(format!("watch{i}").into_boxed_str());
        found.push(Source {
            id, label: "Surveillé", root, shape: Shape::Anthropic, depth: 6,
        });
    }
    found
}

/// Which source a path belongs to, for routing a file change back to a parser.
pub fn source_for<'a>(sources: &'a [Source], path: &Path) -> Option<&'a Source> {
    sources.iter().find(|s| path.starts_with(&s.root))
}

// ── Recherche automatique ────────────────────────────────────────────────────

/// Directories that are never worth walking: huge, and never hold a
/// conversation. Without this the scan spends minutes in npm caches.
const SKIP: &[&str] = &[
    "node_modules", ".git", ".cargo", ".rustup", "target", "Cache", "Code Cache",
    "GPUCache", "CachedData", "Crashpad", "logs", "Logs", "tmp", "temp", "Temp",
    "dist", "build", "AppData\\Local\\Temp", "Service Worker", "IndexedDB",
    "blob_storage", "DawnCache", "ShaderCache", "Partitions",
];

fn skippable(name: &str) -> bool {
    SKIP.iter().any(|s| s.eq_ignore_ascii_case(name))
}

/// Roots worth searching when the known paths come up empty.
///
/// The catalogue is a list of paths I wrote down from published layouts. On a
/// machine where a tool stores its conversations somewhere else — a different
/// installer, a newer version, a per-user override — that list is simply wrong,
/// and Bureau's answer was an empty room with no explanation. So when the known
/// paths yield nothing, it goes looking instead of insisting.
pub fn probe_roots() -> Vec<PathBuf> {
    // An explicit list wins — the tests rely on it, and it is an escape hatch
    // for a machine whose conversations live somewhere unusual.
    if let Some(v) = std::env::var_os("BUREAU_PROBE_ROOTS") {
        return v
            .to_string_lossy()
            .split(';')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .collect()
    }
    let mut v = vec![home()];
    for var in ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME"] {
        if let Some(p) = std::env::var_os(var) {
            let p = PathBuf::from(p);
            if p.is_dir() && !v.contains(&p) {
                v.push(p);
            }
        }
    }
    // Temp is skipped wholesale during the walk — it is enormous and almost
    // never holds anything. Almost: Claude Code puts its projects there on
    // Windows, so that one folder is named explicitly instead.
    if let Some(la) = std::env::var_os("LOCALAPPDATA") {
        for name in ["claude", "codex", "cursor", "gemini", "copilot", "cline"] {
            let p = PathBuf::from(&la).join("Temp").join(name);
            if p.is_dir() {
                v.push(p);
            }
        }
    }
    v
}

/// Does this file look like a conversation transcript rather than any other
/// JSONL that happens to be on disk? Judged on content, not on its name.
fn looks_like_transcript(path: &Path) -> Option<Shape> {
    use std::io::{BufRead, BufReader};
    let f = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::new(f);
    let mut line = String::new();
    // A few lines: the first is often a header or a bare prompt.
    for _ in 0..6 {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            break
        }
        let v: serde_json::Value = match serde_json::from_str(line.trim()) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let obj = match v.as_object() { Some(o) => o, None => continue };
        // Anthropic: a `type` alongside a `message`, or the sidechain marker.
        if obj.contains_key("message") && obj.contains_key("type") {
            return Some(Shape::Anthropic)
        }
        if obj.contains_key("isSidechain") || obj.contains_key("sessionId") {
            return Some(Shape::Anthropic)
        }
        // OpenAI response items.
        if obj.contains_key("payload") && obj.contains_key("type") {
            return Some(Shape::OpenAiItems)
        }
        // Anything else that is a stream of JSON objects gets the sniffer.
        if obj.contains_key("role") || obj.contains_key("content") {
            return Some(Shape::Generic)
        }
    }
    None
}

struct Hunt {
    budget:   usize,
    deadline: std::time::Instant,
    out:      Vec<(PathBuf, Shape)>,
}

impl Hunt {
    fn spent(&self) -> bool {
        self.budget == 0 || std::time::Instant::now() > self.deadline
    }
}

fn hunt(dir: &Path, depth: usize, max_depth: usize, h: &mut Hunt) {
    if depth > max_depth || h.spent() {
        return
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if h.spent() {
            return
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let p = entry.path();
        if p.is_dir() {
            if skippable(&name) {
                continue
            }
            hunt(&p, depth + 1, max_depth, h);
        } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl")
            && name != "journal.jsonl"
        {
            h.budget -= 1;
            if let Some(shape) = looks_like_transcript(&p) {
                h.out.push((p, shape));
            }
        }
    }
}

/// Search the obvious roots for transcripts the catalogue does not know about.
///
/// Bounded on purpose: six levels and a few thousand files, skipping caches.
/// It runs once, only when the known paths found nothing, and it reports what
/// it found so the user can see where their conversations actually live.
pub fn autodiscover() -> Vec<Source> {
    let known: Vec<PathBuf> = catalogue().into_iter().map(|s| s.root).collect();
    let drop = drop_dir();

    let mut h = Hunt {
        budget:   3000,
        // Hard stop. This runs at startup on someone's actual machine; it is
        // allowed to give up, it is not allowed to hang the window.
        deadline: std::time::Instant::now() + std::time::Duration::from_secs(4),
        out:      Vec::new(),
    };
    for root in probe_roots() {
        hunt(&root, 0, 6, &mut h);
    }

    h.out.retain(|(p, _)| !known.iter().any(|k| p.starts_with(k)) && !p.starts_with(&drop));
    if h.out.is_empty() {
        return Vec::new()
    }

    // Group by the folder each transcript sits in, busiest first. Taking the
    // common ancestor instead would, for two unrelated hits, hand back the
    // whole user profile and set Bureau watching it.
    let mut by_dir: std::collections::HashMap<PathBuf, (usize, Shape)> = Default::default();
    for (p, shape) in &h.out {
        if let Some(parent) = p.parent() {
            let e = by_dir.entry(parent.to_path_buf()).or_insert((0, *shape));
            e.0 += 1;
        }
    }
    let mut dirs: Vec<(PathBuf, (usize, Shape))> = by_dir.into_iter().collect();
    dirs.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then_with(|| a.0.cmp(&b.0)));
    dirs.truncate(4);

    dirs.into_iter()
        .enumerate()
        .map(|(i, (root, (_, shape)))| Source {
            id:    Box::leak(format!("trouve{i}").into_boxed_str()),
            label: "Trouvé",
            root,
            shape,
            depth: 3,
        })
        .collect()
}
