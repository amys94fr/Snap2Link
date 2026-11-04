//! Client for the Snap2Link relay (see `relay/` at the repository root).
//!
//! Failures come back as stable codes that the overlay translates.

use serde::Deserialize;

/// What the relay answers to an upload.
#[derive(Deserialize, Debug, PartialEq, Eq)]
pub struct Created {
    pub id: String,
    pub url: String,
    pub delete_token: String,
}

#[derive(Deserialize)]
struct RelayError {
    error: String,
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}{path}", base.trim_end_matches('/'))
}

fn error_code(body: &str, status: reqwest::StatusCode) -> String {
    match serde_json::from_str::<RelayError>(body).map(|e| e.error).as_deref() {
        Ok("daily_limit") => "relay_daily_limit".to_string(),
        Ok("service_busy") => "relay_service_busy".to_string(),
        Ok("too_large") => "relay_too_large".to_string(),
        _ => format!("Snap2Link hosting answered {status}"),
    }
}

pub async fn upload(base: &str, bytes: Vec<u8>) -> Result<Created, String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/captures"))
        .header("Content-Type", "image/png")
        .body(bytes)
        .send()
        .await
        .map_err(|_| "relay_unreachable".to_string())?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| "relay_unreachable".to_string())?;
    if !status.is_success() {
        return Err(error_code(&body, status));
    }

    let created: Created =
        serde_json::from_str(&body).map_err(|e| format!("invalid relay response: {e}"))?;
    // This link goes to the clipboard and gets shared: it has to be the relay's.
    if !created.url.starts_with(&endpoint(base, "/")) {
        return Err("invalid relay response: unexpected link".to_string());
    }
    Ok(created)
}

pub async fn delete(base: &str, id: &str, token: &str) -> Result<(), String> {
    let response = reqwest::Client::new()
        .delete(endpoint(base, &format!("/v1/captures/{id}")))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "relay_unreachable".to_string())?;

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(format!("Snap2Link hosting answered {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn created(base: &str) -> String {
        format!(r#"{{"id":"abc","url":"{base}/abc.png","delete_token":"tok","expires_at":"x"}}"#)
    }

    #[tokio::test]
    async fn upload_sends_the_png_and_returns_the_link() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/captures")
            .match_header("content-type", "image/png")
            .match_body(vec![1u8, 2, 3])
            .with_status(201)
            .with_body(created(&server.url()))
            .create_async()
            .await;

        let result = upload(&server.url(), vec![1, 2, 3]).await.unwrap();

        mock.assert_async().await;
        assert_eq!(result.url, format!("{}/abc.png", server.url()));
        assert_eq!(result.delete_token, "tok");
    }

    #[tokio::test]
    async fn a_trailing_slash_in_the_url_is_fine() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/v1/captures")
            .with_status(201)
            .with_body(created(&server.url()))
            .create_async()
            .await;

        let base = format!("{}/", server.url());
        assert!(upload(&base, vec![1]).await.is_ok());
    }

    #[tokio::test]
    async fn relay_refusals_become_codes_the_overlay_knows() {
        for (status, error, code) in [
            (429, "daily_limit", "relay_daily_limit"),
            (503, "service_busy", "relay_service_busy"),
            (413, "too_large", "relay_too_large"),
        ] {
            let mut server = mockito::Server::new_async().await;
            server
                .mock("POST", "/v1/captures")
                .with_status(status)
                .with_body(format!(r#"{{"error":"{error}"}}"#))
                .create_async()
                .await;

            assert_eq!(upload(&server.url(), vec![1]).await.unwrap_err(), code);
        }
    }

    #[tokio::test]
    async fn an_unknown_failure_keeps_the_status() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/v1/captures")
            .with_status(500)
            .with_body("oops")
            .create_async()
            .await;

        let error = upload(&server.url(), vec![1]).await.unwrap_err();
        assert!(error.contains("500"), "{error}");
    }

    #[tokio::test]
    async fn an_unreachable_relay_has_its_own_code() {
        let error = upload("http://127.0.0.1:1", vec![1]).await.unwrap_err();
        assert_eq!(error, "relay_unreachable");
    }

    #[tokio::test]
    async fn a_link_from_another_host_is_refused() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/v1/captures")
            .with_status(201)
            .with_body(created("https://evil.example"))
            .create_async()
            .await;

        let error = upload(&server.url(), vec![1]).await.unwrap_err();
        assert!(error.contains("unexpected link"), "{error}");
    }

    #[tokio::test]
    async fn delete_sends_the_token() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/v1/captures/abc")
            .match_header("authorization", "Bearer tok")
            .with_status(204)
            .create_async()
            .await;

        delete(&server.url(), "abc", "tok").await.unwrap();
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn a_refused_delete_is_an_error() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("DELETE", "/v1/captures/abc")
            .with_status(404)
            .create_async()
            .await;

        assert!(delete(&server.url(), "abc", "tok").await.is_err());
    }
}
