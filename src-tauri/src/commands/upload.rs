//! Sends a capture to the host chosen in the settings.

use std::fs;
use std::sync::Mutex;

use tauri::AppHandle;

use crate::commands::auth::is_authenticated_inner;
use crate::commands::config::{load_config, Hosting};
use crate::commands::{drive, guest, relay};
use crate::utils::resolve_capture_path;

/// The latest upload. The toast's Delete button can only reach this one, so
/// that window never gets to name an arbitrary file.
#[derive(Clone)]
enum LastUpload {
    Drive { file_id: String },
    Relay { base: String, id: String, token: String },
}

static LAST_UPLOAD: Mutex<Option<LastUpload>> = Mutex::new(None);

#[tauri::command]
pub async fn upload_screenshot(app: AppHandle, image_path: String) -> Result<String, String> {
    let image_path = resolve_capture_path(&app, &image_path)?;
    let cfg = load_config();

    let (link, uploaded) = match cfg.hosting() {
        Hosting::Drive => {
            if !is_authenticated_inner() {
                return Err("drive_not_connected".to_string());
            }
            let file_id = drive::upload_file(&app, &image_path).await?;
            (drive::share_link_for(&file_id), LastUpload::Drive { file_id })
        }
        Hosting::Snap2link => {
            let base = cfg.relay_url();
            let bytes = fs::read(&image_path).map_err(|e| e.to_string())?;
            let token = guest::token(&app, &base).await?;
            let created = match relay::upload(&base, &token, bytes.clone()).await {
                Err(code) if code == relay::GUEST_REQUIRED => {
                    let token = guest::renew(&app, &base, &token).await?;
                    relay::upload(&base, &token, bytes).await?
                }
                result => result?,
            };
            let last = LastUpload::Relay {
                base,
                id: created.id,
                token: created.delete_token,
            };
            (created.url, last)
        }
    };

    let _ = fs::remove_file(&image_path);
    if let Ok(mut last) = LAST_UPLOAD.lock() {
        *last = Some(uploaded);
    }
    Ok(link)
}

/// Deletes the capture that was just shared: its link stops working at once.
#[tauri::command]
pub async fn delete_last_upload(app: AppHandle) -> Result<(), String> {
    let upload = LAST_UPLOAD
        .lock()
        .map_err(|_| "upload state poisoned".to_string())?
        .take()
        .ok_or_else(|| "nothing to delete".to_string())?;

    let result = match &upload {
        LastUpload::Drive { file_id } => drive::delete_file(&app, file_id).await,
        LastUpload::Relay { base, id, token } => relay::delete(base, id, token).await,
    };

    // Keep it on failure, so that the user can retry from the same toast.
    if result.is_err() {
        if let Ok(mut last) = LAST_UPLOAD.lock() {
            last.get_or_insert(upload);
        }
    }
    result
}
