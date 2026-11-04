//! Persisted user configuration.
//!
//! On disk: `<app_data_dir>/config.json`. Stores the capture shortcuts,
//! retention policy, language, last capture choices and the cached Drive
//! folder ID.
//!
//! Configs written before 1.6 only have `hotkey`: `load_config_from` turns it
//! into the first capture profile. `hotkey` keeps mirroring that profile so a
//! downgrade still finds a working shortcut.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter};

use crate::utils::{app_data_dir, config_path_in, ensure_private_dir, write_private_file};

pub const DEFAULT_HOTKEY: &str = "Ctrl+PrintScreen";
pub const DEFAULT_RETENTION_DAYS: u32 = 30;
pub const MIN_RETENTION_DAYS: u32 = 1;
pub const MAX_RETENTION_DAYS: u32 = 3650;
pub const MAX_PROFILES: usize = 3;
pub const LANGUAGE_AUTO: &str = "auto";

/// What a shortcut captures. `Ask` opens the overlay on the last mode used.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureMode {
    #[default]
    Ask,
    Region,
    FullScreen,
    ActiveWindow,
}

/// What happens once the image exists.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AfterCapture {
    #[default]
    Ask,
    Share,
    Annotate,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CaptureProfile {
    pub hotkey: String,
    #[serde(default)]
    pub mode: CaptureMode,
    #[serde(default)]
    pub after: AfterCapture,
}

/// Overlay tab the user last captured with. Values match the overlay's names.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LastMode {
    Region,
    FullScreen,
    Window,
}

/// Prompt button the user last picked.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LastAfter {
    Edit,
    Save,
}

/// Remembered only when a capture went through, and only for the steps left
/// on "Ask". It preselects a choice, it never shares anything by itself.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LastChoice {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<LastMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<LastAfter>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AppConfig {
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
    #[serde(default = "default_auto_delete")]
    pub auto_delete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub profiles: Vec<CaptureProfile>,
    #[serde(default)]
    pub last_choice: LastChoice,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_true")]
    pub notify_link: bool,
}

fn default_language() -> String {
    LANGUAGE_AUTO.to_string()
}
fn default_true() -> bool {
    true
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

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            retention_days: default_retention_days(),
            auto_delete: default_auto_delete(),
            folder_id: None,
            profiles: Vec::new(),
            last_choice: LastChoice::default(),
            language: default_language(),
            notify_link: true,
        }
        .normalized()
    }
}

impl AppConfig {
    /// Guarantees at least one profile, at most `MAX_PROFILES`, and keeps the
    /// legacy `hotkey` field equal to the first one.
    fn normalized(mut self) -> Self {
        if self.profiles.is_empty() {
            self.profiles.push(CaptureProfile {
                hotkey: self.hotkey.clone(),
                mode: CaptureMode::Ask,
                after: AfterCapture::Ask,
            });
        }
        self.profiles.truncate(MAX_PROFILES);
        self.hotkey = self.profiles[0].hotkey.clone();
        self
    }
}

pub fn clamp_retention(days: u32) -> u32 {
    days.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)
}

