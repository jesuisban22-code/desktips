//! Finding transcripts, tailing them, and watching for what comes next.
//!
//! The caller passes a [`Sink`]. Everything the engine learns — events, and a
//! status describing what it found and where it looked — goes there. That is
//! the whole interface, which is what lets this be tested without a webview.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use serde::Serialize;

use crate::evt::{parse_line_ctx, Ctx, Evt};
use crate::sources::{self, Source};

// ── What the engine reports ──────────────────────────────────────────────────

/// One assistant, and whether this machine actually has it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SourceInfo {
    pub id:          String,
    pub label:       String,
    /// Where Bureau looked. Shown to the user when nothing was found, because
    /// "no assistants detected" without the paths is impossible to act on.
    pub root:        String,
    pub present:     bool,
    pub transcripts: usize,
}

/// A snapshot of what Bureau is watching. Emitted at startup, and again
/// whenever the set of installed assistants changes.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Status {
    pub sources:     Vec<SourceInfo>,
    /// True while the counts are still being worked out, so the window can say
    /// "je regarde" rather than "rien trouvé".
    #[serde(default)]
    pub scanning:    bool,
    /// Total transcripts found across every present source.
    pub transcripts: usize,
    /// How many of those were recent enough to replay.
    pub active:      usize,
    pub watching:    bool,
}

/// Where the engine sends what it finds.
pub trait Sink: Send + Sync + 'static {
    fn evt(&self, evt: &Evt);
    fn status(&self, status: &Status);
    /// A line worth putting in front of the user rather than only in a log.
    fn note(&self, _message: &str) {}
}

// ── Transcript identification ────────────────────────────────────────────────

/// Is this a transcript we should read?
///
/// Sub-agent transcripts are nested several levels down, under
/// `<session>/subagents/workflows/<run>/agent-*.jsonl`, so the scan recurses.
/// `journal.jsonl` sits in the same directory but is workflow bookkeeping, not
/// a transcript, and parses to nothing useful.
pub fn is_transcript(p: &Path) -> bool {
    if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return false
    }
    !matches!(p.file_name().and_then(|n| n.to_str()), Some("journal.jsonl"))
}

/// Collect every transcript under `dir`, down to `max_depth` levels.
/// A folder nobody expected can hold an absurd number of files. The window
/// waits on this, so it gives up rather than hanging.
const MAX_FILES: usize = 4000;

pub fn collect_transcripts(dir: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(dir, &mut out, 0, max_depth);
    out.sort();
    out.truncate(MAX_FILES);
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize, max_depth: usize) {
    if depth > max_depth || out.len() >= MAX_FILES {
        return
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        // A symlinked tree can loop; is_dir follows links, so bound by depth.
        if p.is_dir() {
            walk(&p, out, depth + 1, max_depth);
        } else if is_transcript(&p) {
            out.push(p);
        }
    }
}

/// The conversation a file belongs to, when its lines do not say so.
fn session_hint(path: &Path) -> String {
    path.file_stem().and_then(|s| s.to_str()).unwrap_or("session").to_string()
}

// ── Reading ──────────────────────────────────────────────────────────────────

/// How far back a transcript counts as "still happening". Older sessions are
/// history, not activity, and replaying them on launch buries whatever the
/// user actually just did.
pub const RECENT: Duration = Duration::from_secs(6 * 60 * 60);

/// Lines replayed per transcript at startup. Eight transcripts × 200 lines put
/// 1600 archived events into the room the moment the window opened.
pub const TAIL_LINES: usize = 80;

/// What has been read, and what is worth re-checking often.
///
/// The `hot` list exists because of a real machine with 2266 conversations:
/// once every one of them had an offset, the three-second sweep was stat-ing
/// 2266 files a tick, for ever, to learn nothing. Only a handful are ever
/// being written to. Everything else is caught by the slower rescan.
pub struct Tracker {
    offsets: Mutex<HashMap<PathBuf, u64>>,
    hot:     Mutex<Vec<PathBuf>>,
}

