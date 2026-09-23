//! What the room depends on, asserted.
//!
//! Every one of these covers something that was actually broken at some point:
//! tool results arriving on `user` lines, sub-agents sharing a session id,
//! bookkeeping lines flooding the queue, a truncated file going dead, and a
//! half-written last line being swallowed.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use bureau_core::evt::{parse_line_ctx, Ctx, EvtKind};
use bureau_core::sources::{Shape, Source};
use bureau_core::watch;

fn claude(root: &Path) -> Source {
    Source { id: "claude", label: "Claude", root: root.to_path_buf(), shape: Shape::Anthropic, depth: 8 }
}

fn anthropic(line: &str) -> Option<bureau_core::Evt> {
    parse_line_ctx(line, Ctx { source: "claude", shape: Shape::Anthropic, session_hint: "s" })
}

/// Tests that point BUREAU_HOME somewhere safe must not run at the same time.
///
/// The process environment is global and cargo runs tests in parallel threads.
/// Three tests setting and clearing BUREAU_HOME independently clobbered each
/// other: one of them read the REAL ~/.bureau and found 58 files where it
/// expected 1. It passed here and failed on the machine it was written for,
/// which is the worst kind of test.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_bureau_home<T>(dir: &Path, body: impl FnOnce() -> T) -> T {
    let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    std::env::set_var("BUREAU_HOME", dir);
    let out = body();
    std::env::remove_var("BUREAU_HOME");
    drop(guard);
    out
}

/// Readers of the global config take the same lock as the writers.
///
/// A lock only works if EVERYONE takes it. Locking just the tests that set
/// BUREAU_HOME left the ones that merely call `survey()` free to run while it
/// was pointing at a temporary folder — which is how a test that reads the
/// real config kept seeing someone else's.
fn with_config<T>(body: impl FnOnce() -> T) -> T {
    let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let out = body();
    drop(guard);
    out
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("bureau-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

// ── Parsing ──────────────────────────────────────────────────────────────────

#[test]
fn tool_use_on_an_assistant_line_starts_a_tool() {
    let l = r#"{"type":"assistant","uuid":"u1","sessionId":"s","timestamp":"2026-01-01T00:00:00.000Z",
      "message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/b.rs"}}]}}"#;
    let e = anthropic(l).expect("parsed");
    match e.kind {
        EvtKind::ToolStart { tool_id, name, .. } => {
            assert_eq!(tool_id, "t1");
            assert_eq!(name, "Read");
        }
        other => panic!("expected ToolStart, got {other:?}"),
    }
}

#[test]
fn tool_result_arrives_on_a_user_line_not_an_assistant_one() {
    // This is the bug that made EvtKind::Error dead code and left every tool
    // running forever: results come back as `user` lines.
    let l = r#"{"type":"user","uuid":"u2","sessionId":"s",
      "message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#;
    let e = anthropic(l).expect("parsed");
    assert!(matches!(e.kind, EvtKind::ToolEnd { ref tool_id, ok: true, .. } if tool_id == "t1"));
}

#[test]
fn a_failed_tool_result_becomes_an_error() {
    let l = r#"{"type":"user","uuid":"u3","sessionId":"s",
      "message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"boom"}]}}"#;
    let e = anthropic(l).expect("parsed");
    assert!(matches!(e.kind, EvtKind::Error { .. }), "got {:?}", e.kind);
}

#[test]
fn a_subagent_keeps_its_own_id_even_though_it_shares_the_session() {
    let l = r#"{"type":"assistant","uuid":"u4","sessionId":"shared","isSidechain":true,
      "agentId":"agent-77","message":{"content":[{"type":"text","text":"hi"}]}}"#;
    let e = anthropic(l).expect("parsed");
    assert!(e.is_subagent);
    assert_eq!(e.agent_id, "agent-77", "sub-agents keyed by session collapse into one figure");
    assert_eq!(e.session_id, "shared");
}

#[test]
fn the_main_agent_is_not_a_subagent() {
    let l = r#"{"type":"assistant","uuid":"u5","sessionId":"s","message":{"content":[{"type":"text","text":"hi"}]}}"#;
    let e = anthropic(l).expect("parsed");
    assert!(!e.is_subagent);
    assert_eq!(e.agent_id, "main");
}

