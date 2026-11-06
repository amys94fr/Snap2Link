//! The guest token that lets an install use the relay without an account.
//!
//! The relay creates it after a Turnstile challenge. Turnstile only runs on
//! http(s) pages, so the challenge is a page of the relay, in a window of its
//! own. That page has no access to the app: no capability names this window,
//! and its result comes back through a navigation caught here.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;
use url::Url;

use crate::commands::relay;
use crate::i18n;
use crate::utils::{app_data_dir, ensure_private_dir, write_private_file};

const WINDOW_LABEL: &str = "guest";
const CHALLENGE_TIMEOUT: Duration = Duration::from_secs(180);

pub const CANCELLED: &str = "relay_guest_cancelled";

/// One challenge at a time: a second upload waits for the token of the first.
static RENEWAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The relay is saved with its token, which means nothing to another relay.
#[derive(Serialize, Deserialize)]
struct SavedGuest {
    base: String,
    token: String,
}

fn guest_path_in(dir: &Path) -> PathBuf {
    dir.join("guest.json")
}

fn load_from(dir: &Path, base: &str) -> Option<String> {
    let text = fs::read_to_string(guest_path_in(dir)).ok()?;
    let saved: SavedGuest = serde_json::from_str(&text).ok()?;
    (saved.base == base).then_some(saved.token)
}

fn save_to(dir: &Path, base: &str, token: &str) -> anyhow::Result<()> {
    ensure_private_dir(dir)?;
    let text = serde_json::to_string_pretty(&SavedGuest {
        base: base.to_string(),
        token: token.to_string(),
    })?;
    write_private_file(&guest_path_in(dir), text.as_bytes())?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum Step {
    Allow,
    Block,
    Finish(Result<String, String>),
}

/// The window stays on the relay's challenge, and its last page is the result.
fn classify(target: &Url, base: &Url) -> Step {
    if target.origin() != base.origin() {
        return Step::Block;
    }
    match target.path() {
        "/guest" => Step::Allow,
        "/guest/done" => Step::Finish(challenge_result(target)),
        _ => Step::Block,
    }
}

/// The result is in the fragment, which never reaches the server.
fn challenge_result(target: &Url) -> Result<String, String> {
    let fragment = target.fragment().unwrap_or_default();
    url::form_urlencoded::parse(fragment.as_bytes())
        .find(|(name, _)| name == "turnstile")
        .map(|(_, value)| value.into_owned())
        .filter(|token| !token.is_empty())
        .ok_or_else(|| relay::VERIFICATION_FAILED.to_string())
}

type Outcome = Arc<Mutex<Option<oneshot::Sender<Result<String, String>>>>>;

fn settle(outcome: &Outcome, result: Result<String, String>) {
    if let Some(sender) = outcome.lock().ok().and_then(|mut sender| sender.take()) {
        let _ = sender.send(result);
    }
}

async fn run_challenge(app: &AppHandle, base: &str) -> Result<String, String> {
    let base = Url::parse(base).map_err(|e| e.to_string())?;
    let page = base.join("guest").map_err(|e| e.to_string())?;
    let (sender, receiver) = oneshot::channel();
    let outcome: Outcome = Arc::new(Mutex::new(Some(sender)));

    let navigation = outcome.clone();
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(page))
        .title(i18n::tr(i18n::current(), "guest.window_title"))
        .inner_size(360.0, 160.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .center()
        .on_navigation(move |target| match classify(target, &base) {
            Step::Allow => true,
            Step::Block => false,
            Step::Finish(result) => {
                settle(&navigation, result);
                false
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    let closing = outcome.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            settle(&closing, Err(CANCELLED.to_string()));
        }
    });
    let _ = window.set_focus();

    let result = tokio::time::timeout(CHALLENGE_TIMEOUT, receiver).await;
    let _ = window.destroy();
    match result {
        Ok(Ok(result)) => result,
        _ => Err(CANCELLED.to_string()),
    }
}

async fn obtain(app: &AppHandle, base: &str, rejected: Option<&str>) -> Result<String, String> {
    let _turn = RENEWAL.lock().await;
    let dir = app_data_dir();

    // Another upload may have got a token while this one was waiting.
    if let Some(saved) = load_from(&dir, base).filter(|token| Some(token.as_str()) != rejected) {
        return Ok(saved);
    }

    let challenge = run_challenge(app, base).await?;
    let token = relay::create_guest(base, &challenge).await?;
    save_to(&dir, base, &token).map_err(|e| e.to_string())?;
    Ok(token)
}

/// The saved token, if this install has one for this relay.
pub fn saved(base: &str) -> Option<String> {
    load_from(&app_data_dir(), base)
}

/// The saved token, or a new one if this install has none for this relay.
pub async fn token(app: &AppHandle, base: &str) -> Result<String, String> {
    match load_from(&app_data_dir(), base) {
        Some(token) => Ok(token),
        None => obtain(app, base, None).await,
    }
}

/// A new token, after the relay refused `rejected`.
pub async fn renew(app: &AppHandle, base: &str, rejected: &str) -> Result<String, String> {
    obtain(app, base, Some(rejected)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "https://i.snap2link.app";

    fn step(target: &str) -> Step {
        classify(&Url::parse(target).unwrap(), &Url::parse(BASE).unwrap())
    }

    #[test]
    fn the_challenge_page_is_allowed() {
        assert_eq!(step("https://i.snap2link.app/guest"), Step::Allow);
    }

    #[test]
    fn the_last_page_gives_the_token() {
        assert_eq!(
            step("https://i.snap2link.app/guest/done#turnstile=a.b%2Bc"),
            Step::Finish(Ok("a.b+c".to_string()))
        );
    }

    #[test]
    fn a_failed_challenge_has_its_code() {
        for target in [
            "https://i.snap2link.app/guest/done#error=600010",
            "https://i.snap2link.app/guest/done#turnstile=",
            "https://i.snap2link.app/guest/done?turnstile=in-the-query",
            "https://i.snap2link.app/guest/done",
        ] {
            assert_eq!(
                step(target),
                Step::Finish(Err(relay::VERIFICATION_FAILED.to_string())),
                "{target}"
            );
        }
    }

    #[test]
    fn the_window_cannot_leave_the_challenge() {
        for target in [
            "https://evil.example/guest/done#turnstile=stolen",
            "http://i.snap2link.app/guest",
            "https://i.snap2link.app.evil.example/guest",
            "https://i.snap2link.app:8443/guest",
            "https://i.snap2link.app/",
            "https://i.snap2link.app/abc.png",
        ] {
            assert_eq!(step(target), Step::Block, "{target}");
        }
    }

    #[test]
    fn a_token_is_saved_for_its_relay_only() {
        let tmp = tempfile::tempdir().unwrap();
        save_to(tmp.path(), BASE, "tok").unwrap();

        assert_eq!(load_from(tmp.path(), BASE).as_deref(), Some("tok"));
        assert_eq!(load_from(tmp.path(), "https://relay.example"), None);
    }

    #[test]
    fn no_token_or_a_broken_file_means_no_guest() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(load_from(tmp.path(), BASE), None);

        fs::write(guest_path_in(tmp.path()), "{ broken").unwrap();
        assert_eq!(load_from(tmp.path(), BASE), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_token_file_is_private() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        save_to(tmp.path(), BASE, "tok").unwrap();
        let mode = fs::metadata(guest_path_in(tmp.path())).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
