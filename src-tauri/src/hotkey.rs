//! Global keyboard shortcut registration.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

static CURRENT: Mutex<Option<Shortcut>> = Mutex::new(None);

pub fn parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    hotkey
        .parse::<Shortcut>()
        .map_err(|e| format!("invalid hotkey '{hotkey}': {e}"))
}

/// Registers the new shortcut first and only then drops the previous one,
/// so an invalid or already-taken combination never leaves the user
/// without a working hotkey.
pub fn register(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let new = parse_hotkey(hotkey)?;
    let mgr = app.global_shortcut();
    let mut current = CURRENT.lock().map_err(|_| "hotkey state poisoned".to_string())?;
    if *current == Some(new) && mgr.is_registered(new) {
        return Ok(());
    }

    let app_for_handler = app.clone();
    mgr.on_shortcut(new, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            eprintln!("[snap2link] hotkey pressed");
            let _ = app_for_handler.emit("trigger-screenshot", ());
        }
    })
    .map_err(|e| format!("on_shortcut('{hotkey}'): {e}"))?;

    if let Some(old) = current.replace(new) {
        if old != new {
            let _ = mgr.unregister(old);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn update_hotkey(app_handle: AppHandle, hotkey: String) -> Result<(), String> {
    register(&app_handle, &hotkey)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_and_rejects_garbage() {
        assert!(parse_hotkey(crate::commands::config::DEFAULT_HOTKEY).is_ok());
        assert!(parse_hotkey("Ctrl+Alt+P").is_ok());
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey("Ctrl+NotAKey").is_err());
    }
}