#[test]
fn bookkeeping_lines_produce_nothing() {
    for kind in ["attachment", "mode", "atis-latch", "frame-link", "last-prompt", "summary",
                 "custom-title", "ai-title", "bridge-session", "agent-name", "file-history-delta",
                 "permission-mode"] {
        let l = format!(r#"{{"type":"{kind}","uuid":"x","sessionId":"s"}}"#);
        assert!(anthropic(&l).is_none(), "{kind} should be dropped, not queued");
    }
}

#[test]
fn an_unrecognised_line_type_still_surfaces() {
    let l = r#"{"type":"something-new","uuid":"x","sessionId":"s"}"#;
    let e = anthropic(l).expect("parsed");
    assert!(matches!(e.kind, EvtKind::Unknown { .. }));
}

#[test]
fn malformed_json_is_skipped_not_fatal() {
    assert!(anthropic("{not json").is_none());
    assert!(anthropic("").is_none());
}

// ── What the person typed ────────────────────────────────────────────────────

fn prompt_of(line: &str) -> Option<String> {
    match anthropic(line)?.kind {
        EvtKind::Prompt { text } => Some(text),
        _ => None,
    }
}

#[test]
fn a_typed_request_becomes_a_prompt() {
    let l = r#"{"type":"user","uuid":"p1","sessionId":"s","message":{"role":"user","content":"corrige le bug du hook"}}"#;
    assert_eq!(prompt_of(l).as_deref(), Some("corrige le bug du hook"));
}

#[test]
fn the_ide_wrapper_is_not_part_of_the_request() {
    // Shape measured on this machine: the open file comes first, as its own block.
    let l = r#"{"type":"user","uuid":"p2","sessionId":"s","message":{"role":"user","content":[
      {"type":"text","text":"<ide_opened_file>The user opened the file c:\\x\\main.py in the IDE.</ide_opened_file>"},
      {"type":"text","text":"que fait le script"}]}}"#;
    assert_eq!(prompt_of(l).as_deref(), Some("que fait le script"));
}

#[test]
fn slash_commands_meta_lines_and_interruptions_are_not_requests() {
    let cmd = r#"{"type":"user","uuid":"p3","sessionId":"s","message":{"content":"<command-name>/model</command-name>\n<command-message>model</command-message>"}}"#;
    assert!(prompt_of(cmd).is_none());

    let meta = r#"{"type":"user","uuid":"p4","sessionId":"s","isMeta":true,"message":{"content":[{"type":"text","text":"Continue from where you left off."}]}}"#;
    assert!(prompt_of(meta).is_none());

    let stop = r#"{"type":"user","uuid":"p5","sessionId":"s","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#;
    let e = anthropic(stop).unwrap();
    assert!(matches!(e.kind, EvtKind::TurnEnd { ref reason } if reason == "interrupted"), "got {:?}", e.kind);
}

// ── Hints ────────────────────────────────────────────────────────────────────

fn hint_of(line: &str) -> String {
    match anthropic(line).unwrap().kind {
        EvtKind::ToolStart { hint, .. } => hint,
        other => panic!("expected ToolStart, got {other:?}"),
    }
}

#[test]
fn a_windows_path_is_shortened_to_its_file_name() {
    let l = r#"{"type":"assistant","uuid":"h1","sessionId":"s","message":{"content":[
      {"type":"tool_use","id":"t","name":"Edit","input":{"file_path":"C:\\Users\\Julyan\\bureau\\watch.rs"}}]}}"#;
    assert_eq!(hint_of(l), "watch.rs");
}

#[test]
fn an_mcp_tool_is_described_by_its_arguments_not_its_own_name() {
    let l = r#"{"type":"assistant","uuid":"h2","sessionId":"s","message":{"content":[
      {"type":"tool_use","id":"t","name":"mcp__Roblox_Studio__execute_luau","input":{"code":"print(workspace.Name)"}}]}}"#;
    assert_eq!(hint_of(l), "print(workspace.Name)");

    let bare = r#"{"type":"assistant","uuid":"h3","sessionId":"s","message":{"content":[
      {"type":"tool_use","id":"t","name":"mcp__x__get_state","input":{}}]}}"#;
    assert_eq!(hint_of(bare), "", "no hint beats repeating the tool's name");
}

