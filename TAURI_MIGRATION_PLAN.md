# Snap2Link — Tauri + React/TypeScript Migration Plan

## Overview

Full rewrite of Snap2Link (Python/CustomTkinter) → Tauri v2 + React/TypeScript.  
Target platforms: **Windows 10/11** + **macOS 12+**.  
All existing features preserved. i18n-ready from day one.

---

## Feature Parity Checklist

| Feature | Python | Tauri |
|---|---|---|
| Region selection overlay | ✅ | ✅ Transparent Tauri window |
| Upload to Google Drive | ✅ | ✅ Rust (reqwest) |
| Copy link to clipboard | ✅ | ✅ tauri-plugin-clipboard-manager |
| System tray + menu | ✅ | ✅ tauri-plugin-tray |
| Global hotkey | ✅ | ✅ tauri-plugin-global-shortcut |
| Setup wizard (3 steps) | ✅ | ✅ React component |
| Settings window | ✅ | ✅ React component |
| About window | ✅ | ✅ React component |
| Switch Google account | ✅ | ✅ disconnect + re-auth |
| Auto-delete old Drive files | ✅ | ✅ Rust background task |
| Start with Windows/macOS | ✅ | ✅ tauri-plugin-autostart |
| Native notifications | ✅ | ✅ tauri-plugin-notification |
| i18n (en.json, t() fn) | ✅ | ✅ i18next |

---

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js 20+
# https://nodejs.org

# Install Tauri CLI
cargo install tauri-cli --version "^2"

# macOS only: Xcode Command Line Tools
xcode-select --install
```

---

## Project Bootstrap

```bash
npm create tauri-app@latest snap2link -- --template react-ts
cd snap2link
npm install
```

---

## Final Project Structure

```
snap2link/
├── src/                          # React/TypeScript frontend
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root: routes between windows
│   ├── windows/
│   │   ├── SetupWizard.tsx       # 3-step OAuth wizard
│   │   ├── SettingsWindow.tsx    # Settings panel
│   │   ├── AboutWindow.tsx       # About panel
│   │   └── OverlayWindow.tsx     # Fullscreen region selector
│   ├── components/
│   │   ├── HotkeyRecorder.tsx    # Hotkey capture input
│   │   └── RetentionControl.tsx  # Days input + toggle
│   ├── hooks/
│   │   ├── useInvoke.ts          # Wrapper for Tauri invoke
│   │   └── useConfig.ts          # Config read/write
│   ├── i18n/
│   │   ├── index.ts              # i18next init
│   │   └── locales/
│   │       └── en.json           # All UI strings
│   ├── store/
│   │   └── appStore.ts           # Zustand global state
│   └── styles/
│       └── globals.css           # Tailwind base
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/                    # App icons (all sizes)
│   └── src/
│       ├── main.rs               # Entry, setup tray, hotkey
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── auth.rs           # OAuth flow + token management
│       │   ├── drive.rs          # Upload, share, cleanup
│       │   ├── config.rs         # Read/write config.json
│       │   └── screenshot.rs     # Capture region from coords
│       ├── tray.rs               # Tray icon + menu
│       ├── hotkey.rs             # Global shortcut registration
│       └── utils.rs              # App dir, paths
│
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── CHANGELOG.md
└── credentials.json              # Google OAuth desktop credentials (not committed)
```

---

## Tauri Configuration (`tauri.conf.json`)

```json
{
  "productName": "Snap2Link",
  "version": "1.0.0",
  "identifier": "com.snap2link.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "label": "main",
        "title": "Snap2Link",
        "width": 480,
        "height": 520,
        "resizable": false,
        "center": true,
        "visible": false,
        "decorations": true
      },
      {
        "label": "overlay",
        "title": "Snap2Link Overlay",
        "fullscreen": true,
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "visible": false,
        "skipTaskbar": true,
        "resizable": false,
        "focus": true
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.icns", "icons/icon.ico", "icons/icon.png"],
    "resources": ["credentials.json", "locales/*"]
  },
  "plugins": {
    "tray": {},
    "global-shortcut": {},
    "clipboard-manager": {},
    "autostart": {},
    "notification": {}
  }
}
```

---

## Rust Dependencies (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-tray = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-autostart = "2"
tauri-plugin-notification = "2"
tauri-plugin-shell = "2"

serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "multipart"] }
oauth2 = "4"
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1"
dirs = "5"
image = "0.25"
screenshots = "0.8"         # Cross-platform screen capture
open = "5"                  # Open URLs in default browser
tiny_http = "0.12"          # Local OAuth callback server
base64 = "0.22"
```

