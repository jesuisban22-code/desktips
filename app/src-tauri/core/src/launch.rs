//! Opening Bureau from outside it.
//!
//! Two callers: the Claude Code hook when a session starts, and `/desktips`
//! when the person asks for the room. Both go through the single-instance line
//! first (see solo.rs): a running Bureau is asked, never duplicated.
//!
//! The session-start path is deliberately timid. It opens Bureau only if it is
//! not running at all, only as the small widget, and never takes the keyboard:
//! a window that jumps in front of a prompt being typed would be the fastest
//! way to get this feature switched off. Someone who closed Bureau during a
//! session is left alone — the hook asks "are you there?" and that is all.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::solo::{self, Request};
use crate::sources::bureau_dir;

/// The file whose presence means "do not open with Claude Code".
pub fn auto_open_flag() -> PathBuf {
    bureau_dir().join("autoopen.off")
}

pub fn auto_open_enabled() -> bool {
    !auto_open_flag().exists()
}

pub fn set_auto_open(on: bool) -> io::Result<()> {
    let flag = auto_open_flag();
    if on {
        match std::fs::remove_file(&flag) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    } else {
        std::fs::create_dir_all(bureau_dir())?;
        std::fs::write(flag, "Bureau ne s'ouvre plus tout seul au démarrage de Claude Code.\n")
    }
}

/// Where the application is, in the order it is most likely to be current:
/// an explicit override, the installed copy, then the build tree next to the
/// hook (`bureau\bureau-hook.exe` beside `bureau\app\…`).
pub fn find_exe() -> Option<PathBuf> {
    let me = std::env::current_exe().ok();
    candidates(
        std::env::var_os("BUREAU_EXE").map(PathBuf::from),
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        me.as_deref().and_then(Path::parent).map(Path::to_path_buf),
    )
    .into_iter()
    .find(|p| p.is_file() && Some(p.as_path()) != me.as_deref())
}

/// The places looked in, in order. Split out so it can be checked without
/// touching the environment of the test process.
pub fn candidates(explicit: Option<PathBuf>, local_app_data: Option<PathBuf>, beside: Option<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.extend(explicit);
    // The NSIS installer's per-user location. Not `…\Programs\Bureau`: that is
    // where lancer.bat used to look, and it never found anything there.
    if let Some(la) = local_app_data {
        out.push(la.join("Bureau").join("bureau.exe"));
    }
    if let Some(dir) = beside {
        out.push(dir.join("bureau.exe"));
        out.push(dir.join("app").join("src-tauri").join("target").join("release").join("bureau.exe"));
    }
    out
}

/// Start Bureau as its own process, detached from whoever started it: a hook's
/// process ends as soon as it returns, and Bureau must outlive it.
pub fn spawn(exe: &Path, widget: bool) -> io::Result<()> {
    let mut cmd = Command::new(exe);
    if widget {
        cmd.arg("--widget");
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // Out of the caller's job if it allows it, so closing Claude Code does
        // not take Bureau with it; if the job forbids breaking away, start
        // anyway rather than not at all.
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        if cmd.spawn().is_ok() {
            return Ok(());
        }
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ())
}

/// `/desktips`: bring Bureau up, starting it if need be. Says what happened.
pub fn open(request: Request) -> Result<&'static str, String> {
    if solo::send(solo::PORT, request) {
        return Ok("Bureau était déjà ouvert : fenêtre ramenée.");
    }
    let exe = find_exe().ok_or("bureau.exe introuvable (installe Bureau avec installeur.bat).")?;
    spawn(&exe, request == Request::Widget).map_err(|e| format!("lancement impossible : {e}"))?;
    Ok("Bureau démarre.")
}

/// Session start: open the widget if, and only if, nothing says not to.
pub fn open_for_session() -> Option<&'static str> {
    if !auto_open_enabled() {
        return None;
    }
    // Scripts and SDK runs start sessions too; nobody is watching those.
    if std::env::var("CLAUDE_CODE_ENTRYPOINT").map(|e| e.starts_with("sdk")).unwrap_or(false) {
        return None;
    }
    if solo::running() {
        return None;
    }
    let exe = find_exe()?;
    spawn(&exe, true).ok().map(|_| "Bureau démarre.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_installed_copy_is_preferred_to_the_build_tree() {
        let c = candidates(None, Some(PathBuf::from(r"C:\U\AppData\Local")), Some(PathBuf::from(r"C:\d\bureau")));
        assert_eq!(c[0], PathBuf::from(r"C:\U\AppData\Local\Bureau\bureau.exe"));
        assert!(c.iter().any(|p| p.ends_with(r"app\src-tauri\target\release\bureau.exe")));
    }

    #[test]
    fn an_explicit_path_wins() {
        let c = candidates(Some(PathBuf::from(r"D:\x\bureau.exe")), Some(PathBuf::from(r"C:\L")), None);
        assert_eq!(c[0], PathBuf::from(r"D:\x\bureau.exe"));
    }
}
