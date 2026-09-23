//! System tray: keep Bureau watching while its window is out of the way.
//!
//! Bureau is a monitor — you want it running whether or not you are looking at
//! it. So closing the window hides it rather than quitting, and the tray is how
//! you get it back or shut it down for real. Anything that makes the close
//! button not quit has to be obvious, which is why the menu says so plainly.

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_autostart::AutoLaunchManager;

/// The autostart plugin registers its manager in its own setup hook, which
/// runs before this one — but reading managed state that is missing panics,
/// and a tray that cannot be built takes the whole app down with it. So the
/// toggle degrades to "off and inert" rather than crashing.
fn autolaunch<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::State<'_, AutoLaunchManager>> {
    app.try_state::<AutoLaunchManager>()
}

/// The two check marks, kept so the settings panel can move them too: a menu
/// saying "on" for something the window just turned off would be a lie.
pub struct Checks<R: Runtime> {
    startup:  CheckMenuItem<R>,
    autoopen: CheckMenuItem<R>,
}

/// Whether Bureau starts with Windows. Off when the plugin is missing.
pub fn autostart_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    autolaunch(app).and_then(|m| m.is_enabled().ok()).unwrap_or(false)
}

pub fn set_autostart<R: Runtime>(app: &AppHandle<R>, on: bool) -> Result<(), String> {
    let auto = autolaunch(app).ok_or("démarrage automatique indisponible")?;
    let r = if on { auto.enable() } else { auto.disable() };
    r.map_err(|e| e.to_string())
}

/// Re-reads both settings from where they really live and moves the marks.
pub fn sync<R: Runtime>(app: &AppHandle<R>) {
    if let Some(checks) = app.try_state::<Checks<R>>() {
        let _ = checks.startup.set_checked(autostart_enabled(app));
        let _ = checks.autoopen.set_checked(bureau_core::launch::auto_open_enabled());
    }
}

/// Bring the main window back, wherever it went.
fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn build<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let handle = app.handle();

    let launch_on = autostart_enabled(handle);

    let show = MenuItem::with_id(handle, "show", "Afficher Bureau", true, None::<&str>)?;
    // The window owns its size and position, so the tray only asks it to
    // switch; the webview does the resizing and remembers where it was.
    let widget = MenuItem::with_id(handle, "widget", "Mode widget (petit, au premier plan)", true, None::<&str>)?;
    let startup = CheckMenuItem::with_id(
        handle, "startup", "Lancer au démarrage de Windows",
        true, launch_on, None::<&str>,
    )?;
    // Read by the Claude Code hook at the start of every session, through a
    // file rather than a setting: the hook is a separate little program.
    let with_claude = CheckMenuItem::with_id(
        handle, "autoopen", "S'ouvrir avec Claude Code (en widget)",
        true, bureau_core::launch::auto_open_enabled(), None::<&str>,
    )?;
    // The window asks "Confirmer / Annuler": the tray only opens it.
    let update = MenuItem::with_id(handle, "update", "Rechercher une mise à jour", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(handle)?;
    let quit = MenuItem::with_id(handle, "quit", "Quitter", true, None::<&str>)?;

    let menu = Menu::with_items(handle, &[&show, &widget, &startup, &with_claude, &update, &sep, &quit])?;
    handle.manage(Checks { startup: startup.clone(), autoopen: with_claude.clone() });

    // No bundled icon means no tray, not a panic that kills the app.
    let Some(icon) = app.default_window_icon().cloned() else {
        return Ok(())
    };

    TrayIconBuilder::with_id("bureau-tray")
        .icon(icon)
        .tooltip("Bureau — surveille Claude Code")
        .menu(&menu)
        // Left-click should reopen, which is what people expect of a tray app;
        // without this the only way back is the menu.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal(app),
            "widget" => {
                reveal(app);
                let _ = app.emit("bureau://widget", ());
            }
            "startup" => {
                let _ = set_autostart(app, !autostart_enabled(app));
                let _ = app.emit("bureau://prefs", ());
            }
            "autoopen" => {
                let on = !bureau_core::launch::auto_open_enabled();
                let _ = bureau_core::launch::set_auto_open(on);
                let _ = app.emit("bureau://prefs", ());
            }
            "update" => {
                reveal(app);
                let _ = app.emit("bureau://update-check", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(handle)?;

    Ok(())
}