---

## Frontend Dependencies (`package.json`)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-autostart": "^2",
    "@tauri-apps/plugin-clipboard-manager": "^2",
    "@tauri-apps/plugin-global-shortcut": "^2",
    "@tauri-apps/plugin-notification": "^2",
    "@tauri-apps/plugin-shell": "^2",
    "i18next": "^23",
    "react": "^18",
    "react-dom": "^18",
    "react-i18next": "^14",
    "zustand": "^4",
    "tailwindcss": "^3",
    "clsx": "^2"
  }
}
```

---

## Rust Backend — Full Implementation

### `src-tauri/src/utils.rs`

```rust
use std::path::PathBuf;

pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Snap2Link")
}

pub fn token_path() -> PathBuf {
    app_data_dir().join("token.json")
}

pub fn config_path() -> PathBuf {
    app_data_dir().join("config.json")
}

pub fn ensure_app_dir() {
    std::fs::create_dir_all(app_data_dir()).ok();
}
```

### `src-tauri/src/commands/config.rs`

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use crate::utils::{config_path, ensure_app_dir};

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub hotkey: String,
    pub retention_days: u32,
    pub auto_delete: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: "Ctrl+PrintScreen".to_string(),
            retention_days: 30,
            auto_delete: true,
        }
    }
}

pub fn load_config() -> AppConfig {
    if let Ok(text) = fs::read_to_string(config_path()) {
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

pub fn save_config_inner(cfg: &AppConfig) -> anyhow::Result<()> {
    ensure_app_dir();
    let text = serde_json::to_string_pretty(cfg)?;
    fs::write(config_path(), text)?;
    Ok(())
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    load_config()
}

#[tauri::command]
pub fn save_config(hotkey: String, retention_days: u32, auto_delete: bool) -> Result<(), String> {
    let cfg = AppConfig { hotkey, retention_days, auto_delete };
    save_config_inner(&cfg).map_err(|e| e.to_string())
}
```

### `src-tauri/src/commands/auth.rs`

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use crate::utils::{token_path, ensure_app_dir};

const SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
];

#[derive(Serialize, Deserialize)]
struct ClientSecret {
    installed: ClientSecretInstalled,
}

#[derive(Serialize, Deserialize)]
struct ClientSecretInstalled {
    client_id: String,
    client_secret: String,
    auth_uri: String,
    token_uri: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TokenData {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,  // Unix timestamp
}

fn credentials_path() -> std::path::PathBuf {
    // In production: bundled with app
    if let Ok(res) = tauri::api::path::resource_dir(/* handle */) {
        return res.join("credentials.json");
    }
    std::path::PathBuf::from("credentials.json")
}

// NOTE: For Tauri, use the AppHandle to get resource path:
// app_handle.path().resource_dir().unwrap().join("credentials.json")

pub fn load_token() -> Option<TokenData> {
    let text = fs::read_to_string(token_path()).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_token(token: &TokenData) {
    ensure_app_dir();
    if let Ok(text) = serde_json::to_string_pretty(token) {
        fs::write(token_path(), text).ok();
    }
}

#[tauri::command]
pub fn is_authenticated() -> bool {
    load_token().map(|t| t.refresh_token.is_some()).unwrap_or(false)
}

/// Full OAuth flow: opens browser, waits for callback on localhost.
/// Returns email on success.
#[tauri::command]
pub async fn authenticate(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tiny_http::{Server, Response};
    use std::net::TcpListener;

    // Load credentials.json
    let creds_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("credentials.json");

    let creds_text = fs::read_to_string(&creds_path)
        .map_err(|_| "credentials.json not found".to_string())?;
    let creds: ClientSecret = serde_json::from_str(&creds_text)
        .map_err(|e| e.to_string())?;

    // Pick free port
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);

    let redirect_uri = format!("http://localhost:{}", port);
    let scope = SCOPES.join(" ");

    // Build auth URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=select_account",
        creds.installed.auth_uri,
        urlencoding::encode(&creds.installed.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&scope),
    );

    // Open browser
    open::that(&auth_url).map_err(|e| e.to_string())?;

    // Start local HTTP server to catch callback
    let server = Server::http(format!("127.0.0.1:{}", port))
        .map_err(|e| e.to_string())?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let request = server.recv().map_err(|e| e.to_string())?;
        let url = format!("http://localhost{}", request.url());

