use std::sync::Mutex;

const MAC_TRAFFIC_LIGHT_X: f64 = 13.0;
// Matches the shared workspace header and right-panel tab-system height.
const MAC_HEADER_HEIGHT: f64 = 46.0;

/// Webview page zoom scales the DOM header the traffic lights sit in, but the
/// native buttons never zoom. The active factor is kept here so every chrome
/// application — boot, resize, focus, zoom change — lays the buttons out
/// against the zoomed header geometry.
pub struct WindowChromeZoom(Mutex<f64>);

impl Default for WindowChromeZoom {
    fn default() -> Self {
        Self(Mutex::new(1.0))
    }
}

impl WindowChromeZoom {
    fn factor(&self) -> f64 {
        // A poisoning panic cannot tear an f64 store, so the value stays true.
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Applies the scaled chrome outside a command context. The window config no
/// longer pins the traffic lights (the runtime would re-pin them unscaled on
/// every redraw), so lib.rs calls this before first paint and on `Resized`,
/// where AppKit re-lays the standard buttons out to their defaults.
pub fn reapply_window_chrome<R: tauri::Runtime>(window: &tauri::Window<R>) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;

        let scale = window.state::<WindowChromeZoom>().factor();
        if let Ok(ns_window) = window.ns_window() {
            let _ = apply_traffic_light_position(ns_window, scale);
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[tauri::command]
pub fn apply_macos_window_chrome(
    window: tauri::Window,
    zoom: tauri::State<'_, WindowChromeZoom>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        apply_traffic_light_position(
            window.ns_window().map_err(|error| error.to_string())?,
            zoom.factor(),
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, zoom);
        Ok(())
    }
}

#[tauri::command]
pub fn set_webview_zoom(
    window: tauri::WebviewWindow,
    zoom: tauri::State<'_, WindowChromeZoom>,
    scale_factor: f64,
) -> Result<(), String> {
    if !scale_factor.is_finite() {
        return Err("webview zoom scale must be finite".to_string());
    }

    let clamped = scale_factor.clamp(0.8, 1.2);
    // Hold the lock across zoom + store + chrome: concurrent zoom commands
    // serialize, so the webview zoom, the stored factor, and the button
    // layout always reflect a single command rather than an interleaving.
    // `set_zoom` posts to the event loop without waiting, so nothing under
    // this lock blocks on the main thread.
    let mut guard = zoom
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    window
        .set_zoom(clamped)
        .map_err(|error| error.to_string())?;
    *guard = clamped;

    #[cfg(target_os = "macos")]
    apply_traffic_light_position(
        window.ns_window().map_err(|error| error.to_string())?,
        clamped,
    )?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_traffic_light_position(
    ns_window: *mut std::ffi::c_void,
    scale: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
    use std::sync::OnceLock;

    // AppKit owns the initial layout; capture its pitch before the first
    // reposition so scaled applications never compound on their own output.
    static BASE_BUTTON_PITCH: OnceLock<f64> = OnceLock::new();

    unsafe {
        let ns_window = &*ns_window.cast::<NSWindow>();
        let close = ns_window
            .standardWindowButton(NSWindowButton::CloseButton)
            .ok_or_else(|| "close window button not found".to_string())?;
        let miniaturize = ns_window
            .standardWindowButton(NSWindowButton::MiniaturizeButton)
            .ok_or_else(|| "miniaturize window button not found".to_string())?;
        let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);
        let title_bar_container_view = close
            .superview()
            .and_then(|view| view.superview())
            .ok_or_else(|| "title bar container view not found".to_string())?;

        let close_rect = NSView::frame(&close);
        let title_bar_frame_height = (MAC_HEADER_HEIGHT * scale).max(close_rect.size.height);
        let mut title_bar_rect = NSView::frame(&title_bar_container_view);
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = ns_window.frame().size.height - title_bar_frame_height;
        title_bar_container_view.setFrame(title_bar_rect);

        let space_between = BASE_BUTTON_PITCH
            .get_or_init(|| NSView::frame(&miniaturize).origin.x - close_rect.origin.x)
            * scale;
        let button_y = (title_bar_frame_height - close_rect.size.height) / 2.0;
        let mut buttons = vec![close, miniaturize];
        if let Some(zoom) = zoom {
            buttons.push(zoom);
        }

        for (index, button) in buttons.into_iter().enumerate() {
            let mut rect = NSView::frame(&button);
            rect.origin.x = (MAC_TRAFFIC_LIGHT_X * scale) + (index as f64 * space_between);
            rect.origin.y = button_y;
            button.setFrameOrigin(rect.origin);
        }
    }

    Ok(())
}
