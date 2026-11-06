//! The Snap2Link account of this install.
//!
//! Signing in takes an email address and a code, or a Google account. Both go
//! through the relay, which only answers an install that holds a guest token: a
//! sign-in can open the Turnstile window, like a first upload.

use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::config::load_config;
use crate::commands::{auth, guest, relay};
use crate::i18n;
use crate::tray;
use crate::utils::{app_data_dir, ensure_private_dir, write_private_file};

/// Anything that kept Google from answering: the user closed it, or it failed.
const GOOGLE_FAILED: &str = "google_sign_in_failed";

/// The relay is saved with its session, which means nothing to another relay.
#[derive(Serialize, Deserialize)]
struct SavedSession {
    base: String,
    token: String,
    email: String,
}

fn session_path_in(dir: &Path) -> PathBuf {
    dir.join("account.json")
}

fn load_from(dir: &Path, base: &str) -> Option<SavedSession> {
    let text = fs::read_to_string(session_path_in(dir)).ok()?;
    let saved: SavedSession = serde_json::from_str(&text).ok()?;
    (saved.base == base).then_some(saved)
}

fn save_to(dir: &Path, saved: &SavedSession) -> anyhow::Result<()> {
    ensure_private_dir(dir)?;
    let text = serde_json::to_string_pretty(saved)?;
    write_private_file(&session_path_in(dir), text.as_bytes())?;
    Ok(())
}

fn forget_in(dir: &Path) {
    let _ = fs::remove_file(session_path_in(dir));
}

/// The session token for this relay, when this install is signed in.
pub fn session(base: &str) -> Option<String> {
    load_from(&app_data_dir(), base).map(|saved| saved.token)
}

/// Signs out locally, after the relay refused the session.
pub fn forget_session() {
    forget_in(&app_data_dir());
}

/// Runs `call` with the guest token, and once more with a new one if the relay
/// no longer knows it.
async fn with_guest<T, F, Fut>(app: &AppHandle, base: &str, call: F) -> Result<T, String>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let token = guest::token(app, base).await?;
    match call(token.clone()).await {
        Err(code) if code == relay::GUEST_REQUIRED => {
            let token = guest::renew(app, base, &token).await?;
            call(token).await
        }
        result => result,
    }
}

#[tauri::command]
pub async fn request_login_code(app: AppHandle, email: String) -> Result<(), String> {
    let base = load_config().relay_url();
    let language = i18n::current();
    with_guest(&app, &base, |guest| {
        let (base, email) = (base.clone(), email.clone());
        async move { relay::request_code(&base, &guest, &email, language).await }
    })
    .await
}

#[tauri::command]
pub async fn verify_login_code(app: AppHandle, email: String, code: String) -> Result<(), String> {
    let base = load_config().relay_url();
    let session = with_guest(&app, &base, |guest| {
        let (base, email, code) = (base.clone(), email.clone(), code.clone());
        async move { relay::verify_code(&base, &guest, &email, &code).await }
    })
    .await?;
    keep_session(base, session)
}

/// Signs in through the browser. Google's token only proves the address to the
/// relay: this install keeps the relay's session, like after a code.
#[tauri::command]
pub async fn sign_in_with_google(app: AppHandle) -> Result<(), String> {
    let base = load_config().relay_url();
    let id_token = auth::identity_token(&app)
        .await
        .map_err(|_| GOOGLE_FAILED.to_string())?;
    let session = with_guest(&app, &base, |guest| {
        let (base, id_token) = (base.clone(), id_token.clone());
        async move { relay::sign_in_with_google(&base, &guest, &id_token).await }
    })
    .await?;
    keep_session(base, session)
}

fn keep_session(base: String, session: relay::NewSession) -> Result<(), String> {
    let saved = SavedSession {
        base,
        token: session.session_token,
        email: session.email,
    };
    save_to(&app_data_dir(), &saved).map_err(|e| e.to_string())
}

/// What the relay says about this account, or nothing when signed out. A
/// session the relay refuses is forgotten here.
#[tauri::command]
pub async fn get_account() -> Result<Option<relay::AccountStatus>, String> {
    let base = load_config().relay_url();
    let Some(token) = session(&base) else {
        return Ok(None);
    };
    match relay::account(&base, &token).await {
        Err(code) if code == relay::SESSION_REQUIRED => {
            forget_session();
            Ok(None)
        }
        result => result.map(Some),
    }
}

/// The address of this install's account, without asking the relay.
#[tauri::command]
pub fn get_snap2link_email() -> Option<String> {
    let base = load_config().relay_url();
    load_from(&app_data_dir(), &base).map(|saved| saved.email)
}

/// Always signs out here: the session dies on the relay when it can be reached.
#[tauri::command]
pub async fn sign_out() -> Result<(), String> {
    let base = load_config().relay_url();
    if let Some(token) = session(&base) {
        let _ = relay::sign_out(&base, &token).await;
    }
    forget_session();
    Ok(())
}

#[tauri::command]
pub async fn delete_account() -> Result<(), String> {
    let base = load_config().relay_url();
    let token = session(&base).ok_or_else(|| relay::SESSION_REQUIRED.to_string())?;
    let result = relay::delete_account(&base, &token).await;
    if result.is_ok() || result.as_ref().err().map(String::as_str) == Some(relay::SESSION_REQUIRED) {
        forget_session();
    }
    result
}

/// Opens the place to sign in. The toast can only ask for this one page.
#[tauri::command]
pub fn open_account_settings(app: AppHandle) {
    tray::show_main(&app, "account");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(base: &str) -> SavedSession {
        SavedSession {
            base: base.to_string(),
            token: "s_token".to_string(),
            email: "someone@example.com".to_string(),
        }
    }

    #[test]
    fn a_session_comes_back_for_its_own_relay_only() {
        let tmp = tempfile::tempdir().unwrap();
        save_to(tmp.path(), &saved("https://i.snap2link.app")).unwrap();

        let back = load_from(tmp.path(), "https://i.snap2link.app").unwrap();
        assert_eq!(back.token, "s_token");
        assert_eq!(back.email, "someone@example.com");
        assert!(load_from(tmp.path(), "https://relay.example").is_none());
    }

    #[test]
    fn no_file_or_a_broken_one_means_signed_out() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load_from(tmp.path(), "https://i.snap2link.app").is_none());

        fs::write(session_path_in(tmp.path()), "{ broken").unwrap();
        assert!(load_from(tmp.path(), "https://i.snap2link.app").is_none());
    }

    #[test]
    fn forgetting_removes_the_session_and_can_run_twice() {
        let tmp = tempfile::tempdir().unwrap();
        save_to(tmp.path(), &saved("https://i.snap2link.app")).unwrap();

        forget_in(tmp.path());
        forget_in(tmp.path());

        assert!(load_from(tmp.path(), "https://i.snap2link.app").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn the_session_file_is_private() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        save_to(tmp.path(), &saved("https://i.snap2link.app")).unwrap();

        let mode = fs::metadata(session_path_in(tmp.path())).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
