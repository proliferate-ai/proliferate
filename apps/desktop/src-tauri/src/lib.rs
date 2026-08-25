mod agent_seed_env;
mod app_config;
mod commands;
mod desktop_telemetry_mode;
pub mod diagnostics;
pub mod diagnostics_collector;
mod editors;
mod quit_flow;
mod runtime_version_assert;
mod sidecar;
mod state;
mod telemetry;
mod updater_owned;
mod workspace_activity_indicator;

use commands::{
    anonymous_telemetry, cloud_worker, config, desktop_identity,
    diagnostics as diagnostics_commands, drag_drop, google_workspace_mcp, keychain, process,
    runtime, shell, support, support_snapshot, window_chrome, workspace_scratch,
};
use quit_flow::QuitFlowState;
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, RunEvent, Runtime,
};
#[cfg(any(target_os = "linux", windows))]
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "macos")]
const CLOSE_ACTIVE_TAB_MENU_ID: &str = "workspace.close-active-tab";
#[cfg(target_os = "macos")]
const PREVIOUS_TAB_MENU_ID: &str = "workspace.previous-tab";
#[cfg(target_os = "macos")]
const NEXT_TAB_MENU_ID: &str = "workspace.next-tab";
#[cfg(target_os = "macos")]
const NEW_SESSION_TAB_MENU_ID: &str = "workspace.new-session-tab";
#[cfg(target_os = "macos")]
const APP_QUIT_MENU_ID: &str = "app.quit";
#[cfg(target_os = "macos")]
const OPEN_SETTINGS_MENU_ID: &str = "app.open-settings";
#[cfg(target_os = "macos")]
const SELECT_ALL_MENU_ID: &str = "app.select-all";
#[cfg(target_os = "macos")]
const UNDO_MENU_ID: &str = "app.undo";
#[cfg(target_os = "macos")]
const REDO_MENU_ID: &str = "app.redo";
#[cfg(target_os = "macos")]
const SHORTCUT_TRIGGERED_EVENT: &str = "shortcut://triggered";
#[cfg(target_os = "macos")]
const KNOWN_SHORTCUT_IDS: &[&str] = &[
    CLOSE_ACTIVE_TAB_MENU_ID,
    PREVIOUS_TAB_MENU_ID,
    NEXT_TAB_MENU_ID,
    NEW_SESSION_TAB_MENU_ID,
    OPEN_SETTINGS_MENU_ID,
    SELECT_ALL_MENU_ID,
    UNDO_MENU_ID,
    REDO_MENU_ID,
];

#[cfg(target_os = "macos")]
fn dev_profile_display_name() -> Option<String> {
    if std::env::var_os("PROLIFERATE_DEV").is_none() {
        return None;
    }
    let profile = std::env::var("PROLIFERATE_DEV_PROFILE").ok()?;
    let profile = profile.trim();
    if profile.is_empty() {
        None
    } else {
        Some(format!("Proliferate ({profile})"))
    }
}

#[cfg(target_os = "macos")]
fn app_display_name<R: Runtime>(app: &AppHandle<R>) -> String {
    dev_profile_display_name().unwrap_or_else(|| app.package_info().name.clone())
}

#[cfg(target_os = "macos")]
fn apply_dev_app_display_name() {
    let Some(display_name) = dev_profile_display_name() else {
        return;
    };
    let ns_display_name = objc2_foundation::NSString::from_str(&display_name);
    objc2_foundation::NSProcessInfo::processInfo().setProcessName(&ns_display_name);

    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return;
    };
    let app = objc2_app_kit::NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };
    let Some(app_menu_item) = main_menu.itemAtIndex(0) else {
        return;
    };
    app_menu_item.setTitle(&ns_display_name);
    if let Some(app_menu) = app_menu_item.submenu() {
        app_menu.setTitle(&ns_display_name);
    }
}

