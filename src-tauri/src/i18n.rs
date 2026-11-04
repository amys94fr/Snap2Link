//! Language resolution, and the strings Rust displays itself: the tray menu
//! and the page shown in the browser after Google sign-in. Everything else is
//! translated by the frontend, from these same files.

use crate::commands::config::{load_config, LANGUAGE_AUTO};

const DEFAULT_LANGUAGE: &str = "en";

const LOCALES: &[(&str, &str)] = &[
    ("en", include_str!("../../src/i18n/locales/en.json")),
    ("zh-CN", include_str!("../../src/i18n/locales/zh-CN.json")),
    ("zh-TW", include_str!("../../src/i18n/locales/zh-TW.json")),
    ("es", include_str!("../../src/i18n/locales/es.json")),
    ("pt-BR", include_str!("../../src/i18n/locales/pt-BR.json")),
    ("fr", include_str!("../../src/i18n/locales/fr.json")),
    ("de", include_str!("../../src/i18n/locales/de.json")),
    ("ja", include_str!("../../src/i18n/locales/ja.json")),
    ("ko", include_str!("../../src/i18n/locales/ko.json")),
    ("ru", include_str!("../../src/i18n/locales/ru.json")),
    ("uk", include_str!("../../src/i18n/locales/uk.json")),
    ("id", include_str!("../../src/i18n/locales/id.json")),
    ("hi", include_str!("../../src/i18n/locales/hi.json")),
    ("tr", include_str!("../../src/i18n/locales/tr.json")),
    ("vi", include_str!("../../src/i18n/locales/vi.json")),
    ("it", include_str!("../../src/i18n/locales/it.json")),
    ("pl", include_str!("../../src/i18n/locales/pl.json")),
    ("ar", include_str!("../../src/i18n/locales/ar.json")),
    ("he", include_str!("../../src/i18n/locales/he.json")),
    ("fa", include_str!("../../src/i18n/locales/fa.json")),
];

const RTL: &[&str] = &["ar", "he", "fa"];

pub fn is_supported(code: &str) -> bool {
    LOCALES.iter().any(|(c, _)| *c == code)
}

pub fn is_rtl(code: &str) -> bool {
    RTL.contains(&code)
}

/// Maps a system locale such as `fr-FR`, `zh_Hant_TW` or `pt-PT` to a shipped
/// language.
fn match_locale(locale: &str) -> Option<&'static str> {
    let normalized = locale.replace('_', "-").to_lowercase();
    let normalized = normalized.split('.').next().unwrap_or_default();
    let mut parts = normalized.split('-');
    let base = parts.next().unwrap_or_default();
    let code = match base {
        "zh" => {
            if parts.any(|p| matches!(p, "hant" | "tw" | "hk" | "mo")) {
                "zh-TW"
            } else {
                "zh-CN"
            }
        }
        "pt" => "pt-BR",
        "iw" => "he",
        "in" => "id",
        other => other,
    };
    LOCALES.iter().map(|(c, _)| *c).find(|c| *c == code)
}

/// A language chosen in the settings wins, then the system's, then English.
pub fn resolve(setting: &str, system: Option<&str>) -> &'static str {
    if setting != LANGUAGE_AUTO {
        if let Some((code, _)) = LOCALES.iter().find(|(c, _)| *c == setting) {
            return code;
        }
    }
    system.and_then(match_locale).unwrap_or(DEFAULT_LANGUAGE)
}

pub fn current() -> &'static str {
    resolve(&load_config().language, sys_locale::get_locale().as_deref())
}

fn lookup(code: &str, key: &str) -> Option<String> {
    let (_, text) = LOCALES.iter().find(|(c, _)| *c == code)?;
    let strings: serde_json::Value = serde_json::from_str(text).ok()?;
    strings.get(key)?.as_str().map(str::to_string)
}

/// Falls back to English, then to the key, so a gap never hides a menu item.
pub fn tr(code: &str, key: &str) -> String {
    lookup(code, key)
        .or_else(|| lookup(DEFAULT_LANGUAGE, key))
        .unwrap_or_else(|| key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_locales_map_to_shipped_languages() {
        assert_eq!(resolve("auto", Some("fr-FR")), "fr");
        assert_eq!(resolve("auto", Some("de_AT")), "de");
        assert_eq!(resolve("auto", Some("pt-PT")), "pt-BR");
        assert_eq!(resolve("auto", Some("zh-CN")), "zh-CN");
        assert_eq!(resolve("auto", Some("zh-Hans-SG")), "zh-CN");
        assert_eq!(resolve("auto", Some("zh-Hant-HK")), "zh-TW");
        assert_eq!(resolve("auto", Some("zh_TW")), "zh-TW");
        assert_eq!(resolve("auto", Some("iw-IL")), "he");
        assert_eq!(resolve("auto", Some("fr_FR.UTF-8")), "fr");
    }

    #[test]
    fn unknown_or_missing_system_language_means_english() {
        assert_eq!(resolve("auto", Some("sv-SE")), "en");
        assert_eq!(resolve("auto", None), "en");
    }

    #[test]
    fn explicit_setting_beats_the_system() {
        assert_eq!(resolve("ja", Some("fr-FR")), "ja");
        assert_eq!(resolve("klingon", Some("fr-FR")), "fr");
    }

    #[test]
    fn every_locale_has_what_rust_displays() {
        let keys = [
            "tray.screenshot",
            "tray.settings",
            "tray.check_updates",
            "tray.about",
            "tray.quit",
            "oauth.success.title",
            "oauth.success.body",
            "oauth.failure.title",
            "oauth.failure.body",
        ];
        for (code, _) in LOCALES {
            for key in keys {
                assert!(lookup(code, key).is_some(), "{code} lacks {key}");
            }
        }
    }

    #[test]
    fn right_to_left_languages_are_flagged() {
        assert!(is_rtl("ar") && is_rtl("he") && is_rtl("fa"));
        assert!(!is_rtl("fr"));
    }
}
