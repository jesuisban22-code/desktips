//! A stand-in for `tauri`, carrying only the API surface Bureau's shell uses —
//! with the signatures copied from tauri 2.11.5's own sources.
//!
//! WHY THIS EXISTS. The shell (`src/lib.rs`, `src/tray.rs`) cannot be compiled
//! without a webview toolchain, which this project has never had. It was
//! therefore only ever type-checked by the Windows build on the user's machine,
//! and it broke there twice: once on a `PathBuf` passed where a `&Source` was
//! expected, once on `Arc::clone(&state)` where `State<'_, T>` is not `&T`.
//! Each break cost a fifteen-minute build and a round trip.
//!
//! Compiling the real shell against this catches that entire class before it
//! ships. It proves the shell is well-typed AGAINST THESE SIGNATURES — so when
//! a signature here drifts from the real crate, this stops being evidence.
//! Anything changed here must be checked against the vendored source first.

pub use bureau_stub_macros::command;

use std::marker::PhantomData;

// ── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

// ── Runtime ──────────────────────────────────────────────────────────────────

pub trait Runtime: Send + Sync + 'static {}

#[derive(Debug, Clone, Copy)]
pub struct Wry;
impl Runtime for Wry {}

// ── Managed state ────────────────────────────────────────────────────────────

pub struct State<'r, T: Send + Sync + 'static>(&'r T);

impl<'r, T: Send + Sync + 'static> State<'r, T> {
    pub fn inner(&self) -> &'r T {
        self.0
    }
}

impl<T: Send + Sync + 'static> std::ops::Deref for State<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.0
    }
}

// ── Images ───────────────────────────────────────────────────────────────────

pub mod image {
    #[derive(Clone)]
    pub struct Image<'a>(pub std::marker::PhantomData<&'a ()>);
}

// ── Manager ──────────────────────────────────────────────────────────────────

pub trait Manager<R: Runtime> {
    fn app_handle(&self) -> &AppHandle<R>;

    fn manage<T>(&self, _state: T) -> bool
    where
        T: Send + Sync + 'static,
    {
        true
    }

    fn try_state<T>(&self) -> Option<State<'_, T>>
    where
        T: Send + Sync + 'static,
    {
        None
    }

    fn get_webview_window(&self, _label: &str) -> Option<WebviewWindow<R>> {
        None
    }
}

pub trait Emitter<R: Runtime> {
    fn emit<S: serde::Serialize>(&self, event: &str, payload: S) -> Result<()>;
}

// ── App and handle ───────────────────────────────────────────────────────────

pub struct AppHandle<R: Runtime = Wry>(PhantomData<R>);

impl<R: Runtime> Clone for AppHandle<R> {
    fn clone(&self) -> Self {
        AppHandle(PhantomData)
    }
}

impl<R: Runtime> AppHandle<R> {
    pub fn default_window_icon(&self) -> Option<&image::Image<'_>> {
        None
    }
    pub fn exit(&self, _code: i32) {}
}

impl<R: Runtime> Manager<R> for AppHandle<R> {
    fn app_handle(&self) -> &AppHandle<R> {
        self
    }
}

impl<R: Runtime> Emitter<R> for AppHandle<R> {
    fn emit<S: serde::Serialize>(&self, _event: &str, _payload: S) -> Result<()> {
        Ok(())
    }
}

pub struct App<R: Runtime = Wry>(PhantomData<R>);

impl<R: Runtime> App<R> {
    pub fn handle(&self) -> &AppHandle<R> {
        Box::leak(Box::new(AppHandle(PhantomData)))
    }
    pub fn default_window_icon(&self) -> Option<&image::Image<'_>> {
        None
    }
}

impl<R: Runtime> Manager<R> for App<R> {
    fn app_handle(&self) -> &AppHandle<R> {
        self.handle()
    }
}

// ── Windows ──────────────────────────────────────────────────────────────────

pub struct WebviewWindow<R: Runtime = Wry>(PhantomData<R>);

impl<R: Runtime> WebviewWindow<R> {
    pub fn show(&self) -> Result<()> { Ok(()) }
    pub fn hide(&self) -> Result<()> { Ok(()) }
    pub fn unminimize(&self) -> Result<()> { Ok(()) }
    pub fn set_focus(&self) -> Result<()> { Ok(()) }
    // tauri-2.11.5 src/webview/webview_window.rs, lines 1812–2260.
    pub fn current_monitor(&self) -> Result<Option<Monitor>> { Ok(None) }
    pub fn primary_monitor(&self) -> Result<Option<Monitor>> { Ok(None) }
    pub fn set_decorations(&self, _decorations: bool) -> Result<()> { Ok(()) }
    pub fn set_always_on_top(&self, _always_on_top: bool) -> Result<()> { Ok(()) }
    pub fn set_size<S: Into<Size>>(&self, _size: S) -> Result<()> { Ok(()) }
    pub fn set_min_size<S: Into<Size>>(&self, _size: Option<S>) -> Result<()> { Ok(()) }
    pub fn set_position<Pos: Into<Position>>(&self, _position: Pos) -> Result<()> { Ok(()) }
}

