mod commands;
mod editors;
mod quit_flow;
mod sidecar;
mod state;
mod telemetry;

use commands::{config, keychain, runtime, shell};
use quit_flow::QuitFlowState;
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, EventTarget, Runtime,
};
#[cfg(any(target_os = "linux", windows))]
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "macos")]
const CLOSE_ACTIVE_TAB_MENU_ID: &str = "workspace.close-active-tab";
#[cfg(target_os = "macos")]
const APP_QUIT_MENU_ID: &str = "app.quit";
#[cfg(target_os = "macos")]
const OPEN_SETTINGS_MENU_ID: &str = "app.open-settings";
#[cfg(target_os = "macos")]
const SHORTCUT_TRIGGERED_EVENT: &str = "shortcut://triggered";
#[cfg(target_os = "macos")]
const KNOWN_SHORTCUT_IDS: &[&str] = &[CLOSE_ACTIVE_TAB_MENU_ID, OPEN_SETTINGS_MENU_ID];

#[cfg(target_os = "macos")]
fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let close_tab_item = MenuItemBuilder::with_id(CLOSE_ACTIVE_TAB_MENU_ID, "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let open_settings_item = MenuItemBuilder::with_id(OPEN_SETTINGS_MENU_ID, "Settings...")
        .accelerator("CmdOrCtrl+Comma")
        .build(app)?;

    // Custom Quit item (not PredefinedMenuItem::quit()) so the accelerator
    // routes through on_menu_event into our confirmation dialog instead of
    // calling [NSApp terminate:] directly, which bypasses the Rust event loop.
    let quit_item = MenuItemBuilder::with_id(APP_QUIT_MENU_ID, "Quit Proliferate")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, app.package_info().name.clone())
        .about(None)
        .separator()
        .item(&open_settings_item)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit_item)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&close_tab_item)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

pub fn run() {
    let _telemetry = telemetry::init();
    let sc = sidecar::create_sidecar_with_auto_port();

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_single_instance::Builder::new()
                .callback(|app, _args, _cwd| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sc.clone())
        .manage(QuitFlowState::default())
        .invoke_handler(tauri::generate_handler![
            config::get_app_config,
            runtime::get_runtime_info,
            runtime::restart_runtime,
            quit_flow::set_running_agent_count,
            shell::pick_folder,
            shell::list_available_editors,
            shell::open_in_editor,
            shell::reveal_in_finder,
            shell::open_in_terminal,
            shell::open_external,
            keychain::list_configured_env_var_names,
            keychain::list_syncable_cloud_credentials,
            keychain::export_syncable_cloud_credential,
            keychain::set_env_var_secret,
            keychain::delete_env_var_secret,
            keychain::get_auth_session,
            keychain::set_auth_session,
            keychain::clear_auth_session,
            keychain::get_pending_auth,
            keychain::set_pending_auth,
            keychain::clear_pending_auth,
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_macos_menu).on_menu_event(|app, event| {
        let event_id = event.id().as_ref();
        if KNOWN_SHORTCUT_IDS.contains(&event_id) {
            let _ = app.emit_to(
                EventTarget::webview_window("main"),
                SHORTCUT_TRIGGERED_EVENT,
                event_id.to_string(),
            );
        } else if event_id == APP_QUIT_MENU_ID {
            quit_flow::prompt_quit_confirmation(app);
        }
    });

    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(quit_flow::handle_window_event);

    builder
        .setup(move |app| {
            #[cfg(any(target_os = "linux", windows))]
            {
                let _ = app.deep_link().register_all();
            }

            // Apply macOS vibrancy to the main window for translucent sidebar
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None);
                }
            }

            #[cfg(not(target_os = "macos"))]
            let _ = app;

            let sc = sc.clone();
            tauri::async_runtime::spawn(async move {
                {
                    let mut guard = sc.lock().await;
                    guard.launch_env = keychain::load_all_secrets_for_sidecar();
                }
                sidecar::boot(&sc).await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            quit_flow::handle_run_event(_app_handle, _event);
        });
}
