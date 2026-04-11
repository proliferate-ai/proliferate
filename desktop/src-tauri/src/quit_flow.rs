use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager, RunEvent, Runtime, Window, WindowEvent, RESTART_EXIT_CODE};
#[cfg(target_os = "macos")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub struct QuitFlowState {
    running_agents: Mutex<u32>,
    quit_confirmed: AtomicBool,
    dialog_open: AtomicBool,
}

impl Default for QuitFlowState {
    fn default() -> Self {
        Self {
            running_agents: Mutex::new(0),
            quit_confirmed: AtomicBool::new(false),
            dialog_open: AtomicBool::new(false),
        }
    }
}

#[tauri::command]
pub fn set_running_agent_count(state: tauri::State<'_, QuitFlowState>, count: u32) {
    if let Ok(mut guard) = state.running_agents.lock() {
        *guard = count;
    }
}

#[cfg(target_os = "macos")]
pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// Entry point for user-initiated quit from a menu item.
///
/// Unlike `handle_run_event`, there is no `ExitRequestApi` to call
/// `prevent_exit` on here: a menu click doesn't itself start an exit, it just
/// invokes this callback. We show the dialog, and if the user confirms, the
/// dialog callback calls `app_handle.exit(0)` which actually terminates.
#[cfg(target_os = "macos")]
pub fn prompt_quit_confirmation<R: Runtime>(app_handle: &AppHandle<R>) {
    let state = app_handle.state::<QuitFlowState>();
    if state.quit_confirmed.load(Ordering::Acquire) {
        app_handle.exit(0);
        return;
    }
    if state.dialog_open.swap(true, Ordering::AcqRel) {
        return;
    }
    show_quit_dialog(app_handle);
}

#[cfg(target_os = "macos")]
fn show_quit_dialog<R: Runtime>(app_handle: &AppHandle<R>) {
    let state = app_handle.state::<QuitFlowState>();
    let count = state.running_agents.lock().map(|g| *g).unwrap_or(0);
    let body = match count {
        0 => "Proliferate will close.".to_string(),
        1 => "1 running agent will be paused until you reopen Proliferate.".to_string(),
        n => format!("{n} running agents will be paused until you reopen Proliferate."),
    };

    let app_handle_for_callback = app_handle.clone();
    app_handle
        .dialog()
        .message(body)
        .title("Quit Proliferate?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            let state = app_handle_for_callback.state::<QuitFlowState>();
            state.dialog_open.store(false, Ordering::Release);
            if confirmed {
                state.quit_confirmed.store(true, Ordering::Release);
                app_handle_for_callback.exit(0);
            }
        });
}

#[cfg(target_os = "macos")]
pub fn handle_run_event<R: Runtime>(app_handle: &AppHandle<R>, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { code, api, .. } => {
            if code == Some(RESTART_EXIT_CODE) {
                return;
            }
            let state = app_handle.state::<QuitFlowState>();
            if state.quit_confirmed.load(Ordering::Acquire) {
                return;
            }
            api.prevent_exit();
            if state.dialog_open.swap(true, Ordering::AcqRel) {
                return;
            }
            show_quit_dialog(app_handle);
        }
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        _ => {}
    }
}
