//! Google Drive API — folder management, upload, cleanup.

use chrono::{DateTime, Utc};
use serde_json::Value;
use std::fs;
use tauri::AppHandle;

use crate::commands::auth::get_valid_token;
use crate::commands::config::{load_config_from, save_config_to};
use crate::utils::app_data_dir;

pub const FOLDER_NAME: &str = "Snap2Link";

/// Public direct-download share link for a Drive file ID.
/// Uses the canonical `drive.google.com/uc` form (no `/u/0/`) so a viewer
/// who isn't signed in to Google can still open the link.
pub fn share_link_for(file_id: &str) -> String {
    format!("https://drive.google.com/uc?id={}&export=download", file_id)
}

pub fn screenshot_filename(at: DateTime<Utc>) -> String {
    format!("screenshot_{}.png", at.format("%Y-%m-%d_%H-%M-%S"))
}

pub fn retention_cutoff(now: DateTime<Utc>, days: u32) -> String {
    let cutoff = now - chrono::Duration::days(days as i64);
    cutoff.format("%Y-%m-%dT%H:%M:%S").to_string()
}

async fn get_or_create_folder(token: &str, app: &AppHandle) -> Result<String, String> {
    let dir = app_data_dir();
    let mut cfg = load_config_from(&dir);

    let client = reqwest::Client::new();

    if let Some(id) = cfg.folder_id.as_deref() {
        let resp: Value = client
            .get(format!(
                "https://www.googleapis.com/drive/v3/files/{}?fields=id,trashed",
                id
            ))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        if resp.get("id").is_some() && resp["trashed"].as_bool() != Some(true) {
            return Ok(id.to_string());
        }
    }

    let query = format!(
        "name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        FOLDER_NAME
    );
    let resp: Value = client
        .get("https://www.googleapis.com/drive/v3/files")
        .query(&[
            ("q", query.as_str()),
            ("fields", "files(id)"),
            ("pageSize", "1"),
        ])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let folder_id = if let Some(id) = resp["files"][0]["id"].as_str() {
        id.to_string()
    } else {
        let body = serde_json::json!({
            "name": FOLDER_NAME,
            "mimeType": "application/vnd.google-apps.folder",
        });
        let created: Value = client
            .post("https://www.googleapis.com/drive/v3/files?fields=id")
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        created["id"]
            .as_str()
            .ok_or_else(|| "No folder id in create response".to_string())?
            .to_string()
    };

    cfg.folder_id = Some(folder_id.clone());
    save_config_to(&dir, &cfg).map_err(|e| e.to_string())?;
    let _ = app; // keep AppHandle alive for future bundled-resource access.
    Ok(folder_id)
}

#[tauri::command]
pub async fn upload_screenshot(
    app: AppHandle,
    image_path: String,
) -> Result<String, String> {
    let token = get_valid_token(&app).await?;
    let folder_id = get_or_create_folder(&token, &app).await?;

    let filename = screenshot_filename(Utc::now());
    let bytes = fs::read(&image_path).map_err(|e| e.to_string())?;

    let metadata = serde_json::json!({
        "name": filename,
        "parents": [folder_id],
    });

    let form = reqwest::multipart::Form::new()
        .part(
            "metadata",
            reqwest::multipart::Part::text(metadata.to_string())
                .mime_str("application/json")
                .map_err(|e| e.to_string())?,
        )
        .part(
            "media",
            reqwest::multipart::Part::bytes(bytes)
                .mime_str("image/png")
                .map_err(|e| e.to_string())?
                .file_name(filename),
        );

    let client = reqwest::Client::new();
    let upload_resp = client
        .post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        )
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("upload network error: {e}"))?;

    let upload_status = upload_resp.status();
    let upload_body = upload_resp
        .text()
        .await
        .map_err(|e| format!("could not read upload response: {e}"))?;

    if !upload_status.is_success() {
        return Err(format!(
            "Drive upload failed ({upload_status}): {}",
            truncate(&upload_body, 300)
        ));
    }

    let resp: Value = serde_json::from_str(&upload_body)
        .map_err(|e| format!("invalid upload response: {e}: {}", truncate(&upload_body, 300)))?;

    let file_id = resp["id"]
        .as_str()
        .ok_or_else(|| format!("No file id in upload response: {resp}"))?
        .to_string();

    // Make the file public by granting read access to anyone.
    // Drive API expects the fileId in the *path*, not the query string:
    //   POST /drive/v3/files/{fileId}/permissions
    let perm = serde_json::json!({ "type": "anyone", "role": "reader" });
    let perm_resp = client
        .post(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}/permissions"
        ))
        .bearer_auth(&token)
        .json(&perm)
        .send()
        .await
        .map_err(|e| format!("permission network error: {e}"))?;

    let perm_status = perm_resp.status();
    if !perm_status.is_success() {
        let body = perm_resp.text().await.unwrap_or_default();
        return Err(format!(
            "Could not make file public ({perm_status}): {}",
            truncate(&body, 300)
        ));
    }

    let _ = fs::remove_file(&image_path);

    Ok(share_link_for(&file_id))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

