//! Snap2Link — Tauri backend.
//!
//! Module layout (TDD-driven, each unit testable in isolation):
//!   - utils:     paths, app data dir
//!   - config:    persisted user config (hotkey, retention, folder_id)
//!   - auth:      Google OAuth token storage + refresh
//!   - drive:     Google Drive API (folder + upload + cleanup)
//!   - screenshot: region capture
//!   - hotkey:    global shortcut registration
//!   - tray:      system tray icon + menu

pub mod commands;
pub mod hotkey;
pub mod tray;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
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
            commands::auth::is_authenticated,
            commands::auth::authenticate,
            commands::auth::get_account_email,
            commands::auth::disconnect,
            commands::drive::upload_screenshot,
            commands::drive::cleanup_old_screenshots,
            commands::screenshot::capture_region,
            commands::updater::check_for_update,
            commands::updater::install_update,
            hotkey::update_hotkey,
            utils::debug_log,
        ])
        .setup(|app| {
            // Tray
            if let Err(e) = tray::setup(app.handle()) {
                eprintln!("[snap2link] tray setup failed: {e}");
                return Err(Box::new(e));
            }
            eprintln!("[snap2link] tray ready");

            // Global shortcut
            let cfg = commands::config::load_config();
            match hotkey::register(app.handle(), &cfg.hotkey) {
                Ok(_) => eprintln!("[snap2link] global shortcut registered: {}", cfg.hotkey),
                Err(e) => eprintln!(
                    "[snap2link] global shortcut '{}' failed: {e}",
                    cfg.hotkey
                ),
            }

            if !commands::auth::is_authenticated_inner() {
                if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                    window.show().ok();
                }
            } else {
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
