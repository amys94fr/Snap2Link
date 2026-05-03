//! Google OAuth — token storage, refresh, and interactive flow.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::commands::config::{load_config_from, save_config_to};
use crate::utils::{app_data_dir, ensure_dir, token_path_in};

pub const SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
];

pub const TOKEN_REFRESH_THRESHOLD_S: i64 = 60;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TokenData {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_at: Option<i64>,
}

impl TokenData {
    pub fn is_valid_at(&self, now: i64) -> bool {
        match self.expires_at {
            Some(exp) => exp - now >= TOKEN_REFRESH_THRESHOLD_S,
            None => false,
        }
    }

    pub fn has_refresh_token(&self) -> bool {
        self.refresh_token
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct ClientSecret {
    installed: ClientSecretInstalled,
}

#[derive(Serialize, Deserialize, Clone)]
struct ClientSecretInstalled {
    client_id: String,
    client_secret: String,
    auth_uri: String,
    token_uri: String,
}

pub fn load_token_from(dir: &Path) -> Option<TokenData> {
    let text = fs::read_to_string(token_path_in(dir)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_token_to(dir: &Path, token: &TokenData) -> anyhow::Result<()> {
    ensure_dir(dir)?;
    let text = serde_json::to_string_pretty(token)?;
    fs::write(token_path_in(dir), text)?;
    Ok(())
}

pub fn delete_token_from(dir: &Path) {
    let _ = fs::remove_file(token_path_in(dir));
}

pub fn is_authenticated_inner() -> bool {
    load_token_from(&app_data_dir())
        .map(|t| t.has_refresh_token())
        .unwrap_or(false)
}

#[tauri::command]
pub fn is_authenticated() -> bool {
    is_authenticated_inner()
}

fn credentials_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        paths.push(res.join("credentials.json"));
        paths.push(res.join("../credentials.json"));
    }
    paths.push(PathBuf::from("./credentials.json"));
    paths.push(PathBuf::from("../credentials.json"));
    paths
}

fn read_credentials(app: &AppHandle) -> Result<ClientSecret, String> {
    for path in credentials_candidates(app) {
        if let Ok(text) = fs::read_to_string(&path) {
            return serde_json::from_str(&text)
                .map_err(|e| format!("Invalid credentials.json: {e}"));
        }
    }
    Err("credentials.json not found".into())
}

#[tauri::command]
pub async fn authenticate(app_handle: AppHandle) -> Result<String, String> {
    use std::net::TcpListener;
    use tiny_http::{Header, Response, Server};

    let creds = read_credentials(&app_handle)?;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    drop(listener);

    let redirect_uri = format!("http://localhost:{port}");
    let scope = SCOPES.join(" ");

    let auth_url = format!(
        "{base}?client_id={cid}&redirect_uri={redir}&response_type=code&scope={scope}&access_type=offline&prompt=select_account",
        base = creds.installed.auth_uri,
        cid = urlencoding::encode(&creds.installed.client_id),
        redir = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(&scope),
    );

    open::that(&auth_url).map_err(|e| format!("Could not open browser: {e}"))?;

    let port_owned = port;
    let server = Server::http(format!("127.0.0.1:{port}"))
        .map_err(|e| e.to_string())?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let request = server.recv().map_err(|e| e.to_string())?;
        let request_url = format!("http://localhost:{port_owned}{}", request.url());

        let html = success_html();
        let response = Response::from_string(html).with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                .unwrap(),
        );
        request.respond(response).ok();

        let parsed = url::Url::parse(&request_url).map_err(|e| e.to_string())?;
        parsed
            .query_pairs()
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.to_string())
            .ok_or_else(|| "No code in callback".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let client = reqwest::Client::new();
    let params = [
        ("code", code.as_str()),
        ("client_id", creds.installed.client_id.as_str()),
        ("client_secret", creds.installed.client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];
    let resp: serde_json::Value = client
        .post(&creds.installed.token_uri)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let access_token = resp["access_token"]
        .as_str()
        .ok_or_else(|| "No access_token in response".to_string())?
        .to_string();
    let refresh_token = resp["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    let token = TokenData {
        access_token: access_token.clone(),
        refresh_token,
        expires_at: Some(expires_at),
    };
    save_token_to(&app_data_dir(), &token).map_err(|e| e.to_string())?;

    let email = fetch_email(&access_token).await.unwrap_or_else(|_| String::from("connected"));
    Ok(email)
}

async fn fetch_email(access_token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    resp["email"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "no email in userinfo".to_string())
}

async fn refresh_access_token(
    app: &AppHandle,
    current: TokenData,
) -> Result<String, String> {
    let creds = read_credentials(app)?;
    let refresh_token = current
        .refresh_token
        .clone()
        .ok_or_else(|| "No refresh token".to_string())?;

    let client = reqwest::Client::new();
    let params = [
        ("refresh_token", refresh_token.as_str()),
        ("client_id", creds.installed.client_id.as_str()),
        ("client_secret", creds.installed.client_secret.as_str()),
        ("grant_type", "refresh_token"),
    ];
    let resp: serde_json::Value = client
        .post(&creds.installed.token_uri)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let new_access = resp["access_token"]
        .as_str()
        .ok_or_else(|| "No access_token in refresh response".to_string())?
        .to_string();
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);
    let new_exp = chrono::Utc::now().timestamp() + expires_in;

    let new_token = TokenData {
        access_token: new_access.clone(),
        refresh_token: Some(refresh_token),
        expires_at: Some(new_exp),
    };
    save_token_to(&app_data_dir(), &new_token).map_err(|e| e.to_string())?;
    Ok(new_access)
}

pub async fn get_valid_token(app: &AppHandle) -> Result<String, String> {
    let token = load_token_from(&app_data_dir())
        .ok_or_else(|| "Not authenticated".to_string())?;
    if token.is_valid_at(chrono::Utc::now().timestamp()) {
        return Ok(token.access_token);
    }
    refresh_access_token(app, token).await
}

#[tauri::command]
pub async fn get_account_email(app: AppHandle) -> Option<String> {
    let token = get_valid_token(&app).await.ok()?;
    fetch_email(&token).await.ok()
}

#[tauri::command]
pub fn disconnect() {
    let dir = app_data_dir();
    delete_token_from(&dir);
    // Forget the cached folder_id so the next account starts fresh.
    let mut cfg = load_config_from(&dir);
    cfg.folder_id = None;
    let _ = save_config_to(&dir, &cfg);
}

fn success_html() -> String {
    r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Snap2Link</title>
<style>
  body{background:#0f172a;color:#f1f5f9;font-family:system-ui;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1e293b;border:1px solid #334155;border-radius:16px;
        padding:48px 56px;text-align:center;max-width:420px}
  h1{color:#22c55e;font-size:24px;margin-bottom:10px}
  p{color:#94a3b8;font-size:15px;line-height:1.6}
</style></head>
<body><div class="card">
  <div style="font-size:56px">✅</div>
  <h1>Google Drive connected!</h1>
  <p>You can close this tab and return to Snap2Link.</p>
</div>
<script>setTimeout(()=>window.close(),3000)</script>
</body></html>"#
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn token(exp: Option<i64>, refresh: Option<&str>) -> TokenData {
        TokenData {
            access_token: "access".into(),
            refresh_token: refresh.map(|s| s.to_string()),
            expires_at: exp,
        }
    }

    #[test]
    fn token_is_valid_when_more_than_60s_before_expiry() {
        assert!(token(Some(2_000_000_000), Some("r")).is_valid_at(1_999_999_900));
    }

    #[test]
    fn token_is_invalid_within_60s_of_expiry() {
        let t = token(Some(2_000_000_000), Some("r"));
        assert!(!t.is_valid_at(1_999_999_950));
        assert!(!t.is_valid_at(2_000_000_000));
        assert!(!t.is_valid_at(2_000_000_100));
    }

    #[test]
    fn token_without_expiry_is_invalid() {
        assert!(!token(None, Some("r")).is_valid_at(0));
    }

    #[test]
    fn has_refresh_token_handles_none_empty_some() {
        assert!(!token(None, None).has_refresh_token());
        assert!(!token(None, Some("")).has_refresh_token());
        assert!(token(None, Some("r")).has_refresh_token());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let t = TokenData {
            access_token: "access-123".into(),
            refresh_token: Some("refresh-456".into()),
            expires_at: Some(1_700_000_000),
        };
        save_token_to(tmp.path(), &t).unwrap();
        assert_eq!(load_token_from(tmp.path()).unwrap(), t);
    }

    #[test]
    fn load_returns_none_when_file_missing() {
        let tmp = TempDir::new().unwrap();
        assert!(load_token_from(tmp.path()).is_none());
    }

    #[test]
    fn load_returns_none_for_invalid_json() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("token.json"), "{ broken").unwrap();
        assert!(load_token_from(tmp.path()).is_none());
    }

    #[test]
    fn delete_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        save_token_to(tmp.path(), &token(None, Some("r"))).unwrap();
        assert!(tmp.path().join("token.json").exists());
        delete_token_from(tmp.path());
        delete_token_from(tmp.path());
        assert!(!tmp.path().join("token.json").exists());
    }

    #[test]
    fn json_is_compatible_with_partial_payloads() {
        let json = r#"{"access_token":"a"}"#;
        let t: TokenData = serde_json::from_str(json).unwrap();
        assert_eq!(t.access_token, "a");
        assert_eq!(t.refresh_token, None);
        assert_eq!(t.expires_at, None);
    }
}