        // Serve success HTML
        let html = success_html();
        let response = Response::from_string(html)
            .with_header(tiny_http::Header::from_bytes(
                &b"Content-Type"[..], &b"text/html; charset=utf-8"[..]
            ).unwrap());
        request.respond(response).ok();

        // Extract code param
        let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
        let code = parsed.query_pairs()
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.to_string())
            .ok_or("No code in callback")?;
        Ok(code)
    }).await.map_err(|e| e.to_string())??;

    // Exchange code for tokens
    let client = reqwest::Client::new();
    let params = [
        ("code", code.as_str()),
        ("client_id", &creds.installed.client_id),
        ("client_secret", &creds.installed.client_secret),
        ("redirect_uri", &redirect_uri),
        ("grant_type", "authorization_code"),
    ];
    let resp: serde_json::Value = client
        .post(&creds.installed.token_uri)
        .form(&params)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let access_token = resp["access_token"].as_str()
        .ok_or("No access_token")?.to_string();
    let refresh_token = resp["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    let token = TokenData { access_token: access_token.clone(), refresh_token, expires_at: Some(expires_at) };
    save_token(&token);

    // Get email
    let email = get_email_from_token(&access_token).await.unwrap_or_default();
    Ok(email)
}

pub async fn get_valid_token() -> Result<String, String> {
    let token = load_token().ok_or("Not authenticated")?;

    // Check expiry (refresh if within 60s)
    let now = chrono::Utc::now().timestamp();
    if let Some(exp) = token.expires_at {
        if exp - now < 60 {
            return refresh_access_token(token).await;
        }
    }
    Ok(token.access_token)
}

async fn refresh_access_token(token: TokenData) -> Result<String, String> {
    let creds_text = fs::read_to_string("credentials.json")
        .map_err(|_| "credentials.json not found")?;
    let creds: ClientSecret = serde_json::from_str(&creds_text).map_err(|e| e.to_string())?;

    let refresh_token = token.refresh_token.ok_or("No refresh token")?;
    let client = reqwest::Client::new();
    let params = [
        ("refresh_token", refresh_token.as_str()),
        ("client_id", &creds.installed.client_id),
        ("client_secret", &creds.installed.client_secret),
        ("grant_type", "refresh_token"),
    ];
    let resp: serde_json::Value = client
        .post(&creds.installed.token_uri)
        .form(&params)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let new_access = resp["access_token"].as_str()
        .ok_or("No access_token in refresh")?.to_string();
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);
    let new_exp = chrono::Utc::now().timestamp() + expires_in;

    let new_token = TokenData {
        access_token: new_access.clone(),
        refresh_token: Some(refresh_token),
        expires_at: Some(new_exp),
    };
    save_token(&new_token);
    Ok(new_access)
}

async fn get_email_from_token(access_token: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send().await.ok()?
        .json().await.ok()?;
    resp["email"].as_str().map(|s| s.to_string())
}

#[tauri::command]
pub async fn get_account_email() -> Option<String> {
    let token = get_valid_token().await.ok()?;
    get_email_from_token(&token).await
}

#[tauri::command]
pub fn disconnect() {
    if token_path().exists() {
        fs::remove_file(token_path()).ok();
    }
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
</body></html>"#.to_string()
}
```

### `src-tauri/src/commands/drive.rs`

```rust
use reqwest::multipart;
use chrono::Utc;
use crate::commands::auth::get_valid_token;
use crate::commands::config::load_config;
use crate::utils::{config_path, ensure_app_dir};
use std::fs;
use serde_json::Value;

const FOLDER_NAME: &str = "Snap2Link";

async fn get_or_create_folder(token: &str) -> Result<String, String> {
    // Check cached folder_id
    let mut cfg_val: Value = if config_path().exists() {
        serde_json::from_str(&fs::read_to_string(config_path()).unwrap_or_default())
            .unwrap_or_default()
    } else {
        Value::Object(Default::default())
    };

    if let Some(id) = cfg_val.get("folder_id").and_then(|v| v.as_str()) {
        // Verify still exists
        let client = reqwest::Client::new();
        let resp: Value = client
            .get(format!("https://www.googleapis.com/drive/v3/files/{}?fields=id,trashed", id))
            .bearer_auth(token)
            .send().await.map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        if resp["trashed"].as_bool() != Some(true) && resp.get("id").is_some() {
            return Ok(id.to_string());
        }
    }

    let client = reqwest::Client::new();
    // Search existing folder
    let query = format!(
        "name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        FOLDER_NAME
    );
    let resp: Value = client
        .get("https://www.googleapis.com/drive/v3/files")
        .query(&[("q", query.as_str()), ("fields", "files(id)"), ("pageSize", "1")])
        .bearer_auth(token)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let folder_id = if let Some(id) = resp["files"][0]["id"].as_str() {
        id.to_string()
    } else {
        // Create folder
        let body = serde_json::json!({
            "name": FOLDER_NAME,
            "mimeType": "application/vnd.google-apps.folder"
        });
        let created: Value = client
            .post("https://www.googleapis.com/drive/v3/files?fields=id")
            .bearer_auth(token)
            .json(&body)
            .send().await.map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        created["id"].as_str().ok_or("No folder id")?.to_string()
    };

    // Cache folder_id
    if let Value::Object(ref mut map) = cfg_val {
        map.insert("folder_id".to_string(), Value::String(folder_id.clone()));
    }
    ensure_app_dir();
    fs::write(config_path(), serde_json::to_string_pretty(&cfg_val).unwrap()).ok();

    Ok(folder_id)
}

