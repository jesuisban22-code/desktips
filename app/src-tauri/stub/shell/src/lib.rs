//! The real shell, compiled against the stubs. Nothing of its own.
//!
//! `#[path]` makes `mod tray;` inside it resolve next to the real file, so
//! both shell sources are covered.
#[path = "../../../src/lib.rs"]
pub mod shell;
