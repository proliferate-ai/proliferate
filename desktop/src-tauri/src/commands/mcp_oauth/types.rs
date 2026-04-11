use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredOAuthBundle {
    pub issuer: String,
    pub resource: String,
    pub client_id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub scopes: Vec<String>,
    pub token_endpoint: Option<String>,
}

impl StoredOAuthBundle {
    pub fn apply_token_response(
        &self,
        response: &OAuthTokenResponse,
        token_endpoint: Option<String>,
    ) -> Self {
        Self {
            issuer: self.issuer.clone(),
            resource: self.resource.clone(),
            client_id: self.client_id.clone(),
            access_token: response.access_token.clone(),
            refresh_token: response
                .refresh_token
                .clone()
                .or_else(|| self.refresh_token.clone()),
            expires_at: response
                .expires_in
                .map(|seconds| (Utc::now() + Duration::seconds(seconds)).to_rfc3339()),
            scopes: if response.scope.is_some() {
                split_scope(response.scope.clone())
            } else {
                self.scopes.clone()
            },
            token_endpoint: token_endpoint.or_else(|| self.token_endpoint.clone()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectOAuthConnectorInput {
    pub connection_id: String,
    pub server_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetValidOAuthAccessTokenInput {
    pub connection_id: String,
    pub min_remaining_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorOAuthBundleState {
    pub has_bundle: bool,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectOAuthConnectorResult {
    Completed,
    Canceled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ValidOAuthAccessTokenResult {
    Ready {
        access_token: String,
        expires_at: Option<String>,
    },
    Missing,
    NeedsReconnect,
}

#[derive(Debug, Deserialize)]
pub struct ProtectedResourceMetadata {
    pub authorization_servers: Option<Vec<String>>,
    pub resource: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuthorizationServerMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub code_challenge_methods_supported: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct DynamicClientRegistrationResponse {
    pub client_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
}

#[derive(Debug)]
pub struct CallbackPayload {
    pub code: String,
    pub state: String,
}

#[derive(Debug)]
pub struct DiscoveryOutcome {
    pub prm: ProtectedResourceMetadata,
    pub challenged_scope: Option<String>,
}

#[derive(Debug)]
pub struct RefreshTokenOutcome {
    pub response: OAuthTokenResponse,
    pub token_endpoint: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OAuthCommandErrorKind {
    DiscoveryFailed,
    RegistrationFailed,
    ExchangeFailed,
    RefreshFailed,
    CallbackTimeout,
    StateMismatch,
    Unexpected,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCommandError {
    pub kind: OAuthCommandErrorKind,
    pub message: String,
    pub retryable: bool,
}

impl OAuthCommandError {
    pub fn from_kind(kind: OAuthCommandErrorKind) -> Self {
        let (message, retryable) = match kind {
            OAuthCommandErrorKind::DiscoveryFailed => (
                "Couldn't discover the OAuth configuration for this connector.",
                true,
            ),
            OAuthCommandErrorKind::RegistrationFailed => (
                "Couldn't register an OAuth client for this connector.",
                true,
            ),
            OAuthCommandErrorKind::ExchangeFailed => (
                "Couldn't finish the OAuth authorization for this connector.",
                true,
            ),
            OAuthCommandErrorKind::RefreshFailed => {
                ("Couldn't refresh the OAuth token for this connector.", true)
            }
            OAuthCommandErrorKind::CallbackTimeout => ("OAuth authorization timed out.", true),
            OAuthCommandErrorKind::StateMismatch => {
                ("OAuth authorization couldn't be verified.", false)
            }
            OAuthCommandErrorKind::Unexpected => {
                ("Couldn't complete OAuth for this connector.", false)
            }
        };
        Self {
            kind,
            message: message.to_string(),
            retryable,
        }
    }

    pub fn custom(
        kind: OAuthCommandErrorKind,
        message: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            retryable,
        }
    }
}

pub fn split_scope(scope: Option<String>) -> Vec<String> {
    scope
        .unwrap_or_default()
        .split_whitespace()
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .collect()
}

pub fn token_expiring_soon(expires_at: Option<&str>, min_remaining_seconds: i64) -> bool {
    let Some(expires_at) = expires_at else {
        return false;
    };
    let Ok(expires_at) = DateTime::parse_from_rfc3339(expires_at) else {
        return true;
    };
    expires_at.with_timezone(&Utc) <= Utc::now() + Duration::seconds(min_remaining_seconds)
}