pub type Offsets = Arc<Tracker>;

/// How many files the quick sweep will look at.
const MAX_HOT: usize = 64;

pub fn offsets() -> Offsets {
    Arc::new(Tracker { offsets: Mutex::new(HashMap::new()), hot: Mutex::new(Vec::new()) })
}

impl Tracker {
    /// Move a file to the front of the queue of things worth watching closely.
    fn touch(&self, path: &Path) {
        let mut h = self.hot.lock().unwrap();
        if let Some(i) = h.iter().position(|x| x == path) {
            h.remove(i);
        }
        h.push(path.to_path_buf());
        if h.len() > MAX_HOT {
            h.remove(0);
        }
    }

    fn hot_list(&self) -> Vec<PathBuf> {
        self.hot.lock().unwrap().clone()
    }

    fn known(&self, path: &Path) -> bool {
        self.offsets.lock().unwrap().contains_key(path)
    }
}

/// Parse the last `last_n` lines of a file. Pure — used by the tail, by the
/// scan CLI and by the tests.
pub fn tail_events(src: &Source, path: &Path, last_n: usize) -> Vec<Evt> {
    let Ok(content) = std::fs::read_to_string(path) else { return Vec::new() };
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(last_n);
    let hint = session_hint(path);
    lines[start..]
        .iter()
        .filter_map(|line| {
            parse_line_ctx(line, Ctx { source: src.id, shape: src.shape, session_hint: &hint })
        })
        .collect()
}

/// Read whatever has been appended since we last looked.
///
/// Files get rewritten as well as appended to — a rotated or truncated
/// transcript is shorter than our stored offset, and seeking past its end made
/// the file silently go dead for the rest of the session. Shrinking resets.
pub fn read_new(src: &Source, path: &Path, offsets: &Offsets) -> Vec<Evt> {
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut map = offsets.offsets.lock().unwrap();
    let offset = map.entry(path.to_path_buf()).or_insert(0);
    if len < *offset {
        *offset = 0;
    }
    if len == *offset {
        return Vec::new()
    }

    let Ok(mut file) = File::open(path) else { return Vec::new() };
    if file.seek(SeekFrom::Start(*offset)).is_err() {
        return Vec::new()
    }

    let hint = session_hint(path);
    let mut reader = BufReader::new(&mut file);
    let mut line = String::new();
    let mut consumed = 0u64;
    let mut out = Vec::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(n) => {
                // Only count a line once it is terminated. A writer that is
                // mid-append leaves a partial last line; consuming it would
                // skip the rest of that line forever.
                if !line.ends_with('\n') {
                    break
                }
                consumed += n as u64;
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue
                }
                let ctx = Ctx { source: src.id, shape: src.shape, session_hint: &hint };
                if let Some(evt) = parse_line_ctx(trimmed, ctx) {
                    out.push(evt);
                }
            }
            Err(_) => break,
        }
    }

    *offset += consumed;
    out
}

/// Record a file as fully read without emitting any of it.
pub fn mark_read(path: &Path, offsets: &Offsets) {
    if let Ok(meta) = std::fs::metadata(path) {
        offsets.offsets.lock().unwrap().insert(path.to_path_buf(), meta.len());
    }
}

// ── Status ───────────────────────────────────────────────────────────────────

fn is_fresh(p: &Path, now: SystemTime) -> bool {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .map(|t| now.duration_since(t).unwrap_or(Duration::ZERO) < RECENT)
        .unwrap_or(false)
}

