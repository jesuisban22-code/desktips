//! Holding events until the window is listening.
//!
//! The engine starts before the webview has mounted, and anything emitted into
//! that gap is dropped — which is why the opening tail of a session used to
//! vanish and the room opened empty even mid-conversation. This buffers until
//! the frontend says it is listening, then replays in order.
//!
//! It lives here rather than in the Tauri shell so it can be tested: the shell
//! cannot be compiled without a webview toolchain, and untested buffering is
//! exactly the kind of thing that silently swallows a session.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::evt::Evt;
use crate::watch::{Sink, Status};

/// Where a buffered message ends up once the frontend is ready.
pub trait Transport: Send + Sync + 'static {
    fn evt(&self, evt: &Evt);
    fn status(&self, status: &Status);
    fn note(&self, message: &str);
}

/// A machine with a long history could otherwise hold tens of thousands of
/// events before the window ever opens.
pub const MAX_PENDING: usize = 4000;
/// Notes are advisory; a wall of them helps nobody.
pub const MAX_NOTES: usize = 32;

pub struct Buffered<T: Transport> {
    out:     T,
    ready:   AtomicBool,
    pending: Mutex<Vec<Evt>>,
    notes:   Mutex<Vec<String>>,
    /// Only the latest matters — it is a snapshot, not a log.
    status:  Mutex<Option<Status>>,
    dropped: Mutex<usize>,
}

impl<T: Transport> Buffered<T> {
    pub fn new(out: T) -> Self {
        Self {
            out,
            ready:   AtomicBool::new(false),
            pending: Mutex::new(Vec::new()),
            notes:   Mutex::new(Vec::new()),
            status:  Mutex::new(None),
            dropped: Mutex::new(0),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// How many events were discarded because the buffer was full.
    pub fn dropped(&self) -> usize {
        *self.dropped.lock().unwrap()
    }

    /// The frontend has its listener attached: replay everything held, status
    /// first so the HUD can describe what it is about to show.
    pub fn flush(&self) -> usize {
        self.ready.store(true, Ordering::SeqCst);

        if let Some(s) = self.status.lock().unwrap().clone() {
            self.out.status(&s);
        }
        for n in std::mem::take(&mut *self.notes.lock().unwrap()) {
            self.out.note(&n);
        }
        let drained = std::mem::take(&mut *self.pending.lock().unwrap());
        for evt in &drained {
            self.out.evt(evt);
        }
        drained.len()
    }

    pub fn last_status(&self) -> Option<Status> {
        self.status.lock().unwrap().clone()
    }
}

impl<T: Transport> Sink for Buffered<T> {
    fn evt(&self, evt: &Evt) {
        if self.is_ready() {
            self.out.evt(evt);
            return
        }
        let mut q = self.pending.lock().unwrap();
        if q.len() < MAX_PENDING {
            q.push(evt.clone());
        } else {
            *self.dropped.lock().unwrap() += 1;
        }
    }

    fn status(&self, status: &Status) {
        *self.status.lock().unwrap() = Some(status.clone());
        if self.is_ready() {
            self.out.status(status);
        }
    }

    fn note(&self, message: &str) {
        if self.is_ready() {
            self.out.note(message);
            return
        }
        let mut n = self.notes.lock().unwrap();
        if n.len() < MAX_NOTES {
            n.push(message.to_string());
        }
    }
}
