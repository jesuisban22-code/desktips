//! `bureau-scan` — what Bureau sees, printed.
//!
//! If the room looks empty, this says why: which assistants were found, where
//! Bureau looked, how many transcripts each has, and the events the most
//! recent one produces. It needs no window, so it also runs over SSH and in
//! CI, and it is what the tests drive.
//!
//!   bureau-scan               survey only
//!   bureau-scan --events      also print the events from recent transcripts
//!   bureau-scan --path <dir>  treat <dir> as a Claude transcript tree

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use bureau_core::sources::{self, Shape, Source};
use bureau_core::watch::{self, Sink, Status};
use bureau_core::Evt;

#[derive(Default)]
struct Collect {
    events: Mutex<Vec<Evt>>,
    quiet:  bool,
}

impl Sink for Collect {
    fn evt(&self, evt: &Evt) {
        self.events.lock().unwrap().push(evt.clone());
    }
    fn status(&self, _s: &Status) {}
    fn note(&self, m: &str) {
        if !self.quiet {
            eprintln!("{m}");
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let want_events = args.iter().any(|a| a == "--events");
    let json_out = args
        .iter()
        .position(|a| a == "--json")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);
    let override_path = args
        .iter()
        .position(|a| a == "--path")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);

    // Dump every event the recent transcripts produce, in time order, as the
    // array the frontend's ?replay= mode consumes. This is how the whole
    // pipeline gets exercised against genuine data without a webview.
    if let Some(out) = json_out {
        let sink = Arc::new(Collect { quiet: true, ..Default::default() });
        let roots: Vec<Source> = match &override_path {
            Some(root) => vec![Source {
                id: "claude", label: "Claude", root: root.clone(),
                shape: Shape::Anthropic, depth: 8,
            }],
            None => sources::discover(),
        };
        for src in &roots {
            for f in watch::collect_transcripts(&src.root, src.depth) {
                for e in watch::tail_events(src, &f, 100_000) {
                    sink.evt(&e);
                }
            }
        }
        let mut events = sink.events.lock().unwrap().clone();
        events.sort_by_key(|e| e.at);
        let json = serde_json::to_string(&events).expect("serialise");
        std::fs::write(&out, json).expect("write");
        println!("{} événement(s) écrit(s) dans {}", events.len(), out.display());
        return
    }

    if let Some(root) = override_path {
        let src = Source {
            id: "claude", label: "Claude", root: root.clone(), shape: Shape::Anthropic, depth: 8,
        };
        let files = watch::collect_transcripts(&root, src.depth);
        println!("{} : {} transcript(s)", root.display(), files.len());
        let mut total = 0usize;
        for f in &files {
            let evts = watch::tail_events(&src, f, 100_000);
            total += evts.len();
            println!("  {:>6} evt  {}", evts.len(), f.display());
            if want_events {
                for e in evts.iter().take(12) {
                    println!("       {:?}", e.kind);
                }
            }
        }
        println!("total {total} events");
        return
    }

    let status = watch::survey();
    let w = status.sources.iter().map(|s| s.label.len()).max().unwrap_or(8).max(6);
    println!("{:<w$}  {:>6}  {:<7}  {}", "SOURCE", "FICHIERS", "PRESENT", "CHEMIN", w = w);
    for s in &status.sources {
        println!(
            "{:<w$}  {:>6}  {:<7}  {}",
            s.label,
            s.transcripts,
            if s.present { "oui" } else { "non" },
            s.root,
            w = w,
        );
    }
    println!("\n{} transcript(s), dont {} récent(s)", status.transcripts, status.active);

    if !want_events {
        return
    }

    let sink = Arc::new(Collect { quiet: false, ..Default::default() });
    let offsets = watch::offsets();
    for src in sources::discover() {
        watch::tail_source(sink.as_ref(), &src, &offsets);
    }
    let events = sink.events.lock().unwrap();
    println!("\n{} événement(s) rejoué(s) au démarrage", events.len());
    for e in events.iter().rev().take(25).rev() {
        println!("  [{}] {} {:?}", e.source, &e.agent_id[..e.agent_id.len().min(8)], e.kind);
    }
}
