mod bundle;
mod discovery;
mod flow;
mod types;

use chrono::{Duration, Utc};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::net::TcpListener;
use types::{
    ConnectOAuthConnectorInput, ConnectOAuthConnectorResult, ConnectorOAuthBundleState,
    OAuthCommandError, OAuthCommandErrorKind, StoredOAuthBundle, ValidOAuthAccessTokenResult,
};
use url::Url;

use self::bundle::{delete_oauth_bundle, read_oauth_bundle, write_oauth_bundle};
use self::discovery::{
    discover_authorization_server_metadata, discover_protected_resource_metadata,
    normalize_resource_url,
};
use self::flow::{
    cancel_connect, clear_connect_cancellation, code_challenge, encode_random, exchange_token,
    http_client, lock_bundle, receive_callback, refresh_token, register_client,
    register_connect_cancellation, CallbackWaitError, RefreshTokenError,
};

fn scrubbed_error(kind: OAuthCommandErrorKind, detail: impl AsRef<str>) -> OAuthCommandError {
    tracing::warn!(kind = ?kind, detail = %detail.as_ref(), "MCP OAuth command failed");
    OAuthCommandError::from_kind(kind)
}

#[tauri::command]
pub async fn connect_oauth_connector(
    app: AppHandle,
    input: ConnectOAuthConnectorInput,
) -> Result<ConnectOAuthConnectorResult, OAuthCommandError> {
    let _guard = lock_bundle(&input.connection_id).await;
    let cancel_rx = register_connect_cancellation(&input.connection_id)
        .await
        .map_err(|detail| {
            tracing::warn!(connection_id = %input.connection_id, detail = %detail, "MCP OAuth connect already in progress");
            OAuthCommandError::custom(
                OAuthCommandErrorKind::Unexpected,
                "Another OAuth flow is already in progress for this connector.",
                false,
            )
        })?;

    let result = async {
        let client = http_client()
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
        let discovery = discover_protected_resource_metadata(&client, &input.server_url)
            .await
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::DiscoveryFailed, detail))?;
        let issuer = discovery
            .prm
            .authorization_servers
            .as_ref()
            .and_then(|servers| servers.first())
            .cloned()
            .ok_or_else(|| {
                scrubbed_error(
                    OAuthCommandErrorKind::DiscoveryFailed,
                    "Protected-resource metadata did not include an authorization server.",
                )
            })?;
        let auth_metadata = discover_authorization_server_metadata(&client, &issuer)
            .await
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::DiscoveryFailed, detail))?;
        let resource = normalize_resource_url(
            discovery
                .prm
                .resource
                .as_deref()
                .unwrap_or(&input.server_url),
        )
        .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::DiscoveryFailed, detail))?;

        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|detail| {
            scrubbed_error(
                OAuthCommandErrorKind::Unexpected,
                format!("Couldn't start a local OAuth callback listener: {detail}"),
            )
        })?;
        let redirect_uri = format!(
            "http://127.0.0.1:{}/callback",
            listener
                .local_addr()
                .map_err(|detail| scrubbed_error(
                    OAuthCommandErrorKind::Unexpected,
                    detail.to_string()
                ))?
                .port()
        );

        let client_id = register_client(&client, &auth_metadata, &redirect_uri)
            .await
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::RegistrationFailed, detail))?;
        let state = encode_random(32)
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
        let verifier = encode_random(48)
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
        let challenge = code_challenge(&verifier);

        let mut authorize_url =
            Url::parse(&auth_metadata.authorization_endpoint).map_err(|detail| {
                scrubbed_error(
                    OAuthCommandErrorKind::DiscoveryFailed,
                    format!("Invalid authorization endpoint: {detail}"),
                )
            })?;
        {
            let mut params = authorize_url.query_pairs_mut();
            params.append_pair("response_type", "code");
            params.append_pair("client_id", &client_id);
            params.append_pair("redirect_uri", &redirect_uri);
            params.append_pair("code_challenge", &challenge);
            params.append_pair("code_challenge_method", "S256");
            params.append_pair("state", &state);
            params.append_pair("resource", &resource);
            if let Some(scope) = discovery.challenged_scope.as_deref() {
                params.append_pair("scope", scope);
            }
        }

        app.opener()
            .open_url(authorize_url.as_str(), None::<&str>)
            .map_err(|detail| {
                scrubbed_error(
                    OAuthCommandErrorKind::Unexpected,
                    format!("Couldn't open the OAuth authorization URL: {detail}"),
                )
            })?;

        let callback = match receive_callback(listener, cancel_rx).await {
            Ok(callback) => callback,
            Err(CallbackWaitError::Canceled) => return Ok(ConnectOAuthConnectorResult::Canceled),
            Err(CallbackWaitError::TimedOut) => {
                return Err(OAuthCommandError::from_kind(
                    OAuthCommandErrorKind::CallbackTimeout,
                ))
            }
            Err(CallbackWaitError::Failed(detail)) => {
                return Err(scrubbed_error(
                    OAuthCommandErrorKind::ExchangeFailed,
                    detail,
                ))
            }
        };
        if callback.state != state {
            return Err(scrubbed_error(
                OAuthCommandErrorKind::StateMismatch,
                "OAuth callback state didn't match the original request.",
            ));
        }

        let token = exchange_token(
            &client,
            &auth_metadata,
            &client_id,
            &callback.code,
            &verifier,
            &redirect_uri,
            &resource,
        )
        .await
        .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::ExchangeFailed, detail))?;

        let bundle = StoredOAuthBundle {
            issuer: auth_metadata.issuer,
            resource,
            client_id,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token
                .expires_in
                .map(|seconds| (Utc::now() + Duration::seconds(seconds)).to_rfc3339()),
            scopes: types::split_scope(token.scope),
            token_endpoint: Some(auth_metadata.token_endpoint),
        };
        write_oauth_bundle(&input.connection_id, &bundle)
            .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
        Ok(ConnectOAuthConnectorResult::Completed)
    }
    .await;

    clear_connect_cancellation(&input.connection_id).await;
    result
}

