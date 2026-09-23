//! The Tauri shell.
//!
//! Deliberately thin: it owns the window, the tray, and the wire to the
//! webview. Finding transcripts, reading them and holding events until the
//! window is listening all live in `bureau-core`, which has no webview
//! dependency and is covered by tests — this file is the only part that can
//! only be compiled on a machine with a webview toolchain, so there is as
//! little of it as possible.

mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bureau_core::bridge::{Buffered, Transport};
use bureau_core::solo::{self, Claim, Request};
use bureau_core::watch::{self, Sink, Status};
use bureau_core::Evt;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

/// Started as the widget (`--widget`: the Claude Code hook, or `/desktips`).
/// The window is already small when the page loads; the page is told once it
/// is listening, so it adopts the layout instead of resizing a second time.
struct Launch {
    widget: AtomicBool,
}

const WIDGET_W: f64 = 480.0;
const WIDGET_H: f64 = 340.0;
const WIDGET_MARGIN: f64 = 16.0;

/// Puts a message on the wire to the webview.
struct ToWindow(AppHandle);

impl Transport for ToWindow {
    fn evt(&self, evt: &Evt) {
        if let Err(e) = self.0.emit("bureau://evt", evt) {
            eprintln!("[bureau] emit evt: {e}");
        }
    }
    fn status(&self, status: &Status) {
        if let Err(e) = self.0.emit("bureau://status", status) {
            eprintln!("[bureau] emit status: {e}");
        }
    }
    fn note(&self, message: &str) {
        eprintln!("[bureau] {message}");
        let _ = self.0.emit("bureau://note", message);
    }
}

type Wire = Arc<Buffered<ToWindow>>;

// ── Commands ─────────────────────────────────────────────────────────────────

/// The frontend calls this once its listener is attached; everything the engine
/// produced in the meantime is replayed.
#[tauri::command]
fn frontend_ready(app: AppHandle) {
    if let Some(wire) = app.try_state::<Wire>() {
        let n = wire.flush();
        eprintln!("[bureau] {n} événement(s) tamponné(s) transmis");
    }
    if let Some(launch) = app.try_state::<Launch>() {
        if launch.widget.swap(false, Ordering::SeqCst) {
            let _ = app.emit("bureau://widget-set", serde_json::json!({ "on": true, "applied": true }));
        }
    }
}

/// A fresh survey on demand: which assistants exist, where Bureau looked, and
/// how many transcripts each has.
#[tauri::command]
fn bureau_status() -> Status {
    watch::survey()
}

/// Watch a folder the user picked, because detection missed it.
///
/// Returns how many conversations are in it, so the window can say something
/// true straight away instead of "ajouté" and an unchanged empty room.
#[tauri::command]
fn bureau_add_folder(app: AppHandle, path: String) -> Result<usize, String> {
    let wire = app.try_state::<Wire>().ok_or("moteur indisponible")?;
    // Two traps in one line, both of which broke the Windows build.
    // `wire.inner()`, not `&wire`: State<'_, T> is not &T, it only Derefs to
    // one. And clone FIRST, then coerce: Arc::clone(x) with an Arc<dyn Sink>
    // annotation infers T = dyn Sink and demands a &Arc<dyn Sink> it can
    // never be handed.
    let sink: Arc<dyn Sink> = wire.inner().clone();
    watch::add_folder(sink, std::path::PathBuf::from(path.trim())).map_err(|e| e.to_string())
}

/// The two settings that live outside the window: starting with Windows, and
/// opening when a Claude Code session starts (a file the hook reads).
#[derive(serde::Serialize)]
struct Prefs {
    autostart: bool,
    auto_open: bool,
}

fn prefs(app: &AppHandle) -> Prefs {
    Prefs {
        autostart: tray::autostart_enabled(app),
        auto_open: bureau_core::launch::auto_open_enabled(),
    }
}

#[tauri::command]
fn bureau_prefs(app: AppHandle) -> Prefs {
    prefs(&app)
}

