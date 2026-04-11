use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use getrandom::getrandom;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex, OwnedMutexGuard};
use url::Url;

use super::discovery::discover_authorization_server_metadata;
use super::types::{
    AuthorizationServerMetadata, CallbackPayload, DynamicClientRegistrationResponse,
    OAuthTokenResponse, RefreshTokenOutcome, StoredOAuthBundle,
};

const CALLBACK_TIMEOUT_SECONDS: u64 = 300;

pub enum CallbackWaitError {
    Canceled,
    TimedOut,
    Failed(String),
}

pub enum RefreshTokenError {
    InvalidGrant,
    Failed(String),
}

fn oauth_bundle_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn oauth_connect_cancellations() -> &'static Mutex<HashMap<String, oneshot::Sender<()>>> {
    static CANCELLATIONS: OnceLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = OnceLock::new();
    CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn lock_bundle(connection_id: &str) -> OwnedMutexGuard<()> {
    let lock = {
        let mut locks = oauth_bundle_locks().lock().await;
        locks
            .entry(connection_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    lock.lock_owned().await
}

pub async fn register_connect_cancellation(
    connection_id: &str,
) -> Result<oneshot::Receiver<()>, String> {
    let (sender, receiver) = oneshot::channel();
    let mut cancellations = oauth_connect_cancellations().lock().await;
    if cancellations.contains_key(connection_id) {
        return Err("An OAuth flow is already in progress for this connector.".to_string());
    }
    cancellations.insert(connection_id.to_string(), sender);
    Ok(receiver)
}

pub async fn clear_connect_cancellation(connection_id: &str) {
    oauth_connect_cancellations()
        .lock()
        .await
        .remove(connection_id);
}

pub async fn cancel_connect(connection_id: String) {
    if let Some(cancel) = oauth_connect_cancellations()
        .lock()
        .await
        .remove(&connection_id)
    {
        let _ = cancel.send(());
    }
}

pub fn http_client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|error| error.to_string())
        })
        .clone()
}

pub fn encode_random(size: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; size];
    getrandom(&mut bytes).map_err(|error| error.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub async fn register_client(
    client: &reqwest::Client,
    metadata: &AuthorizationServerMetadata,
    redirect_uri: &str,
) -> Result<String, String> {
    let registration_endpoint = metadata.registration_endpoint.as_ref().ok_or_else(|| {
        "This OAuth provider doesn't support dynamic client registration.".to_string()
    })?;
    let response = client
        .post(registration_endpoint)
        .json(&serde_json::json!({
            "client_name": "Proliferate Desktop",
            "application_type": "native",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }))
        .send()
        .await
        .map_err(|error| format!("Couldn't register an OAuth client: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Couldn't register an OAuth client: {error}"))?
        .json::<DynamicClientRegistrationResponse>()
        .await
        .map_err(|error| format!("Invalid client registration response: {error}"))?;
    Ok(response.client_id)
}

pub async fn receive_callback(
    listener: TcpListener,
    cancel_rx: oneshot::Receiver<()>,
) -> Result<CallbackPayload, CallbackWaitError> {
    let callback_future = async move {
        let (mut stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let mut buffer = [0u8; 4096];
        let bytes_read = stream
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        let request = String::from_utf8_lossy(&buffer[..bytes_read]);
        let request_line = request.lines().next().unwrap_or_default();
        let path = request_line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| "OAuth callback was missing a request path.".to_string())?;
        let callback_url =
            Url::parse(&format!("http://127.0.0.1{path}")).map_err(|error| error.to_string())?;
        let status_text = if callback_url.query_pairs().any(|(key, _)| key == "error") {
            "Authorization failed. You can close this tab."
        } else {
            "Authorization complete. You can close this tab."
        };
        let body = format!(
            "<html><body style=\"font-family: sans-serif; padding: 24px;\">{status_text}</body></html>"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let params = callback_url
            .query_pairs()
            .into_owned()
            .collect::<HashMap<_, _>>();
        if let Some(error) = params.get("error") {
            return Err(format!(
                "OAuth authorization failed: {}",
                params
                    .get("error_description")
                    .cloned()
                    .unwrap_or_else(|| error.clone())
            ));
        }
        Ok(CallbackPayload {
            code: params
                .get("code")
                .cloned()
                .ok_or_else(|| "OAuth callback was missing a code.".to_string())?,
            state: params
                .get("state")
                .cloned()
                .ok_or_else(|| "OAuth callback was missing state.".to_string())?,
        })
    };
    tokio::select! {
        callback = tokio::time::timeout(
            std::time::Duration::from_secs(CALLBACK_TIMEOUT_SECONDS),
            callback_future,
        ) => callback
            .map_err(|_| CallbackWaitError::TimedOut)?
            .map_err(CallbackWaitError::Failed),
        _ = cancel_rx => Err(CallbackWaitError::Canceled),
    }
}

pub async fn exchange_token(
    client: &reqwest::Client,
    metadata: &AuthorizationServerMetadata,
    client_id: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
    resource: &str,
) -> Result<OAuthTokenResponse, String> {
    let response = client
        .post(&metadata.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code".to_string()),
            ("client_id", client_id.to_string()),
            ("code", code.to_string()),
            ("code_verifier", code_verifier.to_string()),
            ("redirect_uri", redirect_uri.to_string()),
            ("resource", resource.to_string()),
        ])
        .send()
        .await
        .map_err(|error| format!("Couldn't exchange the OAuth code for tokens: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Couldn't exchange the OAuth code for tokens: {error}"))?
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|error| format!("Invalid token response: {error}"))?;
    Ok(response)
}

pub async fn refresh_token(
    client: &reqwest::Client,
    bundle: &StoredOAuthBundle,
) -> Result<RefreshTokenOutcome, RefreshTokenError> {
    let token_endpoint = if let Some(token_endpoint) = bundle.token_endpoint.clone() {
        token_endpoint
    } else {
        discover_authorization_server_metadata(client, &bundle.issuer)
            .await
            .map_err(RefreshTokenError::Failed)?
            .token_endpoint
    };

    let refresh_token = bundle.refresh_token.as_ref().ok_or_else(|| {
        RefreshTokenError::Failed("This connector doesn't have a refresh token.".to_string())
    })?;
    let response = client
        .post(&token_endpoint)
        .form(&[
            ("grant_type", "refresh_token".to_string()),
            ("client_id", bundle.client_id.clone()),
            ("refresh_token", refresh_token.clone()),
            ("resource", bundle.resource.clone()),
        ])
        .send()
        .await
        .map_err(|error| {
            RefreshTokenError::Failed(format!("Couldn't refresh the OAuth token: {error}"))
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::BAD_REQUEST {
        let text = response.text().await.unwrap_or_default();
        if text.contains("invalid_grant") {
            return Err(RefreshTokenError::InvalidGrant);
        }
        return Err(RefreshTokenError::Failed(format!(
            "Couldn't refresh the OAuth token: HTTP {status}"
        )));
    }

    let response = response.error_for_status().map_err(|error| {
        RefreshTokenError::Failed(format!("Couldn't refresh the OAuth token: {error}"))
    })?;
    let response = response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|error| RefreshTokenError::Failed(format!("Invalid refresh response: {error}")))?;
    Ok(RefreshTokenOutcome {
        response,
        token_endpoint,
    })
}
