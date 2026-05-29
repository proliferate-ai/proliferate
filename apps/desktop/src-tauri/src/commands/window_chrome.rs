const MAC_TRAFFIC_LIGHT_X: f64 = 13.0;
const MAC_HEADER_HEIGHT: f64 = 40.0;

#[tauri::command]
pub fn apply_macos_window_chrome(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        apply_traffic_light_position(&window, MAC_TRAFFIC_LIGHT_X, MAC_HEADER_HEIGHT)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn apply_traffic_light_position(
    window: &tauri::Window,
    x: f64,
    header_height: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

    let ns_window = window.ns_window().map_err(|error| error.to_string())?;

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
        let title_bar_frame_height = header_height.max(close_rect.size.height);
        let mut title_bar_rect = NSView::frame(&title_bar_container_view);
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = ns_window.frame().size.height - title_bar_frame_height;
        title_bar_container_view.setFrame(title_bar_rect);

        let space_between = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
        let button_y = (title_bar_frame_height - close_rect.size.height) / 2.0;
        let mut buttons = vec![close, miniaturize];
        if let Some(zoom) = zoom {
            buttons.push(zoom);
        }

        for (index, button) in buttons.into_iter().enumerate() {
            let mut rect = NSView::frame(&button);
            rect.origin.x = x + (index as f64 * space_between);
            rect.origin.y = button_y;
            button.setFrameOrigin(rect.origin);
        }
    }

    Ok(())
}