/// Returns the settings as they now are, read back rather than assumed.
#[tauri::command]
fn bureau_set_pref(app: AppHandle, key: String, on: bool) -> Result<Prefs, String> {
    match key.as_str() {
        "autostart" => tray::set_autostart(&app, on)?,
        "auto_open" => bureau_core::launch::set_auto_open(on).map_err(|e| e.to_string())?,
        other => return Err(format!("réglage inconnu : {other}")),
    }
    tray::sync(&app);
    Ok(prefs(&app))
}

/// The GitHub repository updates come from (`owner/name`), if one is set.
#[tauri::command]
fn bureau_update_repo() -> Option<String> {
    bureau_core::update::repo()
}

/// Confirmed by the person: download that release's installer and swap the
/// program, in a console of its own. The URL is checked against the repository.
#[tauri::command]
fn bureau_update_install(url: String) -> Result<(), String> {
    bureau_core::update::install(&url)
}

/// Bring the main window back, wherever it went.
fn reveal(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Back into view without taking the keyboard: asked for from Claude Code,
/// where the person is typing.
fn reveal_quietly(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
    }
}

/// Small, borderless, on top, in the bottom-right corner of the work area —
/// set before the window is first shown, so it never flashes at full size.
fn place_widget(win: &WebviewWindow) {
    let _ = win.set_decorations(false);
    let _ = win.set_always_on_top(true);
    let _ = win.set_min_size(Some(LogicalSize::new(320.0, 220.0)));
    let _ = win.set_size(LogicalSize::new(WIDGET_W, WIDGET_H));
    let monitor = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let area = m.work_area();
        let sf = m.scale_factor();
        let x = area.position.x + area.size.width as i32 - ((WIDGET_W + WIDGET_MARGIN) * sf) as i32;
        let y = area.position.y + area.size.height as i32 - ((WIDGET_H + WIDGET_MARGIN) * sf) as i32;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

pub fn run() {
    let widget = std::env::args().any(|a| a == "--widget");

    // Closing Bureau hides it, so the desktop icon would otherwise start a
    // second process: a second window, a second empty room, in front of the
    // one that is actually working. Whoever gets here second hands the job to
    // whoever got here first and leaves — passing on what it was asked for.
    let claim = solo::claim_with(solo::PORT, if widget { Request::Widget } else { Request::Show });
    if let Claim::Already = claim {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(move |app| {
            if let Claim::First(listener) = claim {
                let handle = app.handle().clone();
                solo::serve(listener, move |request| match request {
                    Request::Widget => {
                        reveal_quietly(&handle);
                        let _ = handle.emit("bureau://widget-set", serde_json::json!({ "on": true }));
                    }
                    Request::Full => {
                        reveal(&handle);
                        let _ = handle.emit("bureau://widget-set", serde_json::json!({ "on": false }));
                    }
                    _ => reveal(&handle),
                });
            }

            // The window is created hidden and unfocused (tauri.conf.json), so
            // that a widget launch can take its shape first and then appear
            // without stealing the keyboard. An ordinary launch is shown and
            // focused straight away, as before.
            app.manage(Launch { widget: AtomicBool::new(widget) });
            if let Some(win) = app.get_webview_window("main") {
                if widget {
                    place_widget(&win);
                }
                let _ = win.show();
                if !widget {
                    let _ = win.set_focus();
                }
            }

            // A tray that fails to build must not take the app down with it:
            // the window is the product, the tray is a convenience.
            if let Err(e) = tray::build(app) {
                eprintln!("[bureau] barre des tâches indisponible : {e}");
            }

            let wire: Wire = Arc::new(Buffered::new(ToWindow(app.handle().clone())));
            app.manage(Arc::clone(&wire));

            let sink: Arc<dyn Sink> = wire;
            std::thread::spawn(move || {
                if let Err(e) = watch::run(sink) {
                    eprintln!("[bureau] moteur arrêté : {e}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides rather than quits: Bureau is a monitor and should
            // keep watching from the tray. The tray menu is the real way out,
            // and it says "Quitter", so this is not a trap.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            bureau_status,
            bureau_add_folder,
            bureau_prefs,
            bureau_set_pref,
            bureau_update_repo,
            bureau_update_install
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Bureau");
}
