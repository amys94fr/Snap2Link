//! Client for the Snap2Link relay (see `relay/` at the repository root).
//!
//! Failures come back as stable codes that the overlay translates.

use serde::{Deserialize, Serialize};

/// What the relay answers to an upload.
#[derive(Deserialize, Debug, PartialEq, Eq)]
pub struct Created {
    pub id: String,
    pub url: String,
    pub delete_token: String,
}

/// The relay doesn't know this guest, or it expired: get a new token.
pub const GUEST_REQUIRED: &str = "relay_guest_required";
pub const VERIFICATION_FAILED: &str = "relay_verification_failed";
/// The relay doesn't know this session, or it expired: sign in again.
pub const SESSION_REQUIRED: &str = "relay_session_required";
pub const DAILY_LIMIT: &str = "relay_daily_limit";

#[derive(Deserialize)]
struct NewGuest {
    guest_token: String,
}

/// What the relay answers to a valid login code.
#[derive(Deserialize, Debug, PartialEq, Eq)]
pub struct NewSession {
    pub session_token: String,
    pub email: String,
}

/// What an account has used, shown in the settings.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct AccountStatus {
    pub email: String,
    pub plan: String,
    pub captures_today: u32,
    pub daily_captures: u32,
    pub slots_used: u32,
    pub slots: u32,
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
        Ok("daily_limit") => DAILY_LIMIT.to_string(),
        Ok("service_busy") => "relay_service_busy".to_string(),
        Ok("too_large") => "relay_too_large".to_string(),
        Ok("guest_required") => GUEST_REQUIRED.to_string(),
        Ok("guest_banned") => "relay_guest_banned".to_string(),
        Ok("verification_failed") => VERIFICATION_FAILED.to_string(),
        Ok("verification_unavailable") => "relay_service_busy".to_string(),
        Ok("session_required") => SESSION_REQUIRED.to_string(),
        Ok("account_banned") => "relay_account_banned".to_string(),
        Ok("invalid_email") => "relay_invalid_email".to_string(),
        Ok("invalid_code") => "relay_invalid_code".to_string(),
        Ok("google_refused") => "relay_google_refused".to_string(),
        Ok("mail_unavailable") => "relay_mail_unavailable".to_string(),
        _ => format!("Snap2Link hosting answered {status}"),
    }
}

/// The body of a successful answer, or the code of a refusal.
async fn body_of(response: Result<reqwest::Response, reqwest::Error>) -> Result<String, String> {
    let response = response.map_err(|_| "relay_unreachable".to_string())?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| "relay_unreachable".to_string())?;
    if status.is_success() {
        Ok(body)
    } else {
        Err(error_code(&body, status))
    }
}

/// Turns a passed Turnstile challenge into a guest token.
pub async fn create_guest(base: &str, turnstile: &str) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/guests"))
        .json(&serde_json::json!({ "turnstile": turnstile }))
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
    let guest: NewGuest =
        serde_json::from_str(&body).map_err(|e| format!("invalid relay response: {e}"))?;
    Ok(guest.guest_token)
}

/// Sends a login code to `email`, in `language` when the relay knows it.
pub async fn request_code(
    base: &str,
    guest: &str,
    email: &str,
    language: &str,
) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/login/code"))
        .bearer_auth(guest)
        .json(&serde_json::json!({ "email": email, "language": language }))
        .send()
        .await;
    body_of(response).await.map(|_| ())
}

/// Turns a login code into a session, creating the account the first time.
pub async fn verify_code(
    base: &str,
    guest: &str,
    email: &str,
    code: &str,
) -> Result<NewSession, String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/login/verify"))
        .bearer_auth(guest)
        .json(&serde_json::json!({ "email": email, "code": code }))
        .send()
        .await;
    let body = body_of(response).await?;
    serde_json::from_str(&body).map_err(|e| format!("invalid relay response: {e}"))
}