/// What Bureau can say about itself instantly: which folders exist, without
/// counting what is in them.
///
/// Counting is the expensive part. One real machine had 2266 conversations —
/// 2141 of them Gemini's — and the full count ran three times before the first
/// word reached the window. The room said "Bureau démarre…" the whole time,
/// which is indistinguishable from broken.
pub fn quick_status() -> Status {
    let drop = sources::drop_dir();
    let mut entries: Vec<(String, String, std::path::PathBuf)> = sources::catalogue()
        .into_iter()
        .map(|s| (s.id.to_string(), s.label.to_string(), s.root))
        .collect();
    entries.push(("cloud".into(), "Cloud (dossier de dépôt)".into(), drop));
    for (i, root) in sources::extra_dirs().into_iter().enumerate() {
        entries.push((format!("watch{i}"), "Surveillé".into(), root));
    }

    let sources = entries
        .into_iter()
        .map(|(id, label, root)| SourceInfo {
            id,
            label,
            present: root.is_dir(),
            root: root.to_string_lossy().to_string(),
            transcripts: 0,
        })
        .collect();

    Status { sources, transcripts: 0, active: 0, watching: false, scanning: true }
}

/// Look at every assistant Bureau knows about and report what is there.
///
/// The drop folder is always listed, even when empty: a conversation running
/// in the cloud leaves nothing on this disk, and the only way anyone can find
/// that out is by being shown the folder to drop it into.
pub fn survey() -> Status {
    let now = SystemTime::now();
    let mut sources = Vec::new();
    let mut transcripts = 0usize;
    let mut active = 0usize;

    let drop = sources::drop_dir();
    let mut entries: Vec<(String, String, std::path::PathBuf, usize)> = sources::catalogue()
        .into_iter()
        .map(|s| (s.id.to_string(), s.label.to_string(), s.root, s.depth))
        .collect();
    entries.push(("cloud".into(), "Cloud (dossier de dépôt)".into(), drop, 6));
    for (i, root) in sources::extra_dirs().into_iter().enumerate() {
        entries.push((format!("watch{i}"), "Surveillé".into(), root, 6));
    }

    // No autodiscover here. This function is awaited by the window, and on a
    // machine with a real history the widened search took over a minute —
    // measured, not guessed. Searching is the engine's job, in the background;
    // survey only reports what is already known.
    for (id, label, root, depth) in entries {
        let present = root.is_dir();
        let files = if present { collect_transcripts(&root, depth) } else { Vec::new() };
        transcripts += files.len();
        active += files.iter().filter(|p| is_fresh(p, now)).count();
        sources.push(SourceInfo {
            id,
            label,
            root: root.to_string_lossy().to_string(),
            present,
            transcripts: files.len(),
        });
    }

    Status { sources, transcripts, active, watching: false, scanning: false }
}

// ── The engine ───────────────────────────────────────────────────────────────

/// Replay the recent tail of every transcript a source owns, oldest file first
/// so the history arrives roughly in the order it happened. Files that are
/// merely old still get an offset, so later writes to them are picked up
/// without replaying their whole history.
pub fn tail_source(sink: &dyn Sink, src: &Source, offsets: &Offsets) {
    let mut files = collect_transcripts(&src.root, src.depth);
    files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());

    let now = SystemTime::now();
    for p in &files {
        mark_read(p, offsets);
        if is_fresh(p, now) {
            // Only what is live goes on the quick sweep; the rest is history.
            offsets.touch(p);
            for evt in tail_events(src, p, TAIL_LINES) {
                sink.evt(&evt);
            }
        }
    }
}

/// Watch one folder chosen by hand, now and after a restart.
///
/// Automatic detection is a list of guesses about where each tool stores its
/// conversations, plus a bounded search. Both can be wrong on a given machine,
/// and when they are the honest answer is to let the person point at the
/// folder themselves rather than leave them with an empty room.
pub fn add_folder(sink: Arc<dyn Sink>, path: PathBuf) -> anyhow::Result<usize> {
    if !path.is_dir() {
        anyhow::bail!("ce dossier n'existe pas");
    }
    let files = collect_transcripts(&path, 6);
    sources::remember_folder(&path)?;

    let id: &'static str = Box::leak(
        format!("manuel-{}", path.to_string_lossy().len()).into_boxed_str(),
    );
    let src = Source { id, label: "Ajouté à la main", root: path.clone(), shape: crate::sources::Shape::Anthropic, depth: 6 };

    let offsets = offsets();
    tail_source(sink.as_ref(), &src, &offsets);

    // Its own watcher thread: simpler than reaching into the running one, and
    // a folder added by hand is rare enough that a thread each is fine.
    std::thread::spawn(move || watch_one(sink, src, offsets));

    Ok(files.len())
}

