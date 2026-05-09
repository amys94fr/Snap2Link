//! Screenshot capture using the `xcap` crate. Three modes are exposed
//! to the frontend:
//!
//! 1. `capture_region`       : drag-selected rectangle (legacy)
//! 2. `capture_full_screen`  : the monitor whose top-left corner the
//!                              caller passes in (lets the frontend pick
//!                              "the screen the overlay was on")
//! 3. `capture_window` + `list_windows`: pick a specific application
//!                              window from a list and capture it
//!
//! All three save the PNG to the same temp path used by the upload
//! pipeline (`snap2link_cap.png`) so downstream code is unchanged.
//!
//! Plus a small helper command, `write_annotated_image`, that the
//! annotator window calls when the user hits "Done": it takes the PNG
//! bytes the Konva stage exported and stashes them in a temp file so
//! the existing upload pipeline (which expects a path) stays unchanged.

use serde::{Deserialize, Serialize};
use std::fs;
use xcap::{Monitor, Window};

#[tauri::command]
pub fn capture_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    capture_region_inner(x, y, width, height).map_err(|e| e.to_string())
}

pub fn capture_region_inner(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> anyhow::Result<String> {
    let monitors = Monitor::all()?;
    if monitors.is_empty() {
        anyhow::bail!("No monitor available");
    }

    // Pick the monitor that contains the top-left corner of the requested
    // region; otherwise, the primary one.
    //
    // xcap >= 0.9 made every Monitor accessor fallible (e.g. on Wayland the
    // OS may refuse to give a position). When that happens we silently fall
    // back to the primary monitor rather than erroring the whole capture.
    let monitor = monitors
        .iter()
        .find(|m| {
            let mx = m.x().unwrap_or(0);
            let my = m.y().unwrap_or(0);
            let mw = m.width().unwrap_or(0) as i32;
            let mh = m.height().unwrap_or(0) as i32;
            x >= mx && y >= my && x < mx + mw && y < my + mh
        })
        .or_else(|| monitors.first())
        .unwrap();

    // Translate global coords to monitor-local coords.
    let monitor_x = monitor.x().unwrap_or(0);
    let monitor_y = monitor.y().unwrap_or(0);
    let local_x = (x - monitor_x).max(0) as u32;
    let local_y = (y - monitor_y).max(0) as u32;

    let image = monitor.capture_image()?;
    let cropped = image::imageops::crop_imm(&image, local_x, local_y, width, height).to_image();

    let tmp = std::env::temp_dir().join("snap2link_cap.png");
    cropped.save(&tmp)?;
    Ok(tmp.to_string_lossy().to_string())
}

/// Capture the entire monitor whose top-left corner the caller passes
/// in (typically the screen the overlay was sitting on, so the user
/// gets "their" screen captured rather than an arbitrary primary one).
/// Pass `x = 0, y = 0` to fall back to the primary monitor.
#[tauri::command]
pub fn capture_full_screen(x: i32, y: i32) -> Result<String, String> {
    capture_full_screen_inner(x, y).map_err(|e| e.to_string())
}

pub fn capture_full_screen_inner(x: i32, y: i32) -> anyhow::Result<String> {
    let monitors = Monitor::all()?;
    if monitors.is_empty() {
        anyhow::bail!("No monitor available");
    }
    let monitor = monitors
        .iter()
        .find(|m| {
            let mx = m.x().unwrap_or(0);
            let my = m.y().unwrap_or(0);
            let mw = m.width().unwrap_or(0) as i32;
            let mh = m.height().unwrap_or(0) as i32;
            x >= mx && y >= my && x < mx + mw && y < my + mh
        })
        .or_else(|| monitors.first())
        .unwrap();

    let image = monitor.capture_image()?;
    let tmp = std::env::temp_dir().join("snap2link_cap.png");
    image.save(&tmp)?;
    Ok(tmp.to_string_lossy().to_string())
}

/// Lightweight info about an open window. Returned by `list_windows` so
/// the picker UI can render a clickable list. The `id` is what the
/// frontend passes back to `capture_window`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub width: u32,
    pub height: u32,
}

/// List visible non-minimised application windows in z-order. Skips
/// windows xcap can't introspect (some system-level windows on
/// Linux/Wayland error on every accessor).
#[tauri::command]
pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    list_windows_inner().map_err(|e| e.to_string())
}

