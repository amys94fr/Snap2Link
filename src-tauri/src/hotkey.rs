//! Global keyboard shortcut registration.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut_mgr = app.global_shortcut();
    let _ = shortcut_mgr.unregister_all();

    let app_for_handler = app.clone();
    shortcut_mgr
        .on_shortcut(hotkey, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                eprintln!("[snap2link] hotkey pressed");
                let _ = app_for_handler.emit("trigger-screenshot", ());
            }
        })
        .map_err(|e| format!("on_shortcut('{hotkey}'): {e}"))
}

#[tauri::command]
pub fn update_hotkey(app_handle: AppHandle, hotkey: String) -> Result<(), String> {
    register(&app_handle, &hotkey)
}
