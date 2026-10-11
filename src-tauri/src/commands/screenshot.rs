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
//! All three save the PNG as a fresh `cap-<n>.png` in the private captures
//! folder (see `utils::captures_dir`) and return its path.
//!
//! Plus a small helper command, `write_annotated_image`, that the
//! annotator window calls when the user hits "Done": it takes the PNG
//! bytes the Konva stage exported and stores them as `annotated-<n>.png`
//! in the same folder so the upload pipeline (which expects a path) stays
//! unchanged.

use image::{ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use tauri::AppHandle;
use xcap::{Monitor, Window};

use crate::utils::{
    captures_dir, is_png, new_capture_path, write_capture_file, MAX_CAPTURE_BYTES,
};

fn save_capture(dir: &Path, image: &RgbaImage) -> anyhow::Result<String> {
    let mut png = Vec::new();
    image.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)?;
    let path = new_capture_path(dir, "cap-");
    write_capture_file(&path, &png)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn capture_region(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    capture_region_inner(&dir, x, y, width, height).map_err(|e| e.to_string())
}

pub fn capture_region_inner(
    dir: &Path,
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
            let mw = m.width().unwrap_or(0) as i64;
            let mh = m.height().unwrap_or(0) as i64;
            contains(mx as i64, my as i64, mw, mh, x as i64, y as i64)
        })
        .or_else(|| monitors.first())
        .unwrap();

    // Translate global coords to monitor-local coords.
    let monitor_x = monitor.x().unwrap_or(0) as i64;
    let monitor_y = monitor.y().unwrap_or(0) as i64;
    let local_x = (x as i64 - monitor_x).clamp(0, u32::MAX as i64) as u32;
    let local_y = (y as i64 - monitor_y).clamp(0, u32::MAX as i64) as u32;

    let image = monitor.capture_image()?;
    let cropped = image::imageops::crop_imm(&image, local_x, local_y, width, height).to_image();
    save_capture(dir, &cropped)
}

fn contains(mx: i64, my: i64, mw: i64, mh: i64, x: i64, y: i64) -> bool {
    x >= mx && y >= my && x < mx + mw && y < my + mh
}

/// Capture the entire monitor whose top-left corner the caller passes
/// in (typically the screen the overlay was sitting on, so the user
/// gets "their" screen captured rather than an arbitrary primary one).
/// Pass `x = 0, y = 0` to fall back to the primary monitor.
#[tauri::command]
pub fn capture_full_screen(app: AppHandle, x: i32, y: i32) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    capture_full_screen_inner(&dir, x, y).map_err(|e| e.to_string())
}

pub fn capture_full_screen_inner(dir: &Path, x: i32, y: i32) -> anyhow::Result<String> {
    let monitors = Monitor::all()?;
    if monitors.is_empty() {
        anyhow::bail!("No monitor available");
    }
    let monitor = monitors
        .iter()
        .find(|m| {
            let mx = m.x().unwrap_or(0) as i64;
            let my = m.y().unwrap_or(0) as i64;
            let mw = m.width().unwrap_or(0) as i64;
            let mh = m.height().unwrap_or(0) as i64;
            contains(mx, my, mw, mh, x as i64, y as i64)
        })
        .or_else(|| monitors.first())
        .unwrap();

    let image = monitor.capture_image()?;
    save_capture(dir, &image)
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
pub fn capture_window(app: AppHandle, id: u32) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    capture_window_inner(&dir, id).map_err(|e| e.to_string())
}

pub fn capture_window_inner(dir: &Path, id: u32) -> anyhow::Result<String> {
    let windows = Window::all()?;
    let target = windows
        .into_iter()
        .find(|w| w.id().map(|v| v == id).unwrap_or(false))
        .ok_or_else(|| anyhow::anyhow!("window {id} not found"))?;

    let image = target.capture_image()?;
    save_capture(dir, &image)
}

/// Stores the PNG bytes the annotator's Konva stage exported and returns
/// the path, which the annotator then hands to `upload_screenshot`.
#[tauri::command]
pub fn write_annotated_image(app: AppHandle, bytes: Vec<u8>) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    write_annotated_image_inner(&dir, &bytes).map_err(|e| e.to_string())
}

pub fn write_annotated_image_inner(dir: &Path, bytes: &[u8]) -> anyhow::Result<String> {
    if bytes.is_empty() {
        anyhow::bail!("empty image payload");
    }
    if bytes.len() > MAX_CAPTURE_BYTES {
        anyhow::bail!("image payload too large");
    }
    if !is_png(bytes) {
        anyhow::bail!("image payload is not a PNG");
    }
    let path = new_capture_path(dir, "annotated-");
    write_capture_file(&path, bytes)?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn write_annotated_image_writes_bytes_and_returns_path() {
        let tmp = TempDir::new().unwrap();
        let path = write_annotated_image_inner(tmp.path(), &PNG_MAGIC).unwrap();
        assert!(path.contains("annotated-"));
        assert_eq!(std::fs::read(&path).unwrap(), PNG_MAGIC);
    }

    #[test]
    fn write_annotated_image_rejects_empty_payload() {
        let tmp = TempDir::new().unwrap();
        assert!(write_annotated_image_inner(tmp.path(), &[]).is_err());
    }

    #[test]
    fn write_annotated_image_rejects_non_png() {
        let tmp = TempDir::new().unwrap();
        assert!(write_annotated_image_inner(tmp.path(), b"#!/bin/sh\nrm -rf ~").is_err());
    }

    #[test]
    fn write_annotated_image_rejects_oversized_payload() {
        let tmp = TempDir::new().unwrap();
        let mut big = PNG_MAGIC.to_vec();
        big.resize(MAX_CAPTURE_BYTES + 1, 0);
        assert!(write_annotated_image_inner(tmp.path(), &big).is_err());
    }

    #[test]
    fn monitor_contains_does_not_overflow_at_extremes() {
        assert!(!contains(i32::MAX as i64, 0, 10, 10, i32::MIN as i64, 0));
        assert!(contains(0, 0, 10, 10, 5, 5));
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
        let tmp = TempDir::new().unwrap();
        let r = capture_window_inner(tmp.path(), u32::MAX - 1);
        // On a headless host this errors with "no display" before even
        // searching; either way we should get an Err, not a panic.
        assert!(r.is_err());
    }
}