pub fn list_windows_inner() -> anyhow::Result<Vec<WindowInfo>> {
    let windows = Window::all()?;
    let mut out: Vec<WindowInfo> = Vec::with_capacity(windows.len());
    for w in windows {
        // Skip windows we can't even get an id for. On Wayland a
        // handful of compositor surfaces fall in this bucket.
        let id = match w.id() {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Hide minimised windows (xcap can technically capture them, but
        // the result is usually a stale frame and the user wouldn't
        // expect to see them in the picker).
        if w.is_minimized().unwrap_or(false) {
            continue;
        }
        let title = w.title().unwrap_or_default();
        let app_name = w.app_name().unwrap_or_default();
        // Drop empty-titled, empty-app entries (typically system surfaces).
        if title.trim().is_empty() && app_name.trim().is_empty() {
            continue;
        }
        let width = w.width().unwrap_or(0);
        let height = w.height().unwrap_or(0);
        // Filter zero-sized windows (off-screen or hidden by the OS).
        if width == 0 || height == 0 {
            continue;
        }
        out.push(WindowInfo {
            id,
            title,
            app_name,
            width,
            height,
        });
    }
    Ok(out)
}

/// Capture a specific window by the id returned from `list_windows`.
#[tauri::command]
pub fn capture_window(id: u32) -> Result<String, String> {
    capture_window_inner(id).map_err(|e| e.to_string())
}

pub fn capture_window_inner(id: u32) -> anyhow::Result<String> {
    let windows = Window::all()?;
    let target = windows
        .into_iter()
        .find(|w| w.id().map(|v| v == id).unwrap_or(false))
        .ok_or_else(|| anyhow::anyhow!("window {id} not found"))?;

    let image = target.capture_image()?;
    let tmp = std::env::temp_dir().join("snap2link_cap.png");
    image.save(&tmp)?;
    Ok(tmp.to_string_lossy().to_string())
}

/// Saves a base64-decoded PNG to a temp file and returns its path. The
/// annotator window invokes this with the PNG bytes the Konva stage
/// exported, then chains into `upload_screenshot` with the returned path.
#[tauri::command]
pub fn write_annotated_image(bytes: Vec<u8>) -> Result<String, String> {
    write_annotated_image_inner(&bytes).map_err(|e| e.to_string())
}

pub fn write_annotated_image_inner(bytes: &[u8]) -> anyhow::Result<String> {
    if bytes.is_empty() {
        anyhow::bail!("empty image payload");
    }
    let tmp = std::env::temp_dir().join("snap2link_annotated.png");
    fs::write(&tmp, bytes)?;
    Ok(tmp.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_annotated_image_writes_bytes_and_returns_path() {
        let bytes: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // PNG magic
        let path = write_annotated_image_inner(&bytes).unwrap();
        let read_back = std::fs::read(&path).unwrap();
        assert_eq!(read_back, bytes);
    }

    #[test]
    fn write_annotated_image_rejects_empty_payload() {
        assert!(write_annotated_image_inner(&[]).is_err());
    }

    /// Smoke test, only runs if a real display is attached. Headless CI
    /// shells (Linux without DISPLAY, GitHub Actions runners without
    /// xvfb) bail out of `Monitor::all()` so we'd otherwise fail there.
    #[test]
    fn list_windows_returns_some_or_empty_but_never_panics() {
        // It's enough that the call doesn't panic. On CI it might error
        // ("No display") which we tolerate; on a real machine we expect
        // at least zero entries.
        match list_windows_inner() {
            Ok(list) => {
                for w in &list {
                    // Sanity: each entry should have at least *something*
                    // identifying it (title or app name).
                    assert!(
                        !w.title.trim().is_empty() || !w.app_name.trim().is_empty(),
                        "every listed window must have a title or app_name"
                    );
                    assert!(w.width > 0 && w.height > 0);
                }
            }
            Err(_) => { /* headless / no display, accepted */ }
        }
    }

    #[test]
    fn capture_window_unknown_id_errors_cleanly() {
        // 0xFFFF_FFFE is unlikely to ever be a real window id; should
        // surface a "not found" error rather than panic.
        let r = capture_window_inner(u32::MAX - 1);
        // On a headless host this errors with "no display" before even
        // searching; either way we should get an Err, not a panic.
        assert!(r.is_err());
    }
}