// ── Tasks ────────────────────────────────────────────────────────────────────

#[test]
fn todo_write_replaces_the_list_and_task_create_adds_to_it() {
    use bureau_core::evt::{TodoItem, TodoOp};
    let w = r#"{"type":"assistant","uuid":"d1","sessionId":"s","message":{"content":[
      {"type":"tool_use","id":"t","name":"TodoWrite","input":{"todos":[
        {"content":"Lire le code","status":"completed","activeForm":"Lecture"},
        {"content":"Corriger","status":"in_progress","activeForm":"Correction"}]}}]}}"#;
    assert_eq!(anthropic(w).unwrap().todo, Some(TodoOp::Replace { items: vec![
        TodoItem { text: "Lire le code".into(), status: "completed".into() },
        TodoItem { text: "Corriger".into(), status: "in_progress".into() },
    ]}));

    // Real input shape, from a TaskCreate call on this machine.
    let c = r#"{"type":"assistant","uuid":"d2","sessionId":"s","message":{"content":[
      {"type":"tool_use","id":"t","name":"TaskCreate","input":{"subject":"Installer SDK .NET 6","description":"…","activeForm":"Installation"}}]}}"#;
    assert_eq!(anthropic(c).unwrap().todo, Some(TodoOp::Add { text: "Installer SDK .NET 6".into() }));
}

// ── Waiting on the person ────────────────────────────────────────────────────

#[test]
fn a_hook_attention_line_belongs_to_claude_not_to_the_drop_folder() {
    let l = r#"{"type":"bureau_attention","bureauSource":"claude","uuid":"a1","sessionId":"s1",
      "timestamp":"2026-09-23T10:00:00.000Z","reason":"permission","detail":"Bash · npm test"}"#;
    let e = parse_line_ctx(l, Ctx { source: "cloud", shape: Shape::Anthropic, session_hint: "x" }).unwrap();
    assert_eq!(e.source, "claude", "attributed to the folder, it would be a second figure");
    assert_eq!(e.session_id, "s1");
    assert!(matches!(e.kind, EvtKind::Attention { ref reason, ref detail }
        if reason == "permission" && detail == "Bash · npm test"), "got {:?}", e.kind);
}

#[test]
fn an_openai_items_line_is_understood() {
    let src = Source {
        id: "codex", label: "Codex", root: PathBuf::from("/tmp"),
        shape: Shape::OpenAiItems, depth: 4,
    };
    let l = r#"{"timestamp":"2026-01-01T00:00:00.000Z","type":"response_item",
      "payload":{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\"command\":\"ls\"}"}}"#;
    let e = parse_line_ctx(l, Ctx { source: src.id, shape: src.shape, session_hint: "sess" })
        .expect("the sniffer should find a function call");
    assert_eq!(e.source, "codex");
    assert!(
        matches!(e.kind, EvtKind::ToolStart { .. } | EvtKind::Unknown { .. }),
        "got {:?}", e.kind,
    );
}

// ── Discovery ────────────────────────────────────────────────────────────────

#[test]
fn discovery_recurses_to_subagents_and_skips_the_journal() {
    let d = tmp("discovery");
    let deep = d.join("sess").join("subagents").join("workflows").join("wf_1");
    fs::create_dir_all(&deep).unwrap();
    fs::write(d.join("sess.jsonl"), "").unwrap();
    fs::write(deep.join("agent-aaa.jsonl"), "").unwrap();
    fs::write(deep.join("journal.jsonl"), "").unwrap();
    fs::write(d.join("notes.txt"), "").unwrap();

    let found = watch::collect_transcripts(&d, 8);
    let names: Vec<String> =
        found.iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();

    assert!(names.contains(&"sess.jsonl".to_string()));
    assert!(names.contains(&"agent-aaa.jsonl".to_string()), "sub-agents live several levels down");
    assert!(!names.contains(&"journal.jsonl".to_string()), "journal is bookkeeping, not a transcript");
    assert!(!names.contains(&"notes.txt".to_string()));
    fs::remove_dir_all(&d).ok();
}