#[tauri::command]
pub async fn upload_screenshot(image_path: String) -> Result<String, String> {
    let token = get_valid_token().await?;
    let folder_id = get_or_create_folder(&token).await?;

    let timestamp = Utc::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let filename = format!("screenshot_{}.png", timestamp);

    let file_bytes = fs::read(&image_path).map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();

    // Multipart upload
    let metadata = serde_json::json!({
        "name": filename,
        "parents": [folder_id]
    });
    let form = multipart::Form::new()
        .part("metadata", multipart::Part::text(metadata.to_string())
            .mime_str("application/json").unwrap())
        .part("media", multipart::Part::bytes(file_bytes)
            .mime_str("image/png").unwrap()
            .file_name(filename));

    let resp: Value = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id")
        .bearer_auth(&token)
        .multipart(form)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let file_id = resp["id"].as_str().ok_or("No file id in response")?.to_string();

    // Make public
    let perm = serde_json::json!({ "type": "anyone", "role": "reader" });
    client
        .post(format!("https://www.googleapis.com/drive/v3/permissions?fileId={}", file_id))
        .bearer_auth(&token)
        .json(&perm)
        .send().await.map_err(|e| e.to_string())?;

    // Clean up temp file
    fs::remove_file(&image_path).ok();

    Ok(format!(
        "https://drive.usercontent.google.com/u/0/uc?id={}&export=download",
        file_id
    ))
}

