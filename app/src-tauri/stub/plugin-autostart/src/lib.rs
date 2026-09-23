//! Stand-in for tauri-plugin-autostart. Signatures copied from 2.5.1.
use tauri::{plugin::TauriPlugin, Runtime};

#[derive(Default)]
pub enum MacosLauncher {
    #[default]
    LaunchAgent,
    AppleScript,
}

pub type Result<T> = std::result::Result<T, String>;

pub struct AutoLaunchManager;

impl AutoLaunchManager {
    pub fn enable(&self) -> Result<()> { Ok(()) }
    pub fn disable(&self) -> Result<()> { Ok(()) }
    pub fn is_enabled(&self) -> Result<bool> { Ok(false) }
}

pub fn init<R: Runtime>(
    _macos_launcher: MacosLauncher,
    _args: Option<Vec<&'static str>>,
) -> TauriPlugin<R> {
    TauriPlugin(std::marker::PhantomData)
}
