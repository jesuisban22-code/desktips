//! Stand-in for tauri-plugin-shell: only `init`, which is all Bureau calls.
use tauri::{plugin::TauriPlugin, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    TauriPlugin(std::marker::PhantomData)
}