// ── Geometry ─────────────────────────────────────────────────────────────────
//
// Re-exported by tauri from the `dpi` crate (tauri-2.11.5 src/lib.rs:218). The
// real conversions are bounded on dpi's `Pixel` trait; `Into<f64>` covers the
// f64 and i32 values the shell actually passes.

#[derive(Debug, Clone, Copy)]
pub struct LogicalSize<P> { pub width: P, pub height: P }
impl<P> LogicalSize<P> {
    pub const fn new(width: P, height: P) -> Self { Self { width, height } }
}

#[derive(Debug, Clone, Copy)]
pub struct PhysicalSize<P> { pub width: P, pub height: P }

#[derive(Debug, Clone, Copy)]
pub struct PhysicalPosition<P> { pub x: P, pub y: P }
impl<P> PhysicalPosition<P> {
    pub const fn new(x: P, y: P) -> Self { Self { x, y } }
}

pub enum Size { Logical(LogicalSize<f64>), Physical(PhysicalSize<u32>) }
impl<P: Into<f64>> From<LogicalSize<P>> for Size {
    fn from(s: LogicalSize<P>) -> Self { Size::Logical(LogicalSize::new(s.width.into(), s.height.into())) }
}

pub enum Position { Physical(PhysicalPosition<i32>) }
impl<P: Into<f64>> From<PhysicalPosition<P>> for Position {
    fn from(p: PhysicalPosition<P>) -> Self {
        Position::Physical(PhysicalPosition::new(p.x.into() as i32, p.y.into() as i32))
    }
}

/// tauri-runtime-2.11.3 src/dpi.rs:28.
#[derive(Debug, Clone, Copy)]
pub struct PhysicalRect<P, S> { pub position: PhysicalPosition<P>, pub size: PhysicalSize<S> }

/// tauri-2.11.5 src/window/mod.rs:58.
pub struct Monitor { work_area: PhysicalRect<i32, u32>, scale_factor: f64 }
impl Monitor {
    pub fn work_area(&self) -> &PhysicalRect<i32, u32> { &self.work_area }
    pub fn scale_factor(&self) -> f64 { self.scale_factor }
}

pub struct CloseRequestApi;
impl CloseRequestApi {
    pub fn prevent_close(&self) {}
}

#[non_exhaustive]
pub enum WindowEvent {
    CloseRequested { api: CloseRequestApi, _unused: () },
    Destroyed,
}

// ── Menus ────────────────────────────────────────────────────────────────────

pub mod menu {
    use super::{Manager, Result, Runtime};

    #[derive(Clone, PartialEq, Eq)]
    pub struct MenuId(pub String);

    impl MenuId {
        pub fn as_ref(&self) -> &str {
            &self.0
        }
    }

    impl<T: Into<String>> From<T> for MenuId {
        fn from(v: T) -> Self {
            MenuId(v.into())
        }
    }

    pub struct MenuEvent {
        pub id: MenuId,
    }

    pub trait IsMenuItem<R: Runtime> {}

    pub struct MenuItem<R: Runtime>(std::marker::PhantomData<R>);
    impl<R: Runtime> IsMenuItem<R> for MenuItem<R> {}
    impl<R: Runtime> MenuItem<R> {
        pub fn with_id<M, I, T, A>(
            _manager: &M,
            _id: I,
            _text: T,
            _enabled: bool,
            _accelerator: Option<A>,
        ) -> Result<Self>
        where
            M: Manager<R>,
            I: Into<MenuId>,
            T: AsRef<str>,
            A: AsRef<str>,
        {
            Ok(MenuItem(std::marker::PhantomData))
        }
    }

    pub struct CheckMenuItem<R: Runtime>(std::marker::PhantomData<R>);
    impl<R: Runtime> IsMenuItem<R> for CheckMenuItem<R> {}
    impl<R: Runtime> CheckMenuItem<R> {
        pub fn with_id<M, I, T, A>(
            _manager: &M,
            _id: I,
            _text: T,
            _enabled: bool,
            _checked: bool,
            _accelerator: Option<A>,
        ) -> Result<Self>
        where
            M: Manager<R>,
            I: Into<MenuId>,
            T: AsRef<str>,
            A: AsRef<str>,
        {
            Ok(CheckMenuItem(std::marker::PhantomData))
        }
        pub fn set_checked(&self, _checked: bool) -> Result<()> {
            Ok(())
        }
    }
    impl<R: Runtime> Clone for CheckMenuItem<R> {
        fn clone(&self) -> Self {
            CheckMenuItem(std::marker::PhantomData)
        }
    }

    pub struct PredefinedMenuItem<R: Runtime>(std::marker::PhantomData<R>);
    impl<R: Runtime> IsMenuItem<R> for PredefinedMenuItem<R> {}
    impl<R: Runtime> PredefinedMenuItem<R> {
        pub fn separator<M: Manager<R>>(_manager: &M) -> Result<Self> {
            Ok(PredefinedMenuItem(std::marker::PhantomData))
        }
    }

