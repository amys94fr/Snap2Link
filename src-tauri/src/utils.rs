//! Filesystem paths used across the app.
//!
//! All on-disk state lives in `~/AppData/Roaming/Snap2Link/` (Windows) or
//! `~/Library/Application Support/Snap2Link/` (macOS).

use std::path::{Path, PathBuf};

pub const APP_DIR_NAME: &str = "Snap2Link";

pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DIR_NAME)
}

pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

pub fn token_path_in(dir: &Path) -> PathBuf {
    dir.join("token.json")
}

pub fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

/// Pipe a frontend log line into the dev terminal — useful for windows that
/// disappear before you can open their DevTools (e.g. the overlay).
#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[frontend] {message}");
}
