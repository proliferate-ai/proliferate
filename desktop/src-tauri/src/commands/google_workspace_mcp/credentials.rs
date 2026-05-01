use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::Value;

use super::storage::{app_dir, credential_file_path_for_email, credentials_dir, normalize_email};
use super::{
    CredentialStatus, LocalCredential, LocalMcpOAuthCode, GMAIL_READONLY_SCOPE, GOOGLE_TOKEN_URI,
};
pub(super) async fn credential_status(email: &str) -> CredentialStatus {
    match tokio::task::spawn_blocking({
        let email = email.to_string();
        move || read_local_credential(&email)
    })
    .await
    {
        Ok(Ok(credential)) => {
            if validate_credential(&credential).is_ok() {
                CredentialStatus::Ready
            } else {
                CredentialStatus::NotReady {
                    code: LocalMcpOAuthCode::CredentialInvalid,
                }
            }
        }
        Ok(Err(LocalMcpOAuthCode::CredentialMissing)) => CredentialStatus::NotReady {
            code: LocalMcpOAuthCode::CredentialMissing,
        },
        _ => CredentialStatus::NotReady {
            code: LocalMcpOAuthCode::CredentialInvalid,
        },
    }
}

fn read_local_credential(email: &str) -> Result<LocalCredential, LocalMcpOAuthCode> {
    let app_dir = app_dir().map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    let Some(path) = credential_file_path_for_email(&credentials_dir(&app_dir), email) else {
        return Err(LocalMcpOAuthCode::CredentialMissing);
    };
    match read_credential_file(&path) {
        Ok(credential) => Ok(credential),
        Err(LocalMcpOAuthCode::CredentialMissing) => Err(LocalMcpOAuthCode::CredentialMissing),
        Err(_) => Err(LocalMcpOAuthCode::CredentialInvalid),
    }
}

pub(super) fn read_credential_file(path: &Path) -> Result<LocalCredential, LocalMcpOAuthCode> {
    let raw = std::fs::read_to_string(path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => LocalMcpOAuthCode::CredentialMissing,
        _ => LocalMcpOAuthCode::CredentialInvalid,
    })?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    let scopes = parse_scopes(value.get("scopes")).ok_or(LocalMcpOAuthCode::CredentialInvalid)?;
    Ok(LocalCredential {
        token: value
            .get("token")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty()),
        refresh_token: value
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty()),
        token_uri: value
            .get("token_uri")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty()),
        client_id: value
            .get("client_id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty()),
        client_secret: value
            .get("client_secret")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty()),
        scopes,
        expiry: parse_expiry(value.get("expiry")),
    })
}

pub(super) fn validate_credential(credential: &LocalCredential) -> Result<(), ()> {
    let scopes: HashSet<&str> = credential.scopes.iter().map(String::as_str).collect();
    if !scopes.contains(GMAIL_READONLY_SCOPE) {
        return Err(());
    }
    for scope in &credential.scopes {
        if scope == GMAIL_READONLY_SCOPE
            || scope == "openid"
            || scope == "email"
            || scope == "profile"
            || scope == "https://www.googleapis.com/auth/userinfo.email"
            || scope == "https://www.googleapis.com/auth/userinfo.profile"
        {
            continue;
        }
        return Err(());
    }
    if credential.refresh_token.is_some() {
        return Ok(());
    }
    if credential.token.is_some() {
        if let Some(expiry) = credential.expiry {
            return if expiry > Utc::now() + chrono::Duration::minutes(5) {
                Ok(())
            } else {
                Err(())
            };
        }
    }
    Err(())
}

pub(super) async fn verify_gmail_profile(email: &str) -> Result<(), LocalMcpOAuthCode> {
    let credential = tokio::task::spawn_blocking({
        let email = email.to_string();
        move || read_local_credential(&email)
    })
    .await
    .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)??;
    let actual = gmail_profile_email_for_credential(&credential).await?;
    if actual == email {
        Ok(())
    } else {
        Err(LocalMcpOAuthCode::AccountMismatch)
    }
}

async fn gmail_profile_email_for_credential(
    credential: &LocalCredential,
) -> Result<String, LocalMcpOAuthCode> {
    let token = profile_access_token(credential).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    let response = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    if !response.status().is_success() {
        return Err(LocalMcpOAuthCode::CredentialInvalid);
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    let actual = payload
        .get("emailAddress")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_lowercase());
    actual
        .filter(|value| normalize_email(value).is_ok())
        .ok_or(LocalMcpOAuthCode::CredentialInvalid)
}

async fn profile_access_token(credential: &LocalCredential) -> Result<String, LocalMcpOAuthCode> {
    if let Some(token) = credential
        .token
        .as_deref()
        .filter(|_| access_token_is_fresh(credential))
    {
        return Ok(token.to_string());
    }
    refresh_access_token(credential).await
}

pub(super) fn access_token_is_fresh(credential: &LocalCredential) -> bool {
    credential
        .expiry
        .map(|expiry| expiry > Utc::now() + chrono::Duration::minutes(5))
        .unwrap_or(false)
}

async fn refresh_access_token(credential: &LocalCredential) -> Result<String, LocalMcpOAuthCode> {
    let refresh_token = credential
        .refresh_token
        .as_deref()
        .ok_or(LocalMcpOAuthCode::CredentialInvalid)?;
    let client_id = credential
        .client_id
        .as_deref()
        .ok_or(LocalMcpOAuthCode::CredentialInvalid)?;
    let client_secret = credential
        .client_secret
        .as_deref()
        .ok_or(LocalMcpOAuthCode::CredentialInvalid)?;
    let token_uri = credential.token_uri.as_deref().unwrap_or(GOOGLE_TOKEN_URI);
    if token_uri != GOOGLE_TOKEN_URI {
        return Err(LocalMcpOAuthCode::CredentialInvalid);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    let response = client
        .post(token_uri)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    if !response.status().is_success() {
        return Err(LocalMcpOAuthCode::CredentialInvalid);
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    payload
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or(LocalMcpOAuthCode::CredentialInvalid)
}

fn parse_scopes(value: Option<&Value>) -> Option<Vec<String>> {
    match value? {
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect(),
        ),
        Value::String(text) => Some(
            text.split_whitespace()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect(),
        ),
        _ => None,
    }
}

fn parse_expiry(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let text = value?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(parsed) = DateTime::parse_from_rfc3339(text) {
        return Some(parsed.with_timezone(&Utc));
    }
    if let Ok(parsed) = NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(parsed, Utc));
    }
    None
}
