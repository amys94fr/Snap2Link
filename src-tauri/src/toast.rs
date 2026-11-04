//! The small "link copied" window.
//!
//! Desktop notifications can't carry a button through the notification
//! plugin, and the Delete button is the safety net of direct sharing. So this
//! is a real window, kept in a corner of the screen and never focused.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::commands::config::load_config;

const MARGIN: i32 = 16;

fn place_in_corner(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = monitor.work_area();
    let size = window.outer_size()?;
    window.set_position(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - size.width as i32 - MARGIN,
        area.position.y + area.size.height as i32 - size.height as i32 - MARGIN,
    ))
}

/// Shows the toast in `state` ("uploading" or "copied"), unless the user
/// turned it off in the settings.
#[tauri::command]
pub fn show_toast(app: AppHandle, state: String) -> Result<(), String> {
    if !load_config().notify_link {
        return Ok(());
    }
    let window = app
        .get_webview_window("toast")
        .ok_or_else(|| "toast window missing".to_string())?;
    place_in_corner(&app, &window).map_err(|e| e.to_string())?;
    window.emit("toast-state", state).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())
}

/// Returns whether the toast was on screen, so a capture can wait for it to
/// be gone instead of photographing it.
#[tauri::command]
pub fn hide_toast(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window("toast") else {
        return false;
    };
    let visible = window.is_visible().unwrap_or(false);
    if visible {
        let _ = window.hide();
    }
    visible
}