#[cfg(target_os = "macos")]
fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let app_name = app_display_name(app);
    let close_tab_item = MenuItemBuilder::with_id(CLOSE_ACTIVE_TAB_MENU_ID, "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let previous_tab_item = MenuItemBuilder::with_id(PREVIOUS_TAB_MENU_ID, "Previous Tab")
        .accelerator("CmdOrCtrl+Shift+[")
        .build(app)?;
    let next_tab_item = MenuItemBuilder::with_id(NEXT_TAB_MENU_ID, "Next Tab")
        .accelerator("CmdOrCtrl+Shift+]")
        .build(app)?;
    let new_session_tab_item = MenuItemBuilder::with_id(NEW_SESSION_TAB_MENU_ID, "New Chat")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let open_settings_item = MenuItemBuilder::with_id(OPEN_SETTINGS_MENU_ID, "Settings...")
        .accelerator("CmdOrCtrl+Comma")
        .build(app)?;
    let select_all_item = MenuItemBuilder::with_id(SELECT_ALL_MENU_ID, "Select All")
        .accelerator("CmdOrCtrl+A")
        .build(app)?;
    let undo_item = MenuItemBuilder::with_id(UNDO_MENU_ID, "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo_item = MenuItemBuilder::with_id(REDO_MENU_ID, "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;

    // Custom Quit item (not PredefinedMenuItem::quit()) so the accelerator
    // routes through on_menu_event into our confirmation dialog instead of
    // calling [NSApp terminate:] directly, which bypasses the Rust event loop.
    let quit_item = MenuItemBuilder::with_id(APP_QUIT_MENU_ID, format!("Quit {app_name}"))
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, app_name)
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
        .item(&new_session_tab_item)
        .item(&close_tab_item)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo_item)
        .item(&redo_item)
        .separator()
        .cut()
        .copy()
        .paste()
        .item(&select_all_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&previous_tab_item)
        .item(&next_tab_item)
        .separator()
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
    let fallback_path = app_config::logs_dir_path().map(|path| path.join("desktop-native.log"));
    let fallback = fallback_path
        .and_then(diagnostics_collector::fallback::FallbackDiagnosticsWriter::open)
        .unwrap_or_default();
    let diagnostics_producer = diagnostics_collector::producer::TauriDiagnosticsProducer::new(
        fallback.clone(),
        format!("proliferate-desktop-native@{}", env!("CARGO_PKG_VERSION")),
        if app_config::native_dev_profile() {
            "development".to_string()
        } else {
            "production".to_string()
        },
    );
    let _telemetry = telemetry::init(&diagnostics_producer);
    let sc = sidecar::create_sidecar_with_auto_port();
    let cloud_worker_state = cloud_worker::create_cloud_worker_state();
    let owned_updater_state = updater_owned::create_owned_updater_state();
    let diagnostics_supervisor =
        diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor::new(
            diagnostics_producer.clone(),
            fallback.clone(),
            format!("proliferate-desktop-native@{}", env!("CARGO_PKG_VERSION")),
            if app_config::native_dev_profile() {
                "development".to_string()
            } else {
                "production".to_string()
            },
            // The same identity the renderer reads through
            // `get_desktop_install_id`, so an exported record and an app event
            // describe one install. A failure to read or create it degrades
            // the attribute, never the launch.
            desktop_identity::load_or_create_desktop_install_id().ok(),
        );
    let support_snapshot_coordinator =
        diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator::new(
            diagnostics_supervisor.clone(),
            diagnostics_producer.clone(),
            cloud_worker_state.clone(),
            sc.clone(),
        );
    let broker_state = diagnostics_collector::shutdown::create_broker_server_state();
    let shutdown_coordinator = diagnostics_collector::shutdown::DiagnosticsShutdownCoordinator::new(
        diagnostics_supervisor.clone(),
        diagnostics_producer.clone(),
        fallback,
        broker_state.clone(),
        cloud_worker_state.clone(),
        sc.clone(),
        support_snapshot_coordinator.clone(),
    );

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
        .manage(cloud_worker_state)
        .manage(owned_updater_state)
        .manage(diagnostics_supervisor.clone())
        .manage(diagnostics_producer.clone())
        .manage(support_snapshot_coordinator)
        .manage(shutdown_coordinator.clone())
        .manage(QuitFlowState::default())
        .manage(workspace_activity_indicator::WorkspaceActivityIndicatorStore::default())
        .manage(window_chrome::WindowChromeZoom::default())
        .invoke_handler(tauri::generate_handler![
            anonymous_telemetry::load_anonymous_telemetry_bootstrap,
            anonymous_telemetry::save_anonymous_telemetry_state,
            config::get_app_config,
            config::set_app_config,
            diagnostics_commands::export_debug_bundle,
            diagnostics_commands::ingest_renderer_diagnostics,
            diagnostics_commands::save_diagnostic_json,
            diagnostics_commands::save_diagnostic_json_to_absolute_path,
            support_snapshot::begin_support_snapshot_preparation,
            support_snapshot::finish_support_snapshot_preparation,
            support_snapshot::cancel_support_snapshot_preparation,
            support_snapshot::save_support_snapshot_archive,
            support_snapshot::read_staged_support_snapshot,
            support_snapshot::delete_staged_support_snapshot,
            support_snapshot::reconcile_staged_support_snapshots,
            support_snapshot::begin_support_snapshot_submission,
            support_snapshot::finish_support_snapshot_submission,
            runtime::get_runtime_info,
            runtime::restart_runtime,
            cloud_worker::ensure_desktop_dispatch_worker,
            cloud_worker::prepare_desktop_dispatch_worker_update,
            cloud_worker::stop_desktop_dispatch_worker,
            desktop_identity::get_desktop_install_id,
            workspace_scratch::read_workspace_scratch_pad,
            workspace_scratch::write_workspace_scratch_pad,
            quit_flow::set_running_agent_count,
            workspace_activity_indicator::set_workspace_activity_indicator,
            drag_drop::drag_pasteboard_change_count,
            drag_drop::read_drag_drop_paths,
            shell::pick_folder,
            shell::copy_text,
            shell::list_available_editors,
            shell::inspect_path,
            shell::open_in_editor,
            shell::reveal_in_finder,
            shell::open_in_terminal,
            shell::open_external,
            google_workspace_mcp::start_google_workspace_mcp_auth,
            google_workspace_mcp::cancel_google_workspace_mcp_auth,
            google_workspace_mcp::get_google_workspace_mcp_credential_status,
            google_workspace_mcp::delete_google_workspace_mcp_local_data,
            google_workspace_mcp::reconcile_google_workspace_mcp_pending_setups,
            google_workspace_mcp::resolve_google_workspace_mcp_runtime_env,
            google_workspace_mcp::release_google_workspace_mcp_runtime_env,
            support::delete_staged_support_report_attachment,
            support::read_staged_support_report_attachment,
            support::stage_support_report_attachment,
            window_chrome::apply_macos_window_chrome,
            window_chrome::set_webview_zoom,
            process::command_exists,
            keychain::get_auth_session,
            keychain::set_auth_session,
            keychain::clear_auth_session,
            keychain::get_pending_auth,
            keychain::set_pending_auth,
            keychain::clear_pending_auth,
            updater_owned::updater_owned_check,
            updater_owned::updater_owned_download,
            updater_owned::updater_owned_abort,
            updater_owned::updater_staged_status,
            updater_owned::updater_owned_install,
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_macos_menu).on_menu_event(|app, event| {
        let event_id = event.id().as_ref();
        if KNOWN_SHORTCUT_IDS.contains(&event_id) {
            let _ = app.emit(SHORTCUT_TRIGGERED_EVENT, event_id.to_string());
        } else if event_id == APP_QUIT_MENU_ID {
            quit_flow::prompt_quit_confirmation(app);
        }
    });

    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        quit_flow::handle_window_event(window, event);
        // AppKit re-lays the standard window buttons out to their defaults on
        // resize; keep them on the zoom-scaled chrome geometry.
        if window.label() == "main" && matches!(event, tauri::WindowEvent::Resized(_)) {
            window_chrome::reapply_window_chrome(window);
        }
    });

    builder
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            apply_dev_app_display_name();

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
                if let Some(window) = app.get_window("main") {
                    window_chrome::reapply_window_chrome(&window);
                }
            }

            #[cfg(not(target_os = "macos"))]
            let _ = app;

            let sc = sc.clone();
            let diagnostics_supervisor = diagnostics_supervisor.clone();
            let diagnostics_producer = diagnostics_producer.clone();
            let broker_state = broker_state.clone();
            let agent_seed_env = agent_seed_env::launch_env(app.handle());
            tauri::async_runtime::spawn(async move {
                diagnostics_producer.start_pump();
                match diagnostics_collector::broker::server::DiagnosticsBrokerServer::start(
                    diagnostics_supervisor.clone(),
                )
                .await
                {
                    Ok(server) => {
                        let mut broker = broker_state.lock().await;
                        if diagnostics_supervisor.shutdown_is_armed() {
                            drop(broker);
                            server.stop_accepting();
                            let _ = server.wait_stopped().await;
                            let _ = server.remove_locator_and_unlock();
                        } else {
                            *broker = Some(server);
                        }
                    }
                    Err(error) => {
                        tracing::warn!(?error, "failed to start diagnostics broker");
                    }
                }
                let _ = diagnostics_supervisor.start().await;
                {
                    let mut guard = sc.lock().await;
                    guard.launch_env = keychain::load_all_secrets_for_sidecar();
                    guard.launch_env.extend(agent_seed_env);
                }
                sidecar::boot(&sc, &diagnostics_producer, &diagnostics_supervisor).await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            if matches!(_event, tauri::RunEvent::Exit) {
                let shutdown =
                    _app_handle.state::<std::sync::Arc<
                        diagnostics_collector::shutdown::DiagnosticsShutdownCoordinator,
                    >>();
                let _ = tauri::async_runtime::block_on(shutdown.shutdown());
            }
            #[cfg(target_os = "macos")]
            {
                if matches!(_event, RunEvent::Ready) {
                    if let Err(error) = workspace_activity_indicator::setup(_app_handle) {
                        tracing::warn!(
                            %error,
                            "failed to initialize workspace activity indicator on app ready"
                        );
                    }
                }
                quit_flow::handle_run_event(_app_handle, _event);
            }
        });
}
