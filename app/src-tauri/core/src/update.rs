//! "Rechercher une mise à jour", from the project's GitHub Releases.
//!
//! The window asks GitHub for the latest release (a plain HTTPS request the
//! webview can make itself) and compares its tag with the running version. If
//! the person confirms, this module takes over: the release's setup.exe is
//! downloaded, Bureau is stopped, the installer runs silently and the new
//! Bureau is started — in a console window of its own, so there is something
//! to read if the download fails.
//!
//! The installer is not signed. What this module does insist on is that the
//! file comes from THIS project's releases on github.com: the URL is checked
//! against the configured repository before anything is written or run.

use std::process::Command;

/// `owner/name` of the GitHub repository the releases come from.
///
/// Set at build time: the release workflow passes `BUREAU_REPO` (its own
/// repository), and a local build reads `app/depot-github.txt`.
pub fn repo() -> Option<String> {
    let raw = option_env!("BUREAU_REPO").unwrap_or(include_str!("../../../depot-github.txt"));
    let r = raw
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))?
        .trim_start_matches("https://github.com/")
        .trim_end_matches(".git")
        .trim_matches('/')
        .to_string();
    valid_repo(&r).then_some(r)
}

fn valid_repo(r: &str) -> bool {
    let mut parts = r.split('/');
    let ok = |s: Option<&str>| {
        s.is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)))
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

/// A release asset of `repo`, and nothing that could escape a batch file.
pub fn is_release_asset(url: &str, repo: &str) -> bool {
    let prefix = format!("https://github.com/{repo}/releases/download/");
    url.starts_with(&prefix)
        && url.to_ascii_lowercase().ends_with(".exe")
        && url[prefix.len()..].chars().all(|c| c.is_ascii_alphanumeric() || "-_./+".contains(c))
        && !url.contains("..")
}

/// The batch file: download, stop, install, start.
pub fn script(url: &str) -> String {
    [
        "@echo off",
        "setlocal",
        "title Bureau - mise a jour",
        "echo.",
        "echo  Mise a jour de Bureau",
        "echo.",
        "set SETUP=%TEMP%\\Bureau-setup.exe",
        "echo  [1/3] Telechargement...",
        &format!(
            "powershell -NoProfile -Command \"$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '{url}' -OutFile $env:TEMP\\Bureau-setup.exe\""
        ),
        "if errorlevel 1 goto :fail",
        "if not exist \"%SETUP%\" goto :fail",
        // Only now: until the file is here the old Bureau keeps watching.
        "echo  [2/3] Installation...",
        "taskkill /IM bureau.exe /F >nul 2>&1",
        "timeout /t 1 /nobreak >nul",
        "\"%SETUP%\" /S",
        "if errorlevel 1 goto :fail_install",
        "echo  [3/3] Redemarrage...",
        "if exist \"%LOCALAPPDATA%\\Bureau\\bureau.exe\" start \"\" \"%LOCALAPPDATA%\\Bureau\\bureau.exe\"",
        "del \"%SETUP%\" >nul 2>&1",
        "echo.",
        "echo  Termine.",
        "timeout /t 3 >nul",
        "exit /b 0",
        ":fail",
        "echo.",
        "echo  ECHEC du telechargement. Verifie ta connexion. Bureau n'a pas ete touche.",
        "echo.",
        "pause",
        "exit /b 1",
        ":fail_install",
        "echo.",
        "echo  ECHEC de l'installation. Relance l'installeur a la main :",
        "echo    %SETUP%",
        "echo.",
        "pause",
        "exit /b 1",
    ]
    .join("\r\n")
        + "\r\n"
}

/// Confirmed by the person: starts the download-and-install in its own
/// console window and returns at once.
pub fn install(url: &str) -> Result<(), String> {
    let repo = repo().ok_or("Aucun dépôt GitHub configuré pour les mises à jour.")?;
    if !is_release_asset(url, &repo) {
        return Err(format!("Fichier refusé : il ne vient pas des versions de github.com/{repo}."));
    }
    let bat = std::env::temp_dir().join("bureau-mise-a-jour.bat");
    std::fs::write(&bat, script(url)).map_err(|e| format!("script de mise à jour : {e}"))?;

    let mut cmd = Command::new("cmd");
    cmd.arg("/c").arg(&bat);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("lancement de la mise à jour impossible : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: &str = "julyan/bureau";

    #[test]
    fn a_release_setup_of_the_repo_is_accepted() {
        assert!(is_release_asset(
            "https://github.com/julyan/bureau/releases/download/v0.2.0/Bureau_0.2.0_x64-setup.exe", R));
    }

    #[test]
    fn anything_else_is_refused() {
        for url in [
            "https://github.com/someone/else/releases/download/v1/Bureau-setup.exe",
            "https://evil.example/julyan/bureau/releases/download/v1/x.exe",
            "http://github.com/julyan/bureau/releases/download/v1/x.exe",
            "https://github.com/julyan/bureau/releases/download/v1/notes.txt",
            "https://github.com/julyan/bureau/releases/download/v1/x.exe' & calc & '.exe",
            "https://github.com/julyan/bureau/releases/download/../../x.exe",
        ] {
            assert!(!is_release_asset(url, R), "{url}");
        }
    }

    #[test]
    fn repo_names_are_owner_slash_name() {
        assert!(valid_repo("julyan/bureau"));
        assert!(valid_repo("Hs_julyan/bureau.app"));
        assert!(!valid_repo("julyan"));
        assert!(!valid_repo("a/b/c"));
        assert!(!valid_repo("a/b c"));
    }

    #[test]
    fn the_script_downloads_before_it_stops_the_running_app() {
        let s = script("https://github.com/julyan/bureau/releases/download/v1/B-setup.exe");
        let dl = s.find("Invoke-WebRequest").unwrap();
        let kill = s.find("taskkill").unwrap();
        assert!(dl < kill, "l'ancienne version doit tourner pendant le téléchargement");
        assert!(s.contains("/S"));
        assert!(s.contains("\r\n"));
    }
}