pub fn load_config_from(dir: &Path) -> AppConfig {
    let path = config_path_in(dir);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<AppConfig>(&text)
            .map(AppConfig::normalized)
            .unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config_to(dir: &Path, cfg: &AppConfig) -> anyhow::Result<()> {
    ensure_private_dir(dir)?;
    let text = serde_json::to_string_pretty(cfg)?;
    write_private_file(&config_path_in(dir), text.as_bytes())?;
    Ok(())
}

pub fn load_config() -> AppConfig {
    load_config_from(&app_data_dir())
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    load_config()
}

fn update_config(change: impl FnOnce(&mut AppConfig)) -> Result<AppConfig, String> {
    let dir = app_data_dir();
    let mut cfg = load_config_from(&dir);
    change(&mut cfg);
    save_config_to(&dir, &cfg).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
pub fn save_config(retention_days: u32, auto_delete: bool) -> Result<(), String> {
    update_config(|cfg| {
        cfg.retention_days = clamp_retention(retention_days);
        cfg.auto_delete = auto_delete;
    })
    .map(|_| ())
}

/// Errors are stable codes the settings page translates.
pub fn validate_profiles(profiles: &[CaptureProfile]) -> Result<(), String> {
    if profiles.is_empty() || profiles.len() > MAX_PROFILES {
        return Err("invalid_profile_count".to_string());
    }
    let mut seen = Vec::with_capacity(profiles.len());
    for profile in profiles {
        let shortcut = crate::hotkey::parse_hotkey(&profile.hotkey)
            .map_err(|_| "invalid_hotkey".to_string())?;
        if seen.contains(&shortcut) {
            return Err("duplicate_hotkey".to_string());
        }
        seen.push(shortcut);
    }
    Ok(())
}

/// Registers the shortcuts first: the file only changes if the new ones work.
/// A saved shortcut that another app holds stays excused, or it would block
/// every other change on this page.
#[tauri::command]
pub fn save_profiles(app: AppHandle, profiles: Vec<CaptureProfile>) -> Result<(), String> {
    validate_profiles(&profiles)?;
    let saved: Vec<_> = load_config()
        .profiles
        .iter()
        .filter_map(|p| crate::hotkey::parse_hotkey(&p.hotkey).ok())
        .collect();
    crate::hotkey::sync(&app, &profiles, |shortcut| saved.contains(shortcut))?;
    update_config(|cfg| {
        cfg.hotkey = profiles[0].hotkey.clone();
        cfg.profiles = profiles;
    })
    .map(|_| ())
}

fn merge_last_choice(
    current: LastChoice,
    mode: Option<LastMode>,
    after: Option<LastAfter>,
) -> LastChoice {
    LastChoice {
        mode: mode.or(current.mode),
        after: after.or(current.after),
    }
}

#[tauri::command]
pub fn save_last_choice(
    app: AppHandle,
    mode: Option<LastMode>,
    after: Option<LastAfter>,
) -> Result<(), String> {
    let cfg =
        update_config(|cfg| cfg.last_choice = merge_last_choice(cfg.last_choice, mode, after))?;
    let _ = app.emit("last-choice-changed", cfg.last_choice);
    Ok(())
}

#[tauri::command]
pub fn reset_last_choice() -> Result<(), String> {
    update_config(|cfg| cfg.last_choice = LastChoice::default()).map(|_| ())
}

#[tauri::command]
pub fn save_notify_link(enabled: bool) -> Result<(), String> {
    update_config(|cfg| cfg.notify_link = enabled).map(|_| ())
}

/// The language every window should display, with "auto" already resolved.
#[tauri::command]
pub fn get_language() -> String {
    crate::i18n::current().to_string()
}

#[tauri::command]
pub fn set_language(app: AppHandle, language: String) -> Result<(), String> {
    if language != LANGUAGE_AUTO && !crate::i18n::is_supported(&language) {
        return Err("unsupported_language".to_string());
    }
    update_config(|cfg| cfg.language = language)?;
    if let Err(e) = crate::tray::refresh_menu(&app) {
        eprintln!("[snap2link] tray language refresh failed: {e}");
    }
    let _ = app.emit("language-changed", crate::i18n::current());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn profile(hotkey: &str, mode: CaptureMode, after: AfterCapture) -> CaptureProfile {
        CaptureProfile {
            hotkey: hotkey.into(),
            mode,
            after,
        }
    }

    #[test]
    fn config_from_before_profiles_keeps_the_users_shortcut() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("config.json"),
            r#"{ "hotkey": "Ctrl+Alt+S", "retention_days": 12, "auto_delete": false, "folder_id": "abc" }"#,
        )
        .unwrap();
        let cfg = load_config_from(tmp.path());
        assert_eq!(
            cfg.profiles,
            vec![profile("Ctrl+Alt+S", CaptureMode::Ask, AfterCapture::Ask)]
        );
        assert_eq!(cfg.retention_days, 12);
        assert!(!cfg.auto_delete);
        assert_eq!(cfg.folder_id.as_deref(), Some("abc"));
        assert_eq!(cfg.language, LANGUAGE_AUTO);
        assert!(cfg.notify_link);
    }

    #[test]
    fn extra_profiles_are_dropped_on_load() {
        let tmp = TempDir::new().unwrap();
        let hotkeys = ["Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4"];
        let profiles: Vec<_> = hotkeys
            .iter()
            .map(|h| profile(h, CaptureMode::Region, AfterCapture::Ask))
            .collect();
        let cfg = AppConfig {
            profiles,
            ..AppConfig::default()
        };
        save_config_to(tmp.path(), &cfg).unwrap();
        assert_eq!(load_config_from(tmp.path()).profiles.len(), MAX_PROFILES);
    }

    #[test]
    fn hotkey_field_follows_the_first_profile() {
        let cfg = AppConfig {
            hotkey: "Ctrl+1".into(),
            profiles: vec![profile("Ctrl+2", CaptureMode::Ask, AfterCapture::Ask)],
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(cfg.hotkey, "Ctrl+2");
    }

    #[test]
    fn profile_modes_use_the_names_the_frontend_sends() {
        let json = serde_json::to_string(&profile(
            "Ctrl+1",
            CaptureMode::ActiveWindow,
            AfterCapture::Annotate,
        ))
        .unwrap();
        assert!(json.contains(r#""mode":"active_window""#));
        assert!(json.contains(r#""after":"annotate""#));
        let mode: LastMode = serde_json::from_str(r#""fullScreen""#).unwrap();
        assert_eq!(mode, LastMode::FullScreen);
    }

    #[test]
    fn validate_profiles_rejects_bad_lists() {
        let good = profile("Ctrl+1", CaptureMode::Ask, AfterCapture::Ask);
        assert!(validate_profiles(std::slice::from_ref(&good)).is_ok());
        assert_eq!(validate_profiles(&[]).unwrap_err(), "invalid_profile_count");
        let same = [good.clone(), good.clone()];
        assert_eq!(validate_profiles(&same).unwrap_err(), "duplicate_hotkey");
        let bad = [profile("Ctrl+NotAKey", CaptureMode::Ask, AfterCapture::Ask)];
        assert_eq!(validate_profiles(&bad).unwrap_err(), "invalid_hotkey");
        let four: Vec<_> = (1..=4)
            .map(|n| profile(&format!("Ctrl+{n}"), CaptureMode::Ask, AfterCapture::Ask))
            .collect();
        assert_eq!(validate_profiles(&four).unwrap_err(), "invalid_profile_count");
    }

    #[test]
    fn last_choice_merge_keeps_the_step_that_was_not_asked() {
        let current = LastChoice {
            mode: Some(LastMode::Window),
            after: Some(LastAfter::Edit),
        };
        let merged = merge_last_choice(current, None, Some(LastAfter::Save));
        assert_eq!(merged.mode, Some(LastMode::Window));
        assert_eq!(merged.after, Some(LastAfter::Save));
    }

    #[test]
    fn default_config_has_expected_values() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.hotkey, DEFAULT_HOTKEY);
        assert_eq!(cfg.retention_days, DEFAULT_RETENTION_DAYS);
        assert!(cfg.auto_delete);
        assert!(cfg.folder_id.is_none());
        assert_eq!(cfg.profiles.len(), 1);
        assert_eq!(cfg.profiles[0].hotkey, DEFAULT_HOTKEY);
        assert_eq!(cfg.profiles[0].mode, CaptureMode::Ask);
        assert_eq!(cfg.profiles[0].after, AfterCapture::Ask);
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
            folder_id: Some("abc123".into()),
            profiles: vec![profile("Ctrl+Alt+P", CaptureMode::FullScreen, AfterCapture::Share)],
            last_choice: LastChoice {
                mode: Some(LastMode::Window),
                after: Some(LastAfter::Edit),
            },
            language: "fr".into(),
            notify_link: false,
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

}