/// Run forever: tail what exists, then watch for changes.
///
/// If no assistant is installed yet the engine does not give up — it keeps
/// surveying, so launching Claude Code after Bureau brings the room to life
/// without a restart. That used to be a one-shot poll that broke out of its
/// loop and never rebuilt the watcher.
pub fn run(sink: Arc<dyn Sink>) -> anyhow::Result<()> {
    let offsets = offsets();

    // Create the drop folder before the first survey, so it is always there to
    // be shown and used rather than being a path the user has to invent.
    if let Err(e) = sources::ensure_drop_dir() {
        sink.note(&format!("Impossible de créer le dossier de dépôt : {e}"));
    }

    // Before anything slow: say which folders exist. is_dir() on a handful of
    // paths costs nothing, and it turns a blank "Bureau démarre…" into a list
    // the user can read while the counting happens.
    sink.status(&quick_status());

    let mut found = sources::discover();
    if count_transcripts(&found) == 0 {
        for s in sources::autodiscover() {
            sink.note(&format!("Conversations trouvées ailleurs : {}", s.root.display()));
            found.push(s);
        }
    }

    // Watch everything, including folders that are empty right now.
    //
    // This used to sit in a `while nothing_found { sleep }` loop, and the
    // watcher was installed only after that loop exited. So on a machine with
    // no conversation yet, Bureau span forever announcing that it was still
    // looking — with nothing actually watching the folders where a
    // conversation would appear. Searching in a loop and never finding is
    // precisely what that code did.
    for src in &found {
        tail_source(sink.as_ref(), src, &offsets);
    }

    let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(Duration::from_millis(120), tx)?;
    let mut watching = 0usize;
    for src in &found {
        match debouncer.watcher().watch(&src.root, RecursiveMode::Recursive) {
            Ok(()) => watching += 1,
            Err(e) => sink.note(&format!("Impossible de surveiller {} : {e}", src.root.display())),
        }
    }

    let mut status = survey();
    status.watching = watching > 0;
    sink.status(&status);

    if count_transcripts(&found) == 0 {
        sink.note(
            "Aucune conversation pour l'instant. Les dossiers sont surveillés : \
             dès qu'une conversation démarre, la pièce se remplit.",
        );
    }

    // Keep looking in the background — a tool installed later, or a folder
    // that only appears once its first conversation is written. This is a
    // thread precisely so that it cannot stop the watcher above from running.
    {
        let sink = Arc::clone(&sink);
        let offsets = Arc::clone(&offsets);
        let mut known: Vec<PathBuf> = found.iter().map(|s| s.root.clone()).collect();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(20));

            let mut fresh: Vec<Source> = sources::discover()
                .into_iter()
                .filter(|s| !known.contains(&s.root))
                .collect();
            if fresh.is_empty() && known.iter().all(|r| collect_transcripts(r, 6).is_empty()) {
                // Still nothing anywhere: widen the search again, in case the
                // conversation landed somewhere the catalogue never listed.
                fresh = sources::autodiscover()
                    .into_iter()
                    .filter(|s| !known.contains(&s.root))
                    .collect();
            }
            if fresh.is_empty() {
                continue
            }

            for src in fresh {
                sink.note(&format!("Nouveau dossier suivi : {}", src.root.display()));
                known.push(src.root.clone());
                tail_source(sink.as_ref(), &src, &offsets);
                let sink = Arc::clone(&sink);
                let offsets = Arc::clone(&offsets);
                std::thread::spawn(move || watch_one(sink, src, offsets));
            }

            let mut s = survey();
            s.watching = true;
            sink.status(&s);
        });
    }

    let mut ticks = 0u32;
    loop {
        match rx.recv_timeout(SWEEP) {
            Ok(Ok(events)) => {
                for event in events {
                    let path = &event.path;
                    if !is_transcript(path) {
                        continue
                    }
                    let Some(src) = sources::source_for(&found, path) else { continue };
                    offsets.touch(path);
                    for evt in read_new(src, path, &offsets) {
                        sink.evt(&evt);
                    }
                }
            }
            Ok(Err(e)) => sink.note(&format!("Erreur de surveillance : {e:?}")),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                ticks = ticks.wrapping_add(1);
                let rescan = ticks % RESCAN_EVERY == 0;
                for src in &found {
                    sweep(sink.as_ref(), src, &offsets, rescan);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    Ok(())
}

/// Read whatever is new under a root, without waiting to be told.
///
/// The file watcher is a fast path, not a guarantee: it can miss a file
/// created in the moment between a thread starting and its watch being
/// installed, and on Windows it misses changes on some filesystems outright.
/// A conversation that slips through that gap would never be read again,
/// because nothing revisits a file it was not told about. This sweep is what
/// makes the engine actually reliable; the watcher only makes it quick.
fn sweep(sink: &dyn Sink, src: &Source, offsets: &Offsets, rescan: bool) {
    // The common case touches only files already known: a stat and, when the
    // length has not moved, nothing at all. Walking the whole tree every three
    // seconds meant thousands of directory entries a minute on a machine with
    // a real history — for almost never any news.
    if !rescan {
        for path in offsets.hot_list() {
            if !path.starts_with(&src.root) {
                continue
            }
            for evt in read_new(src, &path, offsets) {
                sink.evt(&evt);
            }
        }
        return
    }

    // The slow pass. A file we have never seen is new: read it. One we already
    // know is covered by the quick sweep once it goes hot.
    for path in collect_transcripts(&src.root, src.depth) {
        if !offsets.known(&path) {
            offsets.touch(&path);
        }
        for evt in read_new(src, &path, offsets) {
            sink.evt(&evt);
        }
    }
}

/// How often the cheap sweep runs, and how often it is a full rescan instead.
const SWEEP: Duration = Duration::from_secs(3);
const RESCAN_EVERY: u32 = 10;

fn count_transcripts(sources: &[Source]) -> usize {
    sources.iter().map(|s| collect_transcripts(&s.root, s.depth).len()).sum()
}

/// Tail and watch a single root, forever. Used for folders that turn up after
/// startup and for folders the user connects by hand.
fn watch_one(sink: Arc<dyn Sink>, src: Source, offsets: Offsets) {
    let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
    let Ok(mut deb) = new_debouncer(Duration::from_millis(120), tx) else { return };
    if let Err(e) = deb.watcher().watch(&src.root, RecursiveMode::Recursive) {
        sink.note(&format!("Impossible de surveiller {} : {e}", src.root.display()));
        return
    }
    // Catch anything written between this thread starting and the watch being
    // installed a few lines above.
    sweep(sink.as_ref(), &src, &offsets, true);

    let mut ticks = 0u32;
    loop {
        match rx.recv_timeout(SWEEP) {
            Ok(Ok(events)) => {
                for event in events {
                    if !is_transcript(&event.path) {
                        continue
                    }
                    offsets.touch(&event.path);
                    for evt in read_new(&src, &event.path, &offsets) {
                        sink.evt(&evt);
                    }
                }
            }
            Ok(Err(_)) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                ticks = ticks.wrapping_add(1);
                sweep(sink.as_ref(), &src, &offsets, ticks % RESCAN_EVERY == 0);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}