#[test]
fn depth_limit_is_respected() {
    let d = tmp("depth");
    let deep = d.join("a").join("b").join("c");
    fs::create_dir_all(&deep).unwrap();
    fs::write(deep.join("x.jsonl"), "").unwrap();
    assert_eq!(watch::collect_transcripts(&d, 1).len(), 0);
    assert_eq!(watch::collect_transcripts(&d, 3).len(), 1);
    fs::remove_dir_all(&d).ok();
}

// ── Incremental reading ──────────────────────────────────────────────────────

fn line(uuid: &str, tool: &str) -> String {
    format!(
        r#"{{"type":"assistant","uuid":"{uuid}","sessionId":"s","message":{{"content":[{{"type":"tool_use","id":"{tool}","name":"Read","input":{{}}}}]}}}}"#
    )
}

#[test]
fn only_newly_appended_lines_are_emitted() {
    let d = tmp("append");
    let f = d.join("s.jsonl");
    let src = claude(&d);
    let off = watch::offsets();

    fs::write(&f, format!("{}\n", line("a", "t1"))).unwrap();
    assert_eq!(watch::read_new(&src, &f, &off).len(), 1);
    assert_eq!(watch::read_new(&src, &f, &off).len(), 0, "re-reading must emit nothing");

    let mut h = fs::OpenOptions::new().append(true).open(&f).unwrap();
    writeln!(h, "{}", line("b", "t2")).unwrap();
    drop(h);
    let got = watch::read_new(&src, &f, &off);
    assert_eq!(got.len(), 1);
    assert!(matches!(&got[0].kind, EvtKind::ToolStart { tool_id, .. } if tool_id == "t2"));
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_truncated_file_is_re_read_rather_than_going_dead() {
    // Seeking past the end of a rewritten file made it silently stop producing
    // events for the rest of the session.
    let d = tmp("truncate");
    let f = d.join("s.jsonl");
    let src = claude(&d);
    let off = watch::offsets();

    fs::write(&f, format!("{}\n{}\n", line("a", "t1"), line("b", "t2"))).unwrap();
    assert_eq!(watch::read_new(&src, &f, &off).len(), 2);

    fs::write(&f, format!("{}\n", line("c", "t3"))).unwrap();
    let got = watch::read_new(&src, &f, &off);
    assert_eq!(got.len(), 1, "a shorter file must reset the offset");
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_half_written_last_line_is_left_for_next_time() {
    let d = tmp("partial");
    let f = d.join("s.jsonl");
    let src = claude(&d);
    let off = watch::offsets();

    let full = line("a", "t1");
    fs::write(&f, format!("{full}\n{}", &full[..20])).unwrap();
    assert_eq!(watch::read_new(&src, &f, &off).len(), 1, "only the terminated line");

    fs::write(&f, format!("{full}\n{}\n", line("b", "t2"))).unwrap();
    let got = watch::read_new(&src, &f, &off);
    assert_eq!(got.len(), 1, "the completed line must arrive, not be skipped");
    assert!(matches!(&got[0].kind, EvtKind::ToolStart { tool_id, .. } if tool_id == "t2"));
    fs::remove_dir_all(&d).ok();
}

#[test]
fn a_missing_root_surveys_cleanly() {
    // Never panic because an assistant is not installed.
    let s = with_config(watch::survey);
    assert!(!s.sources.is_empty());
    assert!(s.sources.iter().any(|x| x.id == "claude"));
    for src in &s.sources {
        assert!(!src.root.is_empty(), "every source must say where it looked");
    }
}

// ── Against whatever real transcripts this machine has ───────────────────────

#[test]
fn real_transcripts_on_this_machine_produce_tool_pairs() {
    let root = dirs::home_dir().unwrap_or_default().join(".claude").join("projects");
    if !root.is_dir() {
        eprintln!("no real transcripts here — skipping");
        return
    }
    let src = claude(&root);
    let files = watch::collect_transcripts(&root, 8);
    let mut starts = 0;
    let mut ends = 0;
    let mut subagents = 0;
    for f in &files {
        for e in watch::tail_events(&src, f, 100_000) {
            match e.kind {
                EvtKind::ToolStart { .. } => starts += 1,
                EvtKind::ToolEnd { .. } => ends += 1,
                _ => {}
            }
            if e.is_subagent {
                subagents += 1;
            }
        }
    }
    assert!(starts > 0, "no tool starts parsed out of {} real transcripts", files.len());
    assert!(ends > 0, "no tool ends parsed — results are on `user` lines");
    eprintln!("real data: {starts} starts, {ends} ends, {subagents} sub-agent lines");
}

// ── Buffering until the window is listening ──────────────────────────────────

use bureau_core::bridge::{Buffered, Transport};
use bureau_core::watch::Sink as _;
use std::sync::Mutex as SMutex;

#[derive(Default)]
struct Recorder {
    evts:    SMutex<Vec<String>>,
    notes:   SMutex<Vec<String>>,
    statuses: SMutex<usize>,
}

/// A newtype, because the orphan rule forbids implementing Transport for Arc.
#[derive(Clone)]
struct Shared(std::sync::Arc<Recorder>);

impl Transport for Shared {
    fn evt(&self, e: &bureau_core::Evt) {
        self.0.evts.lock().unwrap().push(e.id.clone());
    }
    fn status(&self, _s: &bureau_core::Status) {
        *self.0.statuses.lock().unwrap() += 1;
    }
    fn note(&self, m: &str) {
        self.0.notes.lock().unwrap().push(m.to_string());
    }
}

fn evt(id: &str) -> bureau_core::Evt {
    let l = format!(
        r#"{{"type":"assistant","uuid":"{id}","sessionId":"s","message":{{"content":[{{"type":"text","text":"x"}}]}}}}"#
    );
    anthropic(&l).unwrap()
}

#[test]
fn nothing_reaches_the_window_before_it_is_listening() {
    let rec = std::sync::Arc::new(Recorder::default());
    let b = Buffered::new(Shared(std::sync::Arc::clone(&rec)));

    b.evt(&evt("a"));
    b.evt(&evt("b"));
    b.note("hello");
    assert!(rec.evts.lock().unwrap().is_empty(), "emitted into the void");

    assert_eq!(b.flush(), 2);
    assert_eq!(*rec.evts.lock().unwrap(), vec!["a".to_string(), "b".to_string()],
        "the opening tail must arrive, in order");
    assert_eq!(rec.notes.lock().unwrap().len(), 1);
}

#[test]
fn after_flushing_events_go_straight_through() {
    let rec = std::sync::Arc::new(Recorder::default());
    let b = Buffered::new(Shared(std::sync::Arc::clone(&rec)));
    b.flush();
    b.evt(&evt("c"));
    assert_eq!(*rec.evts.lock().unwrap(), vec!["c".to_string()]);
}

#[test]
fn the_buffer_is_bounded_so_a_long_history_cannot_exhaust_memory() {
    let rec = std::sync::Arc::new(Recorder::default());
    let b = Buffered::new(Shared(std::sync::Arc::clone(&rec)));
    for i in 0..(bureau_core::bridge::MAX_PENDING + 50) {
        b.evt(&evt(&format!("e{i}")));
    }
    assert_eq!(b.flush(), bureau_core::bridge::MAX_PENDING);
    assert_eq!(b.dropped(), 50);
}

#[test]
fn the_status_survives_until_the_window_opens() {
    // The HUD needs to know what Bureau found even if the survey happened
    // seconds before the webview mounted.
    let rec = std::sync::Arc::new(Recorder::default());
    let b = Buffered::new(Shared(std::sync::Arc::clone(&rec)));
    let s = with_config(bureau_core::watch::survey);
    b.status(&s);
    assert_eq!(*rec.statuses.lock().unwrap(), 0);
    assert!(b.last_status().is_some());
    b.flush();
    assert_eq!(*rec.statuses.lock().unwrap(), 1);
}


// ── The drop folder for conversations that are not on this disk ──────────────

#[test]
fn a_transcript_dropped_in_the_cloud_folder_is_read_like_any_other() {
    // A Cowork session running in the cloud writes its transcript inside that
    // container; there is no file here to watch. What it CAN do is save into a
    // folder you have connected to it, so Bureau watches one of its own.
    let d = tmp("drop");
    with_bureau_home(&d, || {
        let drop = bureau_core::sources::ensure_drop_dir().expect("created");
        assert!(drop.is_dir(), "the drop folder must exist without the user creating it");
        assert!(drop.starts_with(&d), "drop dir {drop:?} should be under {d:?}");

        fs::write(drop.join("cowork-abc.jsonl"), format!("{}\n", line("a", "t1"))).unwrap();

        let found = bureau_core::sources::discover();
        let cloud = found.iter().find(|s| s.id == "cloud").expect("cloud source present");
        let files = watch::collect_transcripts(&cloud.root, cloud.depth);
        assert_eq!(files.len(), 1, "expected only the file just written, in {:?}", cloud.root);

        let evts = watch::tail_events(cloud, &files[0], 100);
        assert_eq!(evts.len(), 1);
        assert_eq!(evts[0].source, "cloud");
    });
    fs::remove_dir_all(&d).ok();
}

#[test]
fn watch_txt_adds_a_folder_of_your_own() {
    // No environment variable anywhere in this test. The previous version set
    // BUREAU_HOME, and the process environment is shared by every test cargo
    // runs in parallel — including ones that read the config without a lock.
    // It passed on my machine and failed on the user's, twice.
    let d = tmp("watchtxt");
    let extra = d.join("ailleurs");
    fs::create_dir_all(&extra).unwrap();

    fs::write(d.join("watch.txt"), format!("# un commentaire\n\n{}\n", extra.display())).unwrap();
    let dirs = bureau_core::sources::extra_dirs_in(&d);
    assert!(dirs.iter().any(|p| p == &extra), "watch.txt should add {extra:?}, got {dirs:?}");

    // A path that does not exist must be dropped rather than watched blindly.
    fs::write(d.join("watch.txt"), "/nexiste/vraiment/pas\n").unwrap();
    let dirs = bureau_core::sources::extra_dirs_in(&d);
    assert!(dirs.is_empty(), "a missing folder must not be watched, got {dirs:?}");

    // A comment-only file yields nothing rather than a phantom entry.
    fs::write(d.join("watch.txt"), "# rien ici\n\n").unwrap();
    assert!(bureau_core::sources::extra_dirs_in(&d).is_empty());

    fs::remove_dir_all(&d).ok();
}

#[test]
fn transcripts_in_an_unexpected_place_are_found_anyway() {
    // The catalogue is a list of paths written down from published layouts. On
    // a machine where a tool keeps its conversations somewhere else, that list
    // is simply wrong — and the old answer was an empty room and no reason.
    let d = tmp("hunt");
    let odd = d.join("Roaming").join("SomeVendor").join("chats").join("2026");
    fs::create_dir_all(&odd).unwrap();
    fs::write(odd.join("a-conversation.jsonl"), format!("{}\n", line("a", "t1"))).unwrap();
    // Noise that must not be mistaken for a transcript.
    fs::write(odd.join("telemetry.jsonl"), "{\"cpu\":12,\"mem\":88}\n").unwrap();
    fs::create_dir_all(d.join("node_modules").join("junk")).unwrap();
    fs::write(d.join("node_modules").join("junk").join("x.jsonl"), "{\"message\":1,\"type\":2}\n").unwrap();

    let found = with_bureau_home(&d.join(".bureau"), || {
        std::env::set_var("BUREAU_PROBE_ROOTS", &d);
        let out = bureau_core::sources::autodiscover();
        std::env::remove_var("BUREAU_PROBE_ROOTS");
        out
    });

    assert_eq!(found.len(), 1, "expected one discovered source, got {found:?}");
    let files = watch::collect_transcripts(&found[0].root, found[0].depth);
    let names: Vec<String> =
        files.iter().map(|p| p.file_name().unwrap().to_string_lossy().into()).collect();
    assert!(names.contains(&"a-conversation.jsonl".to_string()), "got {names:?}");
    assert!(!names.iter().any(|n| n == "x.jsonl"), "node_modules must be skipped");

    fs::remove_dir_all(&d).ok();
}

// ── The engine must never stop and wait ──────────────────────────────────────

#[test]
fn an_empty_folder_is_still_watched_so_the_first_conversation_arrives() {
    // The old engine sat in `while nothing_found { sleep }` and installed the
    // file watcher only after that loop exited. On a machine with no
    // conversation yet it announced, every five seconds, that it was still
    // looking — while nothing watched the folders where one would appear.
    // Searching in a loop and never finding was exactly what it did.
    use std::sync::{Arc, Mutex as SM};

    #[derive(Default)]
    struct Seen {
        evts:  SM<Vec<String>>,
        notes: SM<Vec<String>>,
    }
    struct S(Arc<Seen>);
    impl bureau_core::watch::Sink for S {
        fn evt(&self, e: &bureau_core::Evt) { self.0.evts.lock().unwrap().push(e.id.clone()) }
        fn status(&self, _s: &bureau_core::Status) {}
        fn note(&self, m: &str) { self.0.notes.lock().unwrap().push(m.into()) }
    }

    let d = tmp("empty-watch");
    let seen = Arc::new(Seen::default());
    let sink: Arc<dyn bureau_core::watch::Sink> = Arc::new(S(Arc::clone(&seen)));

    // The folder exists but holds nothing. Connecting it must succeed, not
    // block, and must leave something watching. Keep it out of the real
    // ~/.bureau: add_folder remembers the path, and a test has no business
    // editing someone's config.
    let home = d.join(".bureau");
    let n = with_bureau_home(&home, || {
        watch::add_folder(Arc::clone(&sink), d.clone()).expect("connects")
    });
    assert_eq!(n, 0, "no conversations yet — that is not a failure");

    // Now a conversation starts.
    fs::write(d.join("nouvelle.jsonl"), format!("{}\n", line("z", "t9"))).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    while std::time::Instant::now() < deadline {
        if !seen.evts.lock().unwrap().is_empty() {
            break
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    assert!(
        !seen.evts.lock().unwrap().is_empty(),
        "a conversation appearing in a watched folder must produce events; notes were {:?}",
        seen.notes.lock().unwrap(),
    );

    std::env::remove_var("BUREAU_HOME");
    fs::remove_dir_all(&d).ok();
}

// ── The hook: Claude Code says what it is doing, rather than being found ─────

#[test]
fn a_hook_line_becomes_the_same_events_as_a_transcript() {
    // Every other route guesses where conversations live. This one cannot be
    // wrong: Claude Code runs the hook itself and hands over the tool name.
    // The line it writes goes through the ordinary parser, so the room needs
    // to know nothing about hooks.
    let start = r#"{"type":"assistant","uuid":"h1","sessionId":"s9","timestamp":"2026-01-01T00:00:00.000Z",
      "message":{"role":"assistant","content":[{"type":"tool_use","id":"hook-s9-Read","name":"Read","input":{"file_path":"a.rs"}}]}}"#;
    let e = anthropic(start).expect("parsed");
    match e.kind {
        EvtKind::ToolStart { ref tool_id, ref name, .. } => {
            assert_eq!(tool_id, "hook-s9-Read");
            assert_eq!(name, "Read");
        }
        ref other => panic!("expected ToolStart, got {other:?}"),
    }

    let end = r#"{"type":"user","uuid":"h2","sessionId":"s9",
      "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"hook-s9-Read","is_error":false,"content":"ok"}]}}"#;
    assert!(matches!(
        anthropic(end).expect("parsed").kind,
        EvtKind::ToolEnd { ok: true, .. },
    ));

    let failed = r#"{"type":"user","uuid":"h3","sessionId":"s9",
      "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"hook-s9-Bash","is_error":true,"content":"échec"}]}}"#;
    assert!(matches!(anthropic(failed).expect("parsed").kind, EvtKind::Error { .. }));
}