#[tauri::command]
pub async fn get_oauth_connector_bundle_state(
    connection_id: String,
) -> Result<ConnectorOAuthBundleState, OAuthCommandError> {
    let _guard = lock_bundle(&connection_id).await;
    let bundle = read_oauth_bundle(&connection_id)
        .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
    Ok(ConnectorOAuthBundleState {
        has_bundle: bundle.is_some(),
        expires_at: bundle.and_then(|record| record.expires_at),
    })
}

#[tauri::command]
pub async fn get_valid_oauth_access_token(
    input: types::GetValidOAuthAccessTokenInput,
) -> Result<ValidOAuthAccessTokenResult, OAuthCommandError> {
    let _guard = lock_bundle(&input.connection_id).await;
    let Some(bundle) = read_oauth_bundle(&input.connection_id)
        .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?
    else {
        return Ok(ValidOAuthAccessTokenResult::Missing);
    };

    if !types::token_expiring_soon(
        bundle.expires_at.as_deref(),
        input.min_remaining_seconds as i64,
    ) {
        return Ok(ValidOAuthAccessTokenResult::Ready {
            access_token: bundle.access_token,
            expires_at: bundle.expires_at,
        });
    }

    let client = http_client()
        .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
    match refresh_token(&client, &bundle).await {
        Ok(outcome) => {
            let next_bundle =
                bundle.apply_token_response(&outcome.response, Some(outcome.token_endpoint));
            if let Err(detail) = write_oauth_bundle(&input.connection_id, &next_bundle) {
                tracing::warn!(
                    connection_id = %input.connection_id,
                    error = %detail,
                    "Couldn't persist refreshed MCP OAuth bundle"
                );
                return Ok(ValidOAuthAccessTokenResult::NeedsReconnect);
            }
            Ok(ValidOAuthAccessTokenResult::Ready {
                access_token: next_bundle.access_token,
                expires_at: next_bundle.expires_at,
            })
        }
        Err(RefreshTokenError::InvalidGrant) => {
            delete_oauth_bundle(&input.connection_id)
                .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))?;
            Ok(ValidOAuthAccessTokenResult::NeedsReconnect)
        }
        Err(RefreshTokenError::Failed(detail)) => {
            Err(scrubbed_error(OAuthCommandErrorKind::RefreshFailed, detail))
        }
    }
}

#[tauri::command]
pub async fn delete_oauth_connector_bundle(connection_id: String) -> Result<(), OAuthCommandError> {
    let _guard = lock_bundle(&connection_id).await;
    delete_oauth_bundle(&connection_id)
        .map_err(|detail| scrubbed_error(OAuthCommandErrorKind::Unexpected, detail))
}

#[tauri::command]
pub async fn cancel_oauth_connector_connect(
    connection_id: String,
) -> Result<(), OAuthCommandError> {
    cancel_connect(connection_id).await;
    Ok(())
}