#[tauri::command]
pub async fn cleanup_old_screenshots(app: AppHandle) -> Result<u32, String> {
    cleanup_old_screenshots_inner(&app).await
}

pub async fn cleanup_old_screenshots_inner(app: &AppHandle) -> Result<u32, String> {
    let cfg = load_config_from(&app_data_dir());
    if !cfg.auto_delete {
        return Ok(0);
    }
    let token = get_valid_token(app).await?;
    let folder_id = get_or_create_folder(&token, app).await?;

    let cutoff = retention_cutoff(Utc::now(), cfg.retention_days);
    let query = format!(
        "'{folder_id}' in parents and createdTime < '{cutoff}' and trashed=false"
    );

    let mut deleted: u32 = 0;
    let mut page_token: Option<String> = None;
    let client = reqwest::Client::new();

    loop {
        let mut req = client
            .get("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(&token)
            .query(&[
                ("q", query.as_str()),
                ("fields", "nextPageToken,files(id)"),
                ("pageSize", "100"),
            ]);
        if let Some(ref pt) = page_token {
            req = req.query(&[("pageToken", pt.as_str())]);
        }
        let resp: Value = req
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        if let Some(files) = resp["files"].as_array() {
            for file in files {
                if let Some(id) = file["id"].as_str() {
                    let _ = client
                        .delete(format!(
                            "https://www.googleapis.com/drive/v3/files/{id}"
                        ))
                        .bearer_auth(&token)
                        .send()
                        .await;
                    deleted += 1;
                }
            }
        }

        page_token = resp["nextPageToken"].as_str().map(|s| s.to_string());
        if page_token.is_none() {
            break;
        }
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn share_link_uses_public_drive_format() {
        assert_eq!(
            share_link_for("abc123"),
            "https://drive.google.com/uc?id=abc123&export=download"
        );
    }

    #[test]
    fn share_link_does_not_use_u0_path() {
        // The /u/0/ variant requires the viewer to be signed in to Google;
        // we want the canonical anonymous-friendly form.
        assert!(!share_link_for("abc").contains("/u/0/"));
    }

    #[test]
    fn truncate_helper_caps_long_strings() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("abcdefghij", 5), "abcde…");
    }

    #[test]
    fn screenshot_filename_uses_dashed_iso_timestamp() {
        let t = Utc.with_ymd_and_hms(2026, 5, 1, 14, 30, 45).unwrap();
        assert_eq!(screenshot_filename(t), "screenshot_2026-05-01_14-30-45.png");
    }

    #[test]
    fn retention_cutoff_subtracts_n_days() {
        let now = Utc.with_ymd_and_hms(2026, 5, 1, 12, 0, 0).unwrap();
        assert_eq!(retention_cutoff(now, 30), "2026-04-01T12:00:00");
        assert_eq!(retention_cutoff(now, 1), "2026-04-30T12:00:00");
    }

    #[test]
    fn retention_cutoff_handles_year_boundary() {
        let now = Utc.with_ymd_and_hms(2026, 1, 5, 12, 0, 0).unwrap();
        assert_eq!(retention_cutoff(now, 30), "2025-12-06T12:00:00");
    }
}
