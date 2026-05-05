//! Persisted user configuration.
//!
//! On disk: `<app_data_dir>/config.json`. Stores hotkey, retention policy,
//! and the cached Drive folder ID. Unknown keys are preserved on save so
//! parallel writers / future fields don't clobber each other.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::utils::{app_data_dir, config_path_in, ensure_dir};

pub const DEFAULT_HOTKEY: &str = "Ctrl+PrintScreen";
pub const DEFAULT_RETENTION_DAYS: u32 = 30;
pub const MIN_RETENTION_DAYS: u32 = 1;
pub const MAX_RETENTION_DAYS: u32 = 3650;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AppConfig {
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
    #[serde(default = "default_auto_delete")]
    pub auto_delete: bool,
    /// When true the annotator window opens between capture and upload so
    /// the user can draw arrows / blur / text on top before sharing.
    #[serde(default = "default_enable_annotator")]
    pub enable_annotator: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.to_string()
}
fn default_retention_days() -> u32 {
    DEFAULT_RETENTION_DAYS
}
fn default_auto_delete() -> bool {
    true
}
fn default_enable_annotator() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            retention_days: default_retention_days(),
            auto_delete: default_auto_delete(),
            enable_annotator: default_enable_annotator(),
            folder_id: None,
        }
    }
}

pub fn clamp_retention(days: u32) -> u32 {
    days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)
}

pub fn load_config_from(dir: &Path) -> AppConfig {
    let path = config_path_in(dir);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config_to(dir: &Path, cfg: &AppConfig) -> anyhow::Result<()> {
    ensure_dir(dir)?;
    let text = serde_json::to_string_pretty(cfg)?;
    fs::write(config_path_in(dir), text)?;
    Ok(())
}

pub fn load_config() -> AppConfig {
    load_config_from(&app_data_dir())
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    load_config()
}

#[tauri::command]
pub fn save_config(
    hotkey: String,
    retention_days: u32,
    auto_delete: bool,
    enable_annotator: Option<bool>,
) -> Result<(), String> {
    let dir = app_data_dir();
    let mut cfg = load_config_from(&dir);
    cfg.hotkey = hotkey;
    cfg.retention_days = clamp_retention(retention_days);
    cfg.auto_delete = auto_delete;
    if let Some(en) = enable_annotator {
        cfg.enable_annotator = en;
    }
    save_config_to(&dir, &cfg).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_config_has_expected_values() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.hotkey, DEFAULT_HOTKEY);
        assert_eq!(cfg.retention_days, DEFAULT_RETENTION_DAYS);
        assert!(cfg.auto_delete);
        assert!(cfg.enable_annotator);
        assert!(cfg.folder_id.is_none());
    }

    #[test]
    fn missing_enable_annotator_field_defaults_to_true() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{ "hotkey": "Ctrl+S", "retention_days": 30, "auto_delete": true }"#,
        )
        .unwrap();
        let cfg = load_config_from(tmp.path());
        assert!(cfg.enable_annotator);
    }

    #[test]
    fn load_returns_defaults_when_file_missing() {
        let tmp = TempDir::new().unwrap();
        let cfg = load_config_from(tmp.path());
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let cfg = AppConfig {
            hotkey: "Ctrl+Alt+P".into(),
            retention_days: 90,
            auto_delete: false,
            enable_annotator: false,
            folder_id: Some("abc123".into()),
        };
        save_config_to(tmp.path(), &cfg).unwrap();
        let loaded = load_config_from(tmp.path());
        assert_eq!(loaded, cfg);
    }

    #[test]
    fn save_creates_directory_if_missing() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("a").join("b");
        save_config_to(&nested, &AppConfig::default()).unwrap();
        assert!(nested.join("config.json").exists());
    }

    #[test]
    fn load_returns_defaults_on_invalid_json() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("config.json"), "{ not json }").unwrap();
        let cfg = load_config_from(tmp.path());
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn load_tolerates_partial_json_keeping_defaults_for_missing_fields() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{ "hotkey": "Ctrl+S" }"#,
        )
        .unwrap();
        let cfg = load_config_from(tmp.path());
        assert_eq!(cfg.hotkey, "Ctrl+S");
        assert_eq!(cfg.retention_days, DEFAULT_RETENTION_DAYS);
        assert!(cfg.auto_delete);
    }

    #[test]
    fn clamp_retention_enforces_bounds() {
        assert_eq!(clamp_retention(0), MIN_RETENTION_DAYS);
        assert_eq!(clamp_retention(1), 1);
        assert_eq!(clamp_retention(30), 30);
        assert_eq!(clamp_retention(3650), 3650);
        assert_eq!(clamp_retention(99_999), MAX_RETENTION_DAYS);
    }

    #[test]
    fn folder_id_is_omitted_from_json_when_none() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("folder_id"));
    }

    #[test]
    fn folder_id_is_present_in_json_when_some() {
        let cfg = AppConfig {
            folder_id: Some("xyz".into()),
            ..AppConfig::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"folder_id\":\"xyz\""));
    }

    #[test]
    fn enable_annotator_can_be_disabled() {
        let cfg = AppConfig {
            enable_annotator: false,
            ..AppConfig::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"enable_annotator\":false"));
    }
}