    pub trait ContextMenu {}

    pub struct Menu<R: Runtime>(std::marker::PhantomData<R>);
    impl<R: Runtime> ContextMenu for Menu<R> {}
    impl<R: Runtime> Menu<R> {
        pub fn with_items<M: Manager<R>>(
            _manager: &M,
            _items: &[&dyn IsMenuItem<R>],
        ) -> Result<Self> {
            Ok(Menu(std::marker::PhantomData))
        }
    }
}

// ── Tray ─────────────────────────────────────────────────────────────────────

pub mod tray {
    use super::{image::Image, menu::ContextMenu, menu::MenuEvent, AppHandle, Manager, Result, Runtime};

    #[derive(Clone, PartialEq, Eq)]
    pub struct TrayIconId(pub String);
    impl<T: Into<String>> From<T> for TrayIconId {
        fn from(v: T) -> Self {
            TrayIconId(v.into())
        }
    }

    #[derive(PartialEq, Eq, Clone, Copy)]
    pub enum MouseButton {
        Left,
        Right,
        Middle,
    }

    #[derive(PartialEq, Eq, Clone, Copy)]
    pub enum MouseButtonState {
        Up,
        Down,
    }

    #[non_exhaustive]
    pub enum TrayIconEvent {
        Click {
            id: TrayIconId,
            button: MouseButton,
            button_state: MouseButtonState,
        },
        DoubleClick {
            id: TrayIconId,
            button: MouseButton,
        },
        Enter { id: TrayIconId },
        Leave { id: TrayIconId },
    }

    pub struct TrayIcon<R: Runtime>(std::marker::PhantomData<R>);
    impl<R: Runtime> TrayIcon<R> {
        pub fn app_handle(&self) -> &AppHandle<R> {
            Box::leak(Box::new(AppHandle(std::marker::PhantomData)))
        }
    }

    pub struct TrayIconBuilder<R: Runtime>(std::marker::PhantomData<R>);

    impl<R: Runtime> TrayIconBuilder<R> {
        pub fn with_id<I: Into<TrayIconId>>(_id: I) -> Self {
            TrayIconBuilder(std::marker::PhantomData)
        }
        pub fn icon(self, _icon: Image<'_>) -> Self {
            self
        }
        pub fn tooltip<S: AsRef<str>>(self, _s: S) -> Self {
            self
        }
        pub fn menu<M: ContextMenu>(self, _menu: &M) -> Self {
            self
        }
        pub fn show_menu_on_left_click(self, _enable: bool) -> Self {
            self
        }
        pub fn on_tray_icon_event<F: Fn(&TrayIcon<R>, TrayIconEvent) + Sync + Send + 'static>(
            self,
            _f: F,
        ) -> Self {
            self
        }
        pub fn on_menu_event<F: Fn(&AppHandle<R>, MenuEvent) + Sync + Send + 'static>(
            self,
            _f: F,
        ) -> Self {
            self
        }
        pub fn build<M: Manager<R>>(self, _manager: &M) -> Result<TrayIcon<R>> {
            Ok(TrayIcon(std::marker::PhantomData))
        }
    }
}

// ── Plugins and builder ──────────────────────────────────────────────────────

pub mod plugin {
    pub struct TauriPlugin<R>(pub std::marker::PhantomData<R>);
}

pub struct Context;

pub struct Invoke;

pub struct Builder<R: Runtime = Wry>(PhantomData<R>);

impl Builder<Wry> {
    pub fn default() -> Self {
        Builder(PhantomData)
    }
}

impl<R: Runtime> Builder<R> {
    pub fn plugin(self, _p: plugin::TauriPlugin<R>) -> Self {
        self
    }
    pub fn setup<F>(self, _f: F) -> Self
    where
        F: FnOnce(&mut App<R>) -> std::result::Result<(), Box<dyn std::error::Error>> + Send + 'static,
    {
        self
    }
    pub fn on_window_event<F: Fn(&WebviewWindow<R>, &WindowEvent) + Send + Sync + 'static>(
        self,
        _f: F,
    ) -> Self {
        self
    }
    pub fn invoke_handler<F: Fn(Invoke) + Send + Sync + 'static>(self, _f: F) -> Self {
        self
    }
    pub fn run(self, _context: Context) -> Result<()> {
        Ok(())
    }
}

/// The real macro builds a dispatcher. Naming every function is enough to
/// catch the mistakes that matter here: a typo, or one that no longer exists.
#[macro_export]
macro_rules! generate_handler {
    [$($name:path),* $(,)?] => {{
        #[allow(unused)]
        fn _referenced() {
            $( let _ = $name; )*
        }
        |_invoke: $crate::Invoke| {}
    }};
}

#[macro_export]
macro_rules! generate_context {
    () => {
        $crate::Context
    };
}
