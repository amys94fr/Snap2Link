//! The captures of the chosen host, for the History page. Each host keeps its
//! own list, so nothing is stored here and the page is the same on every PC.

use serde::Serialize;
use tauri::AppHandle;

use crate::commands::auth::is_authenticated_inner;
use crate::commands::config::{load_config, Hosting};
use crate::commands::drive::is_valid_drive_id;
use crate::commands::{account, drive, guest, relay};

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: String,
    pub url: String,
    pub thumbnail: Option<String>,
    pub created_at: String,
    /// When the link stops working, if it ever does.
    pub expires_at: Option<String>,
    pub kept: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct History {
    pub entries: Vec<Entry>,
    /// How many links can be kept: 0 when the host has no use for it, none
    /// when there's no limit.
    pub max_kept: Option<u32>,
}

fn from_relay(links: relay::Links) -> History {
    History {
        entries: links
            .captures
            .into_iter()
            .map(|link| Entry {
                thumbnail: Some(link.url.clone()),
                id: link.id,
                url: link.url,
                created_at: link.created_at,
                expires_at: Some(link.expires_at),
                kept: link.pinned,
            })
            .collect(),
        max_kept: Some(links.max_pins),
    }
}

/// Reads with the account when signed in, as uploads do. Without a saved guest
/// there's nothing to list, and no reason to run the challenge for it.
async fn relay_history(base: &str) -> Result<History, String> {
    if let Some(session) = account::session(base) {
        match relay::history(base, &session).await {
            Err(code) if code == relay::SESSION_REQUIRED => account::forget_session(),
            result => return result.map(from_relay),
        }
    }

    let empty = History { entries: vec![], max_kept: Some(0) };
    let Some(token) = guest::saved(base) else {
        return Ok(empty);
    };
    match relay::history(base, &token).await {
        Err(code) if code == relay::GUEST_REQUIRED => Ok(empty),
        result => result.map(from_relay),
    }
}

/// Whoever can act on the relay's links for this install.
fn relay_owner(base: &str) -> Result<String, String> {
    account::session(base)
        .or_else(|| guest::saved(base))
        .ok_or_else(|| relay::GUEST_REQUIRED.to_string())
}

fn drive_ready(id: &str) -> Result<(), String> {
    if !is_authenticated_inner() {
        return Err("drive_not_connected".to_string());
    }
    if !is_valid_drive_id(id) {
        return Err("invalid capture".to_string());
    }
    Ok(())
}

fn relay_id(id: &str) -> Result<(), String> {
    if relay::is_capture_id(id) {
        Ok(())
    } else {
        Err("invalid capture".to_string())
    }
}

#[tauri::command]
pub async fn get_history(app: AppHandle) -> Result<History, String> {
    let cfg = load_config();
    match cfg.hosting() {
        Hosting::Drive => {
            if !is_authenticated_inner() {
                return Err("drive_not_connected".to_string());
            }
            drive::history(&app, &cfg).await
        }
        Hosting::Snap2link => relay_history(&cfg.relay_url()).await,
    }
}

#[tauri::command]
pub async fn delete_capture(app: AppHandle, id: String) -> Result<(), String> {
    let cfg = load_config();
    match cfg.hosting() {
        Hosting::Drive => {
            drive_ready(&id)?;
            drive::delete_file(&app, &id).await
        }
        Hosting::Snap2link => {
            relay_id(&id)?;
            let base = cfg.relay_url();
            relay::delete(&base, &id, &relay_owner(&base)?).await
        }
    }
}

#[tauri::command]
pub async fn set_capture_kept(app: AppHandle, id: String, kept: bool) -> Result<(), String> {
    let cfg = load_config();
    match cfg.hosting() {
        Hosting::Drive => {
            drive_ready(&id)?;
            drive::set_kept(&app, &id, kept).await
        }
        Hosting::Snap2link => {
            relay_id(&id)?;
            let base = cfg.relay_url();
            relay::set_pinned(&base, &id, &relay_owner(&base)?, kept).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relay_link_shows_itself_as_its_thumbnail() {
        let history = from_relay(relay::Links {
            captures: vec![relay::Link {
                id: "abc".to_string(),
                url: "https://i.snap2link.app/abc".to_string(),
                created_at: "2026-11-06T10:00:00.000Z".to_string(),
                expires_at: "2026-11-08T10:00:00.000Z".to_string(),
                pinned: true,
            }],
            max_pins: 5,
        });

        assert_eq!(history.max_kept, Some(5));
        assert_eq!(
            history.entries,
            vec![Entry {
                id: "abc".to_string(),
                url: "https://i.snap2link.app/abc".to_string(),
                thumbnail: Some("https://i.snap2link.app/abc".to_string()),
                created_at: "2026-11-06T10:00:00.000Z".to_string(),
                expires_at: Some("2026-11-08T10:00:00.000Z".to_string()),
                kept: true,
            }]
        );
    }

    #[test]
    fn a_path_is_never_taken_for_a_capture() {
        assert!(relay_id("../v1/me").is_err());
        assert!(relay_id("0123456789abcdefghijkl").is_ok());
    }
}
