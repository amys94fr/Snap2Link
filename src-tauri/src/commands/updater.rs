//! Auto-update commands wrapping `tauri-plugin-updater`.
//!
//! The signing keypair lives at `.tauri-keys/snap2link.key{.pub}`. The
//! private key is gitignored; the public key string is in
//! `tauri.conf.json` (`plugins.updater.pubkey`).
//!
//! At release time the CI must:
//!   - bundle a release artefact via `cargo tauri build`
//!   - set `TAURI_SIGNING_PRIVATE_KEY` to the contents of `.key` so Tauri
//!     signs the artefact and produces a `latest.json` manifest
//!   - upload both the artefact and `latest.json` to the configured
//!     endpoint (currently a GitHub Releases URL).

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();

    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            available: true,
            current_version,
            latest_version: Some(update.version.clone()),
            release_notes: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateCheckResult {
            available: false,
            current_version,
            latest_version: None,
            release_notes: None,
        }),
        Err(e) => Err(format!("Update check failed: {e}")),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
