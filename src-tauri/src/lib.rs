//! Snap2Link — Tauri backend.
//!
//! Module layout (TDD-driven, each unit testable in isolation):
//!   - utils:     paths, app data dir
//!   - config:    persisted user config (shortcuts, retention, language)
//!   - auth:      Google OAuth token storage + refresh
//!   - drive:     Google Drive API (folder + upload + cleanup)
//!   - screenshot: region capture
//!   - hotkey:    global shortcut registration
//!   - i18n:      language resolution and strings used on the Rust side
//!   - toast:     small "link copied" window
//!   - tray:      system tray icon + menu

pub mod commands;
pub mod hotkey;
pub mod i18n;
pub mod toast;
pub mod tray;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::save_config,
            commands::config::save_profiles,
            commands::config::save_last_choice,
            commands::config::reset_last_choice,
            commands::config::save_notify_link,
            commands::config::get_language,
            commands::config::set_language,
            commands::config::is_first_run,
            commands::config::set_hosting,
            commands::auth::is_authenticated,
            commands::auth::authenticate,
            commands::auth::get_account_email,
            commands::auth::disconnect,
            commands::upload::upload_screenshot,
            commands::upload::delete_last_upload,
            commands::screenshot::capture_region,
            commands::screenshot::capture_full_screen,
            commands::screenshot::capture_at_cursor,
            commands::screenshot::capture_active_window,
            commands::screenshot::list_windows,
            commands::screenshot::capture_window,
            commands::screenshot::write_annotated_image,
            commands::updater::check_for_update,
            commands::updater::install_update,
            toast::show_toast,
            toast::hide_toast,
            utils::debug_log,
        ])
        // The window's close button must not destroy these windows: they are
        // created once at startup and reopened from the tray or a capture.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if matches!(window.label(), "main" | "annotator") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if let Ok(dir) = utils::captures_dir(app.handle()) {
                utils::purge_captures_in(&dir);
            }

            // Tray
            if let Err(e) = tray::setup(app.handle()) {
                eprintln!("[snap2link] tray setup failed: {e}");
                return Err(Box::new(e));
            }
            eprintln!("[snap2link] tray ready");

            // Global shortcuts. One taken combination must not cost the others.
            let cfg = commands::config::load_config();
            if let Err(e) = hotkey::sync(app.handle(), &cfg.profiles, |_| true) {
                eprintln!("[snap2link] global shortcuts failed: {e}");
            }

            let on_drive = cfg.hosting() == commands::config::Hosting::Drive;
            let connected = commands::auth::is_authenticated_inner();
            if commands::config::is_first_run() || (on_drive && !connected) {
                if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                    window.show().ok();
                }
            } else if on_drive {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::drive::cleanup_old_screenshots_inner(&handle).await;
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
