use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::process::Child;
use tokio::sync::Mutex;

mod auth;
mod credentials;
mod ports;
mod storage;

#[cfg(test)]
use auth::preserved_email_for_auth_error;
use auth::run_auth_flow;
#[cfg(test)]
use credentials::{access_token_is_fresh, validate_credential};
use credentials::{credential_status, verify_gmail_profile};
use ports::{lease_runtime_port, lease_setup_port, release_runtime_port, release_setup_port};
#[cfg(test)]
use ports::{port_leases, primary_runtime_port, runtime_port_lease_key, PortLeaseState};
use storage::{
    app_dir, credentials_dir, delete_local_data_blocking, local_workspace_env, normalize_email,
    reconcile_pending_records, resolve_command_path, runtime_attachments_dir, validate_id,
    validate_oauth_client_id, validate_oauth_client_secret,
};
#[cfg(test)]
use storage::{decode_credential_email, encode_credential_email};
const WORKSPACE_MCP_PACKAGE: &str = "workspace-mcp==1.20.1";
const GMAIL_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_PORT_BASE: u16 = 49_321;
const PORT_POOL_SIZE: u16 = 64;
const AUTH_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

type ChildHandle = Arc<Mutex<Child>>;

static SETUP_CHILDREN: OnceLock<Mutex<HashMap<String, ChildHandle>>> = OnceLock::new();
static CANCELLED_SETUPS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn setup_children() -> &'static Mutex<HashMap<String, ChildHandle>> {
    SETUP_CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_setups() -> &'static Mutex<HashSet<String>> {
    CANCELLED_SETUPS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalMcpOAuthCode {
    UvxMissing,
    PortUnavailable,
    AuthUrlMissing,
    Timeout,
    Cancelled,
    CredentialMissing,
    CredentialInvalid,
    AccountMismatch,
    ProcessFailed,
    CleanupFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMcpOAuthError {
    code: LocalMcpOAuthCode,
}

impl LocalMcpOAuthError {
    fn new(code: LocalMcpOAuthCode) -> Self {
        Self { code }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCompletedResponse {
    status: &'static str,
    user_google_email: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CredentialStatus {
    Ready,
    NotReady { code: LocalMcpOAuthCode },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LocalDataDeleteResult {
    Deleted,
    RetryableFailure { code: LocalMcpOAuthCode },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPair {
    name: String,
    value: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RuntimeEnvResult {
    Ready { env: Vec<EnvPair> },
    NotReady { code: LocalMcpOAuthCode },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAuthInput {
    setup_id: String,
    user_google_email: Option<String>,
    oauth_client_id: String,
    oauth_client_secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupIdInput {
    setup_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatusInput {
    user_google_email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLocalDataInput {
    connection_id: Option<String>,
    setup_id: Option<String>,
    user_google_email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailConnectionInput {
    connection_id: String,
    user_google_email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcilePendingInput {
    gmail_connections: Vec<GmailConnectionInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnvInput {
    connection_id: String,
    user_google_email: String,
    launch_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnvReleaseInput {
    connection_id: String,
    launch_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResponse {
    ok: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSetupRecord {
    setup_id: String,
    user_google_email: Option<String>,
    created_at: String,
}

#[derive(Debug)]
struct LocalCredential {
    token: Option<String>,
    refresh_token: Option<String>,
    token_uri: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
    scopes: Vec<String>,
    expiry: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct RecentCredential {
    user_google_email: String,
    credential: LocalCredential,
}

#[tauri::command]
pub async fn start_google_workspace_mcp_auth(
    input: StartAuthInput,
) -> Result<AuthCompletedResponse, LocalMcpOAuthError> {
    let setup_id = validate_id(&input.setup_id)
        .map_err(|_| LocalMcpOAuthError::new(LocalMcpOAuthCode::ProcessFailed))?;
    let expected_email = input
        .user_google_email
        .as_deref()
        .map(normalize_email)
        .transpose()
        .map_err(|_| LocalMcpOAuthError::new(LocalMcpOAuthCode::CredentialInvalid))?;
    let oauth_client_id = validate_oauth_client_id(&input.oauth_client_id)
        .map_err(|_| LocalMcpOAuthError::new(LocalMcpOAuthCode::CredentialInvalid))?;
    let oauth_client_secret = validate_oauth_client_secret(&input.oauth_client_secret)
        .map_err(|_| LocalMcpOAuthError::new(LocalMcpOAuthCode::CredentialInvalid))?;
    if take_cancelled_setup(&setup_id).await {
        return Err(LocalMcpOAuthError::new(LocalMcpOAuthCode::Cancelled));
    }

    let uvx_path = resolve_command_path("uvx")
        .map_err(|_| LocalMcpOAuthError::new(LocalMcpOAuthCode::UvxMissing))?;
    let port = lease_setup_port()
        .await
        .map_err(|code| LocalMcpOAuthError::new(code))?;
    let run_result = run_auth_flow(
        setup_id.clone(),
        expected_email,
        oauth_client_id,
        oauth_client_secret,
        uvx_path,
        port,
    )
    .await;
    release_setup_port(port).await;

    match run_result {
        Ok(user_google_email) => Ok(AuthCompletedResponse {
            status: "completed",
            user_google_email,
        }),
        Err(code) => Err(LocalMcpOAuthError::new(code)),
    }
}

async fn take_cancelled_setup(setup_id: &str) -> bool {
    cancelled_setups().lock().await.remove(setup_id)
}

#[tauri::command]
pub async fn cancel_google_workspace_mcp_auth(input: SetupIdInput) -> Result<OkResponse, String> {
    let setup_id = validate_id(&input.setup_id).map_err(|_| "invalid_setup_id".to_string())?;
    cancelled_setups().lock().await.insert(setup_id.clone());
    if let Some(child) = setup_children().lock().await.remove(&setup_id) {
        let mut guard = child.lock().await;
        let _ = guard.start_kill();
    }
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub async fn get_google_workspace_mcp_credential_status(
    input: CredentialStatusInput,
) -> Result<CredentialStatus, String> {
    let email =
        normalize_email(&input.user_google_email).map_err(|_| "invalid_email".to_string())?;
    Ok(credential_status(&email).await)
}

#[tauri::command]
pub async fn delete_google_workspace_mcp_local_data(
    input: DeleteLocalDataInput,
) -> Result<LocalDataDeleteResult, String> {
    let email =
        normalize_email(&input.user_google_email).map_err(|_| "invalid_email".to_string())?;
    let connection_id = match input.connection_id {
        Some(value) => Some(validate_id(&value).map_err(|_| "invalid_connection_id".to_string())?),
        None => None,
    };
    let setup_id = match input.setup_id {
        Some(value) => Some(validate_id(&value).map_err(|_| "invalid_setup_id".to_string())?),
        None => None,
    };
    if connection_id.is_some() == setup_id.is_some() {
        return Err("expected_one_cleanup_target".to_string());
    }

    let result = tokio::task::spawn_blocking(move || {
        delete_local_data_blocking(connection_id.as_deref(), setup_id.as_deref(), &email)
    })
    .await
    .map_err(|_| "cleanup_task_failed".to_string())?;

    Ok(match result {
        Ok(()) => LocalDataDeleteResult::Deleted,
        Err(()) => LocalDataDeleteResult::RetryableFailure {
            code: LocalMcpOAuthCode::CleanupFailed,
        },
    })
}

#[tauri::command]
pub async fn reconcile_google_workspace_mcp_pending_setups(
    input: ReconcilePendingInput,
) -> Result<OkResponse, String> {
    let active_emails: HashSet<String> = input
        .gmail_connections
        .into_iter()
        .filter_map(|item| {
            let _ = validate_id(&item.connection_id).ok()?;
            normalize_email(&item.user_google_email).ok()
        })
        .collect();
    tokio::task::spawn_blocking(move || {
        let _ = reconcile_pending_records(&active_emails);
    })
    .await
    .map_err(|_| "reconcile_task_failed".to_string())?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub async fn resolve_google_workspace_mcp_runtime_env(
    input: RuntimeEnvInput,
) -> Result<RuntimeEnvResult, String> {
    let connection_id =
        validate_id(&input.connection_id).map_err(|_| "invalid_connection_id".to_string())?;
    let launch_id = validate_id(&input.launch_id).map_err(|_| "invalid_launch_id".to_string())?;
    let email =
        normalize_email(&input.user_google_email).map_err(|_| "invalid_email".to_string())?;
    match credential_status(&email).await {
        CredentialStatus::Ready => {}
        CredentialStatus::NotReady { code } => return Ok(RuntimeEnvResult::NotReady { code }),
    }
    if let Err(code) = verify_gmail_profile(&email).await {
        return Ok(RuntimeEnvResult::NotReady { code });
    }
    let app_dir = app_dir().map_err(|_| "app_dir_unavailable".to_string())?;
    let credentials_dir = credentials_dir(&app_dir);
    let attachments_dir = runtime_attachments_dir(&app_dir, &connection_id);
    let port = match lease_runtime_port(&launch_id, &connection_id).await {
        Ok(port) => port,
        Err(code) => return Ok(RuntimeEnvResult::NotReady { code }),
    };
    Ok(RuntimeEnvResult::Ready {
        env: local_workspace_env(credentials_dir, attachments_dir, port, &email),
    })
}

#[tauri::command]
pub async fn release_google_workspace_mcp_runtime_env(
    input: RuntimeEnvReleaseInput,
) -> Result<OkResponse, String> {
    let connection_id =
        validate_id(&input.connection_id).map_err(|_| "invalid_connection_id".to_string())?;
    let launch_id = validate_id(&input.launch_id).map_err(|_| "invalid_launch_id".to_string())?;
    release_runtime_port(&launch_id, &connection_id).await;
    Ok(OkResponse { ok: true })
}

#[cfg(test)]
mod tests;