#[tauri::command]
pub async fn cleanup_old_screenshots() -> Result<u32, String> {
    let cfg = load_config();
    if !cfg.auto_delete {
        return Ok(0);
    }

    let token = get_valid_token().await?;
    let folder_id = get_or_create_folder(&token).await?;

    let cutoff = Utc::now() - chrono::Duration::days(cfg.retention_days as i64);
    let cutoff_str = cutoff.format("%Y-%m-%dT%H:%M:%S").to_string();

    let client = reqwest::Client::new();
    let query = format!(
        "'{}' in parents and createdTime < '{}' and trashed=false",
        folder_id, cutoff_str
    );

    let mut deleted = 0u32;
    let mut page_token: Option<String> = None;

    loop {
        let mut req = client
            .get("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(&token)
            .query(&[("q", query.as_str()), ("fields", "nextPageToken,files(id)"), ("pageSize", "100")]);
        if let Some(ref pt) = page_token {
            req = req.query(&[("pageToken", pt.as_str())]);
        }
        let resp: Value = req.send().await.map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;

        if let Some(files) = resp["files"].as_array() {
            for file in files {
                if let Some(id) = file["id"].as_str() {
                    client
                        .delete(format!("https://www.googleapis.com/drive/v3/files/{}", id))
                        .bearer_auth(&token)
                        .send().await.ok();
                    deleted += 1;
                }
            }
        }

        page_token = resp["nextPageToken"].as_str().map(|s| s.to_string());
        if page_token.is_none() { break; }
    }

    Ok(deleted)
}
```

### `src-tauri/src/commands/screenshot.rs`

```rust
use screenshots::Screen;
use std::path::PathBuf;

/// Capture the screen region defined by (x, y, width, height).
/// Returns path to saved PNG temp file.
#[tauri::command]
pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;

    // Find screen containing the region
    let screen = screens.iter()
        .find(|s| {
            let info = &s.display_info;
            x >= info.x && y >= info.y
                && x < info.x + info.width as i32
                && y < info.y + info.height as i32
        })
        .or_else(|| screens.first())
        .ok_or("No screen found")?;

    let image = screen.capture_area(x, y, width, height)
        .map_err(|e| e.to_string())?;

    let tmp_path = std::env::temp_dir().join("snap2link_cap.png");
    image.save(&tmp_path).map_err(|e| e.to_string())?;

    Ok(tmp_path.to_string_lossy().to_string())
}
```

### `src-tauri/src/tray.rs`

```rust
use tauri::{
    AppHandle, Manager,
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    menu::{Menu, MenuItem, PredefinedMenuItem},
};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let screenshot_item = MenuItem::with_id(app, "screenshot", "📸  Take Screenshot", true, None::<&str>)?;
    let settings_item  = MenuItem::with_id(app, "settings",   "⚙️  Settings",         true, None::<&str>)?;
    let about_item     = MenuItem::with_id(app, "about",      "ℹ️  About",             true, None::<&str>)?;
    let quit_item      = MenuItem::with_id(app, "quit",       "✖  Quit",             true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &screenshot_item,
        &PredefinedMenuItem::separator(app)?,
        &settings_item,
        &about_item,
        &PredefinedMenuItem::separator(app)?,
        &quit_item,
    ])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Snap2Link")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "screenshot" => trigger_screenshot(app),
            "settings"   => show_main_window(app, "settings"),
            "about"      => show_main_window(app, "about"),
            "quit"       => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                trigger_screenshot(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn trigger_screenshot(app: &AppHandle) {
    app.emit("trigger-screenshot", ()).ok();
}

fn show_main_window(app: &AppHandle, page: &str) {
    let window = app.get_webview_window("main").unwrap();
    window.emit("navigate", page).ok();
    window.show().ok();
    window.set_focus().ok();
}
```

### `src-tauri/src/hotkey.rs`

```rust
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    // Unregister all first
    app.global_shortcut().unregister_all().ok();

    app.global_shortcut()
        .on_shortcut(hotkey, move |app_handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                app_handle.emit("trigger-screenshot", ()).ok();
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_hotkey(app_handle: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    register(&app_handle, &hotkey)
}
```

### `src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands {
    pub mod auth;
    pub mod config;
    pub mod drive;
    pub mod screenshot;
}
mod tray;
mod hotkey;
mod utils;

use tauri::Manager;
use commands::{auth, config, drive, screenshot};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_tray::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            auth::is_authenticated,
            auth::authenticate,
            auth::get_account_email,
            auth::disconnect,
            config::get_config,
            config::save_config,
            drive::upload_screenshot,
            drive::cleanup_old_screenshots,
            screenshot::capture_region,
            hotkey::update_hotkey,
        ])
        .setup(|app| {
            // Setup tray
            tray::setup_tray(app.handle())?;

            // Register hotkey
            let cfg = config::load_config();
            hotkey::register(app.handle(), &cfg.hotkey).ok();

            // If not authenticated → show main window (wizard)
            // If authenticated → stay hidden in tray
            if !auth::is_authenticated() {
                let window = app.get_webview_window("main").unwrap();
                window.show()?;
            } else {
                // Run cleanup in background
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(n) = drive::cleanup_old_screenshots().await {
                        if n > 0 {
                            // send notification via handle
                            let _ = tauri_plugin_notification::NotificationExt::notification(&handle)
                                .title("Snap2Link")
                                .body(format!("🗑 {} old screenshot(s) deleted from Drive.", n))
                                .show();
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## Frontend Implementation

### `src/i18n/locales/en.json`

Same keys as existing Python `locales/en.json` — copy verbatim.

### `src/i18n/index.ts`

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

export default i18n;
export const t = (key: string, vars?: Record<string, unknown>) =>
  i18n.t(key, vars as never);
```

### `src/store/appStore.ts`

```typescript
import { create } from 'zustand';

interface AppState {
  page: 'wizard' | 'settings' | 'about';
  isAuthenticated: boolean;
  setPage: (p: AppState['page']) => void;
  setAuthenticated: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: 'wizard',
  isAuthenticated: false,
  setPage: (page) => set({ page }),
  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
}));
```

### `src/App.tsx`

```tsx
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useAppStore } from './store/appStore';
import { SetupWizard } from './windows/SetupWizard';
import { SettingsWindow } from './windows/SettingsWindow';
import { AboutWindow } from './windows/AboutWindow';

export default function App() {
  const { page, setPage, isAuthenticated, setAuthenticated } = useAppStore();

  useEffect(() => {
    invoke<boolean>('is_authenticated').then(setAuthenticated);

    // Listen for navigation from tray
    const unlisten = listen<string>('navigate', (e) => {
      setPage(e.payload as AppState['page']);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  if (!isAuthenticated) return <SetupWizard onComplete={() => setAuthenticated(true)} />;
  if (page === 'settings') return <SettingsWindow onClose={() => getCurrentWebviewWindow().hide()} />;
  if (page === 'about') return <AboutWindow onClose={() => getCurrentWebviewWindow().hide()} />;
  return null;
}
```

### `src/windows/SetupWizard.tsx`

```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';

type Step = 'welcome' | 'connect' | 'success';

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const mail = await invoke<string>('authenticate');
      setEmail(mail);
      setStep('success');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    await invoke('plugin:autostart|enable');
    onComplete();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0f172a] text-white px-8">
      {step === 'welcome' && (
        <>
          <span className="text-6xl mb-4">📸</span>
          <h1 className="text-3xl font-bold mb-2">Snap2Link</h1>
          <p className="text-[#6B7280] text-center mb-10">{t('wizard.welcome.subtitle')}</p>
          <button
            onClick={() => setStep('connect')}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-8 rounded-lg text-base"
          >
            {t('wizard.welcome.btn')}
          </button>
        </>
      )}

      {step === 'connect' && (
        <>
          <h2 className="text-2xl font-bold mb-3">{t('wizard.connect.title')}</h2>
          <p className="text-[#6B7280] text-center mb-8 whitespace-pre-line">{t('wizard.connect.body')}</p>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-bold py-3 px-8 rounded-lg text-base w-64"
          >
            {loading ? t('wizard.connect.loading') : (error ? t('wizard.connect.retry') : t('wizard.connect.btn'))}
          </button>
          {loading && <p className="text-[#6B7280] text-sm mt-4">{t('wizard.connect.browser_hint')}</p>}
          {error && <p className="text-red-400 text-sm mt-4">{t('wizard.connect.error', { msg: error.slice(0, 80) })}</p>}
        </>
      )}

      {step === 'success' && (
        <>
          <span className="text-6xl mb-4">✅</span>
          <h2 className="text-2xl font-bold text-green-400 mb-2">{t('wizard.success.connected')}</h2>
          <p className="text-[#6B7280] text-sm mb-2">{email}</p>
          <p className="text-center mb-8 whitespace-pre-line">{t('wizard.success.ready')}</p>
          <button
            onClick={handleFinish}
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-base"
          >
            {t('wizard.success.btn')}
          </button>
        </>
      )}
    </div>
  );
}
```

### `src/windows/SettingsWindow.tsx`

```tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
import { t } from '../i18n';
import { HotkeyRecorder } from '../components/HotkeyRecorder';

interface Config {
  hotkey: string;
  retention_days: number;
  auto_delete: boolean;
}

export function SettingsWindow({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('—');
  const [config, setConfig] = useState<Config>({ hotkey: 'Ctrl+PrintScreen', retention_days: 30, auto_delete: true });
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [accHint, setAccHint] = useState('');
  const [delHint, setDelHint] = useState('');

  useEffect(() => {
    invoke<string | null>('get_account_email').then(e => setEmail(e ?? '—'));
    invoke<Config>('get_config').then(setConfig);
    isEnabled().then(setStartupEnabled);
  }, []);

  const handleSwitchAccount = async () => {
    setAccHint(t('settings.switch_account.loading'));
    try {
      await invoke('disconnect');
      const mail = await invoke<string>('authenticate');
      setEmail(mail);
      setAccHint(t('settings.switch_account.success', { email: mail }));
      setTimeout(() => setAccHint(''), 4000);
    } catch (e) {
      setAccHint(t('settings.switch_account.error', { msg: String(e).slice(0, 70) }));
    }
  };

  const handleSaveRetention = async () => {
    await invoke('save_config', config);
    setDelHint(t('settings.delete_saved', { days: config.retention_days }));
    setTimeout(() => setDelHint(''), 3000);
  };

  const handleHotkeyChange = async (combo: string) => {
    const newCfg = { ...config, hotkey: combo };
    setConfig(newCfg);
    await invoke('save_config', newCfg);
    await invoke('update_hotkey', { hotkey: combo });
  };

  const handleStartupToggle = async () => {
    if (startupEnabled) { await disable(); setStartupEnabled(false); }
    else { await enable(); setStartupEnabled(true); }
  };

  return (
    <div className="bg-[#0f172a] text-white h-screen overflow-y-auto px-7 py-7">
      <h1 className="text-xl font-bold mb-3">{t('settings.heading')}</h1>
      <hr className="border-[#374151] mb-4" />

      {/* Google Account */}
      <label className="text-xs text-[#6B7280]">{t('settings.google_account')}</label>
      <div className="flex items-center justify-between mt-1 mb-1">
        <span className="text-sm font-medium">{email}</span>
        <button onClick={handleSwitchAccount}
          className="text-xs bg-[#374151] hover:bg-blue-500 px-3 py-1.5 rounded-lg">
          {t('settings.switch_account')}
        </button>
      </div>
      {accHint && <p className="text-xs mb-3" style={{ color: accHint.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{accHint}</p>}

      {/* Drive Folder */}
      <label className="text-xs text-[#6B7280]">{t('settings.drive_folder')}</label>
      <p className="text-sm font-medium mb-4">Snap2Link</p>

      {/* Hotkey */}
      <label className="text-xs text-[#6B7280]">{t('settings.shortcut')}</label>
      <HotkeyRecorder current={config.hotkey} onChange={handleHotkeyChange} />

      <hr className="border-[#374151] my-4" />

      {/* Auto-delete */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{t('settings.auto_delete')}</span>
        <input type="checkbox" checked={config.auto_delete}
          onChange={e => setConfig(c => ({ ...c, auto_delete: e.target.checked }))}
          className="w-10 h-5 accent-blue-500 cursor-pointer" />
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-[#6B7280]">{t('settings.keep_for')}</span>
        <input type="number" value={config.retention_days} min={1} max={3650}
          disabled={!config.auto_delete}
          onChange={e => setConfig(c => ({ ...c, retention_days: Number(e.target.value) }))}
          className="w-14 text-center bg-[#1e293b] border border-[#374151] rounded px-1 py-0.5 text-sm disabled:opacity-40" />
        <span className="text-xs text-[#6B7280]">{t('settings.days')}</span>
        <button onClick={handleSaveRetention} disabled={!config.auto_delete}
          className="text-xs bg-[#374151] hover:bg-blue-500 px-2 py-1 rounded disabled:opacity-40">OK</button>
      </div>
      {delHint && <p className="text-xs text-green-400 mb-2">{delHint}</p>}

      {/* Startup */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-sm font-medium">{t('settings.startup')}</span>
        <input type="checkbox" checked={startupEnabled} onChange={handleStartupToggle}
          className="w-10 h-5 accent-blue-500 cursor-pointer" />
      </div>

      <hr className="border-[#374151] my-4" />
      <div className="flex justify-between">
        <button onClick={() => {/* navigate to about */}}
          className="text-sm bg-[#374151] hover:bg-[#4B5563] px-4 py-2 rounded-lg">
          {t('settings.about_btn')}
        </button>
        <button onClick={onClose}
          className="text-sm bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg">
          {t('settings.close')}
        </button>
      </div>
    </div>
  );
}
```

### `src/windows/OverlayWindow.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export function OverlayWindow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') getCurrentWebviewWindow().hide();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!start || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear selection rect
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);
    ctx.clearRect(x, y, w, h);

    // Border
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(x, y, w, h);

    // Dimensions label
    ctx.setLineDash([]);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText(` ${w} × ${h} `, e.clientX + 10, e.clientY + 16);

    setDims({ w, h });
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);

    if (w < 10 || h < 10) {
      setStart(null);
      return;
    }

    await getCurrentWebviewWindow().hide();

    try {
      // Small delay to let window hide before capture
      await new Promise(r => setTimeout(r, 150));
      const imagePath = await invoke<string>('capture_region', {
        x: Math.round(x), y: Math.round(y),
        width: Math.round(w), height: Math.round(h)
      });
      const link = await invoke<string>('upload_screenshot', { imagePath });
      await writeText(link);
      sendNotification({ title: 'Snap2Link', body: '✅ Link copied to clipboard!' });
    } catch (err) {
      sendNotification({ title: 'Snap2Link — Error', body: String(err).slice(0, 120) });
    }

    setStart(null);
  };

  return (
    <div className="w-screen h-screen" style={{ cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <canvas
        ref={canvasRef}
        width={window.screen.width}
        height={window.screen.height}
        className="absolute inset-0 w-full h-full"
      />
      {!start && (
        <p className="absolute top-6 left-1/2 -translate-x-1/2 text-white text-sm
          bg-black/40 px-4 py-2 rounded-full pointer-events-none">
          Select an area  •  ESC to cancel
        </p>
      )}
    </div>
  );
}
```

### `src/components/HotkeyRecorder.tsx`

```tsx
import { useState } from 'react';
import { t } from '../i18n';

export function HotkeyRecorder({
  current, onChange
}: { current: string; onChange: (combo: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState('');

  const startRecording = () => {
    setRecording(true);
    setHint(t('settings.shortcut.recording'));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    const key = e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta'
      ? null : e.key;
    if (key) {
      parts.push(key === 'PrintScreen' ? 'PrintScreen' : key.length === 1 ? key.toUpperCase() : key);
      const combo = parts.join('+');
      setRecording(false);
      setHint(t('settings.shortcut.saved'));
      onChange(combo);
      setTimeout(() => setHint(''), 3000);
    }
  };

  return (
    <div className="mt-1 mb-4" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm">{current.replace(/\+/g, ' + ')}</span>
        <button
          onClick={recording ? () => setRecording(false) : startRecording}
          className={`text-xs px-3 py-1.5 rounded-lg ${recording
            ? 'bg-blue-500 text-white' : 'bg-[#374151] hover:bg-blue-500'}`}
        >
          {recording ? t('settings.shortcut.cancel') : t('settings.shortcut.edit')}
        </button>
      </div>
      {hint && (
        <p className={`text-xs mt-1 ${hint.startsWith('✅') ? 'text-green-400' : 'text-blue-400'}`}>
          {hint}
        </p>
      )}
    </div>
  );
}
```

---

## Multi-Window Routing

The app uses **two Tauri windows**:

| Window | Label | Purpose |
|---|---|---|
| Main | `main` | Wizard / Settings / About (React router switches component) |
| Overlay | `overlay` | Transparent fullscreen region selector |

When tray emits `trigger-screenshot`:
1. Frontend listener shows overlay window
2. User selects region → `capture_region` → `upload_screenshot` → clipboard → notification → overlay hides

```typescript
// src/main.tsx — listen for screenshot trigger
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

listen('trigger-screenshot', async () => {
  const overlay = await WebviewWindow.getByLabel('overlay');
  await overlay?.show();
  await overlay?.setFocus();
});
```

---

## macOS-Specific Notes

1. **Screen Recording permission** — macOS 10.15+ requires explicit user grant.  
   Add to `Info.plist` (Tauri handles via `tauri.conf.json`):
   ```json
   "macOSPrivateApi": true
   ```
   On first capture attempt, macOS prompts automatically via `screenshots` crate.

2. **App signing** — Without signing, Gatekeeper shows warning.  
   Options:
   - Sign with Apple Developer cert ($99/year) for no-warning distribution
   - Or provide unsigned `.dmg` with instruction: *right-click → Open*

3. **Tray on macOS** — works natively via `tauri-plugin-tray`, no extra config.

4. **Autostart on macOS** — `tauri-plugin-autostart` uses `LaunchAgent` plist in `~/Library/LaunchAgents/`.

---

## Build Commands

```bash
# Dev
npm run tauri dev

# Build (current platform)
npm run tauri build

# Output locations:
# Windows: src-tauri/target/release/bundle/nsis/Snap2Link_1.0.0_x64-setup.exe
# macOS:   src-tauri/target/release/bundle/dmg/Snap2Link_1.0.0_x64.dmg
#          src-tauri/target/release/bundle/macos/Snap2Link.app
```

---

## i18n Keys Required (`en.json`)

Copy the existing `locales/en.json` verbatim. All keys already cover every UI string.  
To add a language: create `locales/fr.json` with same keys, call `i18n.changeLanguage('fr')`.

---

## Implementation Order

1. `cargo` + `npm` project init with all dependencies
2. Rust: `utils.rs` → `config.rs` → `auth.rs` → `drive.rs` → `screenshot.rs`
3. Rust: `tray.rs` → `hotkey.rs` → `main.rs` (wire everything)
4. Frontend: i18n + store + `App.tsx` routing
5. Frontend: `SetupWizard.tsx`
6. Frontend: `OverlayWindow.tsx` + multi-window trigger
7. Frontend: `SettingsWindow.tsx` + `HotkeyRecorder.tsx`
8. Frontend: `AboutWindow.tsx`
9. Icons (all sizes) via `tauri icon` command
10. Test full flow on Windows, then macOS
11. Build + bundle

---

## Key Files NOT to Forget

- `credentials.json` — must be in project root, bundled via `tauri.conf.json` resources
- `locales/en.json` — copy from Python project
- `icons/` — generate with `cargo tauri icon assets/icon.png`
- `.gitignore` — exclude `credentials.json`, `src-tauri/target/`, `dist/`, `node_modules/`