/// Turns a Google ID token into a session, creating the account the first time.
pub async fn sign_in_with_google(
    base: &str,
    guest: &str,
    id_token: &str,
) -> Result<NewSession, String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/login/google"))
        .bearer_auth(guest)
        .json(&serde_json::json!({ "id_token": id_token }))
        .send()
        .await;
    let body = body_of(response).await?;
    serde_json::from_str(&body).map_err(|e| format!("invalid relay response: {e}"))
}

pub async fn account(base: &str, session: &str) -> Result<AccountStatus, String> {
    let response = reqwest::Client::new()
        .get(endpoint(base, "/v1/me"))
        .bearer_auth(session)
        .send()
        .await;
    let body = body_of(response).await?;
    serde_json::from_str(&body).map_err(|e| format!("invalid relay response: {e}"))
}

pub async fn sign_out(base: &str, session: &str) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/logout"))
        .bearer_auth(session)
        .send()
        .await;
    body_of(response).await.map(|_| ())
}

pub async fn delete_account(base: &str, session: &str) -> Result<(), String> {
    let response = reqwest::Client::new()
        .delete(endpoint(base, "/v1/me"))
        .bearer_auth(session)
        .send()
        .await;
    body_of(response).await.map(|_| ())
}

pub async fn upload(base: &str, guest: &str, bytes: Vec<u8>) -> Result<Created, String> {
    let response = reqwest::Client::new()
        .post(endpoint(base, "/v1/captures"))
        .bearer_auth(guest)
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
            .match_header("authorization", "Bearer guest")
            .match_body(vec![1u8, 2, 3])
            .with_status(201)
            .with_body(created(&server.url()))
            .create_async()
            .await;

        let result = upload(&server.url(), "guest", vec![1, 2, 3]).await.unwrap();

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
        assert!(upload(&base, "guest", vec![1]).await.is_ok());
    }

    #[tokio::test]
    async fn relay_refusals_become_codes_the_overlay_knows() {
        for (status, error, code) in [
            (429, "daily_limit", "relay_daily_limit"),
            (503, "service_busy", "relay_service_busy"),
            (413, "too_large", "relay_too_large"),
            (401, "guest_required", GUEST_REQUIRED),
            (403, "guest_banned", "relay_guest_banned"),
        ] {
            let mut server = mockito::Server::new_async().await;
            server
                .mock("POST", "/v1/captures")
                .with_status(status)
                .with_body(format!(r#"{{"error":"{error}"}}"#))
                .create_async()
                .await;

            assert_eq!(upload(&server.url(), "guest", vec![1]).await.unwrap_err(), code);
        }
    }

    #[tokio::test]
    async fn request_code_sends_the_address_and_the_language() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/login/code")
            .match_header("authorization", "Bearer guest")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "email": "someone@example.com",
                "language": "fr",
            })))
            .with_status(202)
            .with_body(r#"{"expires_at":"x"}"#)
            .create_async()
            .await;

        request_code(&server.url(), "guest", "someone@example.com", "fr")
            .await
            .unwrap();
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn verify_code_returns_the_session() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/v1/login/verify")
            .match_header("authorization", "Bearer guest")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "email": "someone@example.com",
                "code": "123456",
            })))
            .with_status(200)
            .with_body(
                r#"{"session_token":"s_x","expires_at":"x","email":"someone@example.com","plan":"free"}"#,
            )
            .create_async()
            .await;

        let session = verify_code(&server.url(), "guest", "someone@example.com", "123456")
            .await
            .unwrap();
        assert_eq!(
            session,
            NewSession {
                session_token: "s_x".to_string(),
                email: "someone@example.com".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn sign_in_with_google_sends_the_token_and_returns_the_session() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/v1/login/google")
            .match_header("authorization", "Bearer guest")
            .match_body(mockito::Matcher::Json(serde_json::json!({ "id_token": "a.b.c" })))
            .with_status(200)
            .with_body(r#"{"session_token":"s_x","expires_at":"x","email":"a@b.co","plan":"free"}"#)
            .create_async()
            .await;

        let session = sign_in_with_google(&server.url(), "guest", "a.b.c").await.unwrap();
        assert_eq!(session.session_token, "s_x");
        assert_eq!(session.email, "a@b.co");
    }

    #[tokio::test]
    async fn a_refused_google_token_has_its_own_code() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/v1/login/google")
            .with_status(403)
            .with_body(r#"{"error":"google_refused"}"#)
            .create_async()
            .await;

        let error = sign_in_with_google(&server.url(), "guest", "a.b.c").await;
        assert_eq!(error.unwrap_err(), "relay_google_refused");
    }

    #[tokio::test]
    async fn account_reads_what_the_relay_counted() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("GET", "/v1/me")
            .match_header("authorization", "Bearer s_x")
            .with_status(200)
            .with_body(
                r#"{"email":"a@b.co","plan":"free","captures_today":12,"daily_captures":20,"slots_used":4,"slots":6}"#,
            )
            .create_async()
            .await;

        let status = account(&server.url(), "s_x").await.unwrap();
        assert_eq!(status.captures_today, 12);
        assert_eq!(status.slots, 6);
    }

    #[tokio::test]
    async fn account_refusals_become_codes_the_settings_know() {
        for (status, relay_code, code) in [
            (400, "invalid_email", "relay_invalid_email"),
            (400, "invalid_code", "relay_invalid_code"),
            (401, "session_required", SESSION_REQUIRED),
            (403, "account_banned", "relay_account_banned"),
            (503, "mail_unavailable", "relay_mail_unavailable"),
        ] {
            let mut server = mockito::Server::new_async().await;
            server
                .mock("POST", "/v1/login/code")
                .with_status(status)
                .with_body(format!(r#"{{"error":"{relay_code}"}}"#))
                .create_async()
                .await;

            let error = request_code(&server.url(), "guest", "a@b.co", "en").await;
            assert_eq!(error.unwrap_err(), code);
        }
    }

    #[tokio::test]
    async fn sign_out_and_delete_send_the_session() {
        let mut server = mockito::Server::new_async().await;
        let logout = server
            .mock("POST", "/v1/logout")
            .match_header("authorization", "Bearer s_x")
            .with_status(204)
            .create_async()
            .await;
        let deleted = server
            .mock("DELETE", "/v1/me")
            .match_header("authorization", "Bearer s_x")
            .with_status(204)
            .create_async()
            .await;

        sign_out(&server.url(), "s_x").await.unwrap();
        delete_account(&server.url(), "s_x").await.unwrap();

        logout.assert_async().await;
        deleted.assert_async().await;
    }

    #[tokio::test]
    async fn create_guest_sends_the_challenge_and_returns_the_token() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/guests")
            .match_body(mockito::Matcher::Json(serde_json::json!({ "turnstile": "solved" })))
            .with_status(201)
            .with_body(r#"{"guest_token":"tok","expires_at":"x"}"#)
            .create_async()
            .await;

        assert_eq!(create_guest(&server.url(), "solved").await.unwrap(), "tok");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn create_guest_refusals_become_codes_the_overlay_knows() {
        for (status, error, code) in [
            (403, "verification_failed", VERIFICATION_FAILED),
            (503, "verification_unavailable", "relay_service_busy"),
            (429, "daily_limit", "relay_daily_limit"),
        ] {
            let mut server = mockito::Server::new_async().await;
            server
                .mock("POST", "/v1/guests")
                .with_status(status)
                .with_body(format!(r#"{{"error":"{error}"}}"#))
                .create_async()
                .await;

            assert_eq!(create_guest(&server.url(), "x").await.unwrap_err(), code);
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

        let error = upload(&server.url(), "guest", vec![1]).await.unwrap_err();
        assert!(error.contains("500"), "{error}");
    }

    #[tokio::test]
    async fn an_unreachable_relay_has_its_own_code() {
        let error = upload("http://127.0.0.1:1", "guest", vec![1]).await.unwrap_err();
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

        let error = upload(&server.url(), "guest", vec![1]).await.unwrap_err();
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
