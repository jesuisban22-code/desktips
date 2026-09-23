//! Bureau's transcript engine.
//!
//! `sources` says where each assistant keeps its conversations, `evt` turns a
//! JSONL line into a normalised event, and `watch` ties the two together: an
//! initial tail of whatever is recent, then a file watcher for everything
//! after. Nothing here knows about Tauri, a window or a webview — the caller
//! supplies a [`Sink`] and receives events.

pub mod bridge;
pub mod evt;
pub mod launch;
pub mod solo;
pub mod sources;
pub mod update;
pub mod watch;

pub use evt::{Evt, EvtKind, Usage};
pub use sources::{Shape, Source};
pub use bridge::{Buffered, Transport};
pub use watch::{Sink, SourceInfo, Status};
