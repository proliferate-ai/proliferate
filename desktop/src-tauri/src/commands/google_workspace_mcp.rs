use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

const WORKSPACE_MCP_PACKAGE: &str = "workspace-mcp==1.20.1";
const GMAIL_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_PORT_BASE: u16 = 49_321;
const PORT_POOL_SIZE: u16 = 64;
const AUTH_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

type ChildHandle = Arc<Mutex<Child>>;

static SETUP_PORT_LEASES: OnceLock<Mutex<HashSet<u16>>> = OnceLock::new();
static SETUP_CHILDREN: OnceLock<Mutex<HashMap<String, ChildHandle>>> = OnceLock::new();
static CANCELLED_SETUPS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn setup_port_leases() -> &'static Mutex<HashSet<u16>> {
    SETUP_PORT_LEASES.get_or_init(|| Mutex::new(HashSet::new()))
}

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
    let port = select_runtime_port(&launch_id, &connection_id);
    Ok(RuntimeEnvResult::Ready {
        env: local_workspace_env(credentials_dir, attachments_dir, port, &email),
    })
}

async fn run_auth_flow(
    setup_id: String,
    expected_email: Option<String>,
    oauth_client_id: String,
    oauth_client_secret: String,
    uvx_path: PathBuf,
    port: u16,
) -> Result<String, LocalMcpOAuthCode> {
    let app_dir = app_dir().map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    let credentials_dir = credentials_dir(&app_dir);
    let attachments_dir = pending_attachments_dir(&app_dir, &setup_id);
    if take_cancelled_setup(&setup_id).await {
        return Err(LocalMcpOAuthCode::Cancelled);
    }
    create_dir(&credentials_dir).map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    create_dir(&attachments_dir).map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    write_pending_record(&app_dir, &setup_id, expected_email.as_deref())
        .map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    let started_at = SystemTime::now();

    let mut command = Command::new(uvx_path);
    command
        .args([
            "--from",
            WORKSPACE_MCP_PACKAGE,
            "workspace-mcp",
            "--transport",
            "stdio",
            "--permissions",
            "gmail:readonly",
            "--tool-tier",
            "complete",
        ])
        .env("GOOGLE_OAUTH_CLIENT_ID", oauth_client_id)
        .env("GOOGLE_OAUTH_CLIENT_SECRET", oauth_client_secret)
        .env("OAUTHLIB_INSECURE_TRANSPORT", "1")
        .env("WORKSPACE_MCP_CREDENTIALS_DIR", &credentials_dir)
        .env("GOOGLE_MCP_CREDENTIALS_DIR", &credentials_dir)
        .env("WORKSPACE_ATTACHMENT_DIR", &attachments_dir)
        .env("WORKSPACE_MCP_BASE_URI", "http://127.0.0.1")
        .env("WORKSPACE_MCP_PORT", port.to_string())
        .env(
            "GOOGLE_OAUTH_REDIRECT_URI",
            format!("http://127.0.0.1:{port}/oauth2callback"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(email) = &expected_email {
        command.env("USER_GOOGLE_EMAIL", email);
    }
    if let Some(path) = crate::sidecar::resolve_shell_path() {
        command.env("PATH", path);
    }

    let mut child = command
        .spawn()
        .map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    let stdin = child.stdin.take().ok_or(LocalMcpOAuthCode::ProcessFailed)?;
    let stdout = child
        .stdout
        .take()
        .ok_or(LocalMcpOAuthCode::ProcessFailed)?;
    let child_handle = Arc::new(Mutex::new(child));
    setup_children()
        .lock()
        .await
        .insert(setup_id.clone(), child_handle.clone());
    if take_cancelled_setup(&setup_id).await {
        setup_children().lock().await.remove(&setup_id);
        {
            let mut child = child_handle.lock().await;
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        let _ = remove_dir_if_exists(&pending_setup_dir(&app_dir, &setup_id));
        return Err(LocalMcpOAuthCode::Cancelled);
    }

    let result = tokio::time::timeout(
        AUTH_TIMEOUT,
        run_mcp_auth_sequence(stdin, stdout, expected_email.as_deref(), started_at),
    )
    .await
    .map_err(|_| LocalMcpOAuthCode::Timeout)
    .and_then(|value| value);

    setup_children().lock().await.remove(&setup_id);
    {
        let mut child = child_handle.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;
    }

    if take_cancelled_setup(&setup_id).await {
        cleanup_recent_credentials_since(started_at, expected_email.as_deref());
        let _ = remove_dir_if_exists(&pending_setup_dir(&app_dir, &setup_id));
        return Err(LocalMcpOAuthCode::Cancelled);
    }
    match result {
        Ok(user_google_email) => {
            write_pending_record(&app_dir, &setup_id, Some(&user_google_email))
                .map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
            Ok(user_google_email)
        }
        Err(code) => {
            cleanup_recent_credentials_since(
                started_at,
                preserved_email_for_auth_error(&code, expected_email.as_deref()),
            );
            let _ = remove_dir_if_exists(&pending_setup_dir(&app_dir, &setup_id));
            Err(code)
        }
    }
}

async fn run_mcp_auth_sequence(
    mut stdin: ChildStdin,
    stdout: ChildStdout,
    expected_email: Option<&str>,
    started_at: SystemTime,
) -> Result<String, LocalMcpOAuthCode> {
    let mut lines = BufReader::new(stdout).lines();
    let auth_email = expected_email.unwrap_or("default");
    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {
                    "name": "proliferate-desktop",
                    "version": "0.1.0"
                }
            }
        }),
    )
    .await?;
    let _ = read_response(&mut lines, 1).await?;
    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )
    .await?;
    write_json_line(
        &mut stdin,
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "start_google_auth",
                "arguments": {
                    "service_name": "Gmail",
                    "user_google_email": auth_email
                }
            }
        }),
    )
    .await?;
    let response = read_response(&mut lines, 2).await?;
    let auth_url = find_auth_url(&response).ok_or(LocalMcpOAuthCode::AuthUrlMissing)?;
    open_external_url(&auth_url).map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    wait_for_authenticated_credential(expected_email, started_at).await
}

async fn write_json_line(stdin: &mut ChildStdin, value: Value) -> Result<(), LocalMcpOAuthCode> {
    let mut bytes = serde_json::to_vec(&value).map_err(|_| LocalMcpOAuthCode::ProcessFailed)?;
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|_| LocalMcpOAuthCode::ProcessFailed)
}

async fn read_response(
    lines: &mut Lines<BufReader<ChildStdout>>,
    id: i64,
) -> Result<Value, LocalMcpOAuthCode> {
    tokio::time::timeout(RESPONSE_TIMEOUT, async {
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|_| LocalMcpOAuthCode::ProcessFailed)?
        {
            let trimmed = line.trim();
            if !trimmed.starts_with('{') {
                continue;
            }
            let value: Value = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if value.get("id").and_then(Value::as_i64) == Some(id) {
                if value.get("error").is_some() {
                    return Err(LocalMcpOAuthCode::ProcessFailed);
                }
                return Ok(value);
            }
        }
        Err(LocalMcpOAuthCode::ProcessFailed)
    })
    .await
    .map_err(|_| LocalMcpOAuthCode::Timeout)?
}

fn find_auth_url(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => extract_google_auth_url(text),
        Value::Array(items) => items.iter().find_map(find_auth_url),
        Value::Object(map) => map.values().find_map(find_auth_url),
        _ => None,
    }
}

fn extract_google_auth_url(text: &str) -> Option<String> {
    let start = text.find("https://accounts.google.com/")?;
    let tail = &text[start..];
    let end = tail
        .find(|ch: char| ch.is_whitespace() || ch == ')' || ch == ']' || ch == '"')
        .unwrap_or(tail.len());
    Some(tail[..end].to_string())
}

fn open_external_url(url: &str) -> Result<(), ()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|_| ())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err(())
    }
}

async fn wait_for_authenticated_credential(
    expected_email: Option<&str>,
    started_at: SystemTime,
) -> Result<String, LocalMcpOAuthCode> {
    let deadline = std::time::Instant::now() + AUTH_TIMEOUT;
    while std::time::Instant::now() < deadline {
        if let Some(email) = expected_email {
            match credential_status(email).await {
                CredentialStatus::Ready => {
                    verify_gmail_profile(email).await?;
                    return Ok(email.to_string());
                }
                CredentialStatus::NotReady {
                    code: LocalMcpOAuthCode::CredentialMissing,
                } => {}
                CredentialStatus::NotReady { code } => return Err(code),
            }
        } else if let Some(email) = find_recent_authenticated_email(started_at).await? {
            return Ok(email);
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
    Err(LocalMcpOAuthCode::Timeout)
}

async fn find_recent_authenticated_email(
    started_at: SystemTime,
) -> Result<Option<String>, LocalMcpOAuthCode> {
    let credentials = tokio::task::spawn_blocking(move || recent_local_credentials(started_at))
        .await
        .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)??;
    for recent in credentials {
        if validate_credential(&recent.credential).is_err() {
            continue;
        }
        return Ok(Some(recent.user_google_email));
    }
    Ok(None)
}

fn recent_local_credentials(
    started_at: SystemTime,
) -> Result<Vec<RecentCredential>, LocalMcpOAuthCode> {
    let app_dir = app_dir().map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
    let credentials_dir = credentials_dir(&app_dir);
    if !credentials_dir.exists() {
        return Ok(Vec::new());
    }
    let threshold = started_at
        .checked_sub(Duration::from_secs(2))
        .unwrap_or(started_at);
    let mut credentials = Vec::new();
    for entry in
        std::fs::read_dir(credentials_dir).map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?
    {
        let entry = entry.map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(email) = path
            .file_stem()
            .and_then(|value| value.to_str())
            .and_then(decode_credential_email)
            .and_then(|value| normalize_email(&value).ok())
        else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map_err(|_| LocalMcpOAuthCode::CredentialInvalid)?;
        if modified < threshold {
            continue;
        }
        if let Ok(credential) = read_credential_file(&path) {
            credentials.push(RecentCredential {
                user_google_email: email,
                credential,
            });
        }
    }
    Ok(credentials)
}

fn cleanup_recent_credentials_since(started_at: SystemTime, preserve_email: Option<&str>) {
    let Ok(recent_credentials) = recent_local_credentials(started_at) else {
        return;
    };
    let Ok(app_dir) = app_dir() else {
        return;
    };
    let credentials_dir = credentials_dir(&app_dir);
    let preserve_email = preserve_email.and_then(|email| normalize_email(email).ok());
    for recent in recent_credentials {
        if preserve_email.as_deref() == Some(recent.user_google_email.as_str()) {
            continue;
        }
        for path in all_credential_paths_for_email(&credentials_dir, &recent.user_google_email) {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(_) => {}
            }
        }
    }
}

fn preserved_email_for_auth_error<'a>(
    code: &LocalMcpOAuthCode,
    expected_email: Option<&'a str>,
) -> Option<&'a str> {
    if *code == LocalMcpOAuthCode::AccountMismatch {
        None
    } else {
        expected_email
    }
}

async fn credential_status(email: &str) -> CredentialStatus {
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

fn read_credential_file(path: &Path) -> Result<LocalCredential, LocalMcpOAuthCode> {
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

fn validate_credential(credential: &LocalCredential) -> Result<(), ()> {
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

async fn verify_gmail_profile(email: &str) -> Result<(), LocalMcpOAuthCode> {
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

fn access_token_is_fresh(credential: &LocalCredential) -> bool {
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

fn delete_local_data_blocking(
    connection_id: Option<&str>,
    setup_id: Option<&str>,
    email: &str,
) -> Result<(), ()> {
    let app_dir = app_dir().map_err(|_| ())?;
    let credentials_dir = credentials_dir(&app_dir);
    for path in all_credential_paths_for_email(&credentials_dir, email) {
        if path.exists() {
            std::fs::remove_file(path).map_err(|_| ())?;
        }
    }
    if let Some(connection_id) = connection_id {
        let attachments = runtime_attachments_dir(&app_dir, connection_id);
        remove_dir_if_exists(&attachments)?;
    }
    if let Some(setup_id) = setup_id {
        let pending_dir = pending_setup_dir(&app_dir, setup_id);
        remove_dir_if_exists(&pending_dir)?;
    }
    Ok(())
}

fn reconcile_pending_records(active_emails: &HashSet<String>) -> Result<(), ()> {
    let app_dir = app_dir().map_err(|_| ())?;
    let pending_root = pending_root_dir(&app_dir);
    if !pending_root.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&pending_root).map_err(|_| ())? {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.path().is_dir() {
            continue;
        }
        let record_path = entry.path().join("setup.json");
        let Ok(raw) = std::fs::read_to_string(&record_path) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<PendingSetupRecord>(&raw) else {
            continue;
        };
        let Some(raw_email) = record.user_google_email.as_deref() else {
            continue;
        };
        let Ok(email) = normalize_email(raw_email) else {
            continue;
        };
        if active_emails.contains(&email) {
            let _ = remove_dir_if_exists(&entry.path());
        }
    }
    Ok(())
}

fn remove_dir_if_exists(path: &Path) -> Result<(), ()> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(()),
    }
}

async fn lease_setup_port() -> Result<u16, LocalMcpOAuthCode> {
    let base = configured_port_base();
    let mut leases = setup_port_leases().lock().await;
    for offset in 0..PORT_POOL_SIZE {
        let Some(port) = base.checked_add(offset) else {
            continue;
        };
        if leases.contains(&port) {
            continue;
        }
        if port_is_available(port) {
            leases.insert(port);
            return Ok(port);
        }
    }
    Err(LocalMcpOAuthCode::PortUnavailable)
}

async fn release_setup_port(port: u16) {
    setup_port_leases().lock().await.remove(&port);
}

fn select_runtime_port(launch_id: &str, connection_id: &str) -> u16 {
    let base = configured_port_base();
    let primary_offset = hash_port_offset(launch_id, connection_id);
    let primary = base.saturating_add(primary_offset);
    for step in 0..PORT_POOL_SIZE {
        let offset = (primary_offset + step) % PORT_POOL_SIZE;
        let port = base.saturating_add(offset);
        if port_is_available(port) {
            return port;
        }
    }
    primary
}

fn hash_port_offset(launch_id: &str, connection_id: &str) -> u16 {
    let mut hasher = Sha256::new();
    hasher.update(launch_id.as_bytes());
    hasher.update(b":");
    hasher.update(connection_id.as_bytes());
    let digest = hasher.finalize();
    u16::from_be_bytes([digest[0], digest[1]]) % PORT_POOL_SIZE
}

fn configured_port_base() -> u16 {
    std::env::var("PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| value.checked_add(PORT_POOL_SIZE - 1).is_some())
        .unwrap_or(DEFAULT_PORT_BASE)
}

fn port_is_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn local_workspace_env(
    credentials_dir: PathBuf,
    attachments_dir: PathBuf,
    port: u16,
    email: &str,
) -> Vec<EnvPair> {
    vec![
        env_pair(
            "WORKSPACE_MCP_CREDENTIALS_DIR",
            credentials_dir.display().to_string(),
        ),
        env_pair(
            "GOOGLE_MCP_CREDENTIALS_DIR",
            credentials_dir.display().to_string(),
        ),
        env_pair(
            "WORKSPACE_ATTACHMENT_DIR",
            attachments_dir.display().to_string(),
        ),
        env_pair("WORKSPACE_MCP_BASE_URI", "http://127.0.0.1".to_string()),
        env_pair("WORKSPACE_MCP_PORT", port.to_string()),
        env_pair(
            "GOOGLE_OAUTH_REDIRECT_URI",
            format!("http://127.0.0.1:{port}/oauth2callback"),
        ),
        env_pair("USER_GOOGLE_EMAIL", email.to_string()),
        env_pair("OAUTHLIB_INSECURE_TRANSPORT", "1".to_string()),
    ]
}

fn env_pair(name: &str, value: String) -> EnvPair {
    EnvPair {
        name: name.to_string(),
        value,
    }
}

fn app_dir() -> Result<PathBuf, String> {
    crate::app_config::app_dir_path()
}

fn google_workspace_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("mcp").join("google-workspace")
}

fn credentials_dir(app_dir: &Path) -> PathBuf {
    google_workspace_dir(app_dir).join("credentials")
}

fn pending_root_dir(app_dir: &Path) -> PathBuf {
    google_workspace_dir(app_dir).join("pending")
}

fn pending_setup_dir(app_dir: &Path, setup_id: &str) -> PathBuf {
    pending_root_dir(app_dir).join(setup_id)
}

fn pending_attachments_dir(app_dir: &Path, setup_id: &str) -> PathBuf {
    pending_setup_dir(app_dir, setup_id).join("attachments")
}

fn runtime_attachments_dir(app_dir: &Path, connection_id: &str) -> PathBuf {
    google_workspace_dir(app_dir)
        .join("connections")
        .join(connection_id)
        .join("attachments")
}

fn write_pending_record(app_dir: &Path, setup_id: &str, email: Option<&str>) -> Result<(), String> {
    let record = PendingSetupRecord {
        setup_id: setup_id.to_string(),
        user_google_email: email.map(str::to_string),
        created_at: Utc::now().to_rfc3339(),
    };
    let path = pending_setup_dir(app_dir, setup_id).join("setup.json");
    crate::app_config::write_json_file_atomic(&path, &record)
}

fn create_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|_| "create_dir_failed".to_string())
}

fn credential_file_path_for_email(credentials_dir: &Path, email: &str) -> Option<PathBuf> {
    all_credential_paths_for_email(credentials_dir, email)
        .into_iter()
        .find(|path| path.exists())
}

fn all_credential_paths_for_email(credentials_dir: &Path, email: &str) -> Vec<PathBuf> {
    let encoded = encode_credential_email(email);
    let legacy = legacy_credential_email(email);
    let mut paths = vec![credentials_dir.join(format!("{encoded}.json"))];
    if legacy != encoded {
        paths.push(credentials_dir.join(format!("{legacy}.json")));
    }
    paths
}

fn encode_credential_email(email: &str) -> String {
    let mut encoded = String::new();
    for byte in email.bytes() {
        let is_safe = byte.is_ascii_alphanumeric() || matches!(byte, b'@' | b'.' | b'_' | b'-');
        if is_safe {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn legacy_credential_email(email: &str) -> String {
    email
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '@' | '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn decode_credential_email(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push(hex_pair(high, low)?);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).ok()
}

fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn validate_id(value: &str) -> Result<String, ()> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 255
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | ':' | '-'))
    {
        return Err(());
    }
    Ok(trimmed.to_string())
}

fn normalize_email(value: &str) -> Result<String, ()> {
    let email = value.trim().to_lowercase();
    if email.is_empty()
        || email.len() > 320
        || email.contains(char::is_whitespace)
        || email.matches('@').count() != 1
        || !email.contains('.')
    {
        return Err(());
    }
    Ok(email)
}

fn validate_oauth_client_id(value: &str) -> Result<String, ()> {
    let client_id = value.trim();
    if client_id.is_empty()
        || client_id.len() > 512
        || client_id.contains(char::is_whitespace)
        || client_id.contains('/')
        || client_id.contains('\\')
    {
        return Err(());
    }
    Ok(client_id.to_string())
}

fn validate_oauth_client_secret(value: &str) -> Result<String, ()> {
    let client_secret = value.trim();
    if client_secret.is_empty()
        || client_secret.len() > 1024
        || client_secret
            .chars()
            .any(|ch| ch == '\0' || ch.is_control())
    {
        return Err(());
    }
    Ok(client_secret.to_string())
}

fn resolve_command_path(command: &str) -> Result<PathBuf, ()> {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some(path) = crate::sidecar::resolve_shell_path() {
        return which::which_in(command, Some(path), current_dir).map_err(|_| ());
    }
    which::which(command).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_credential_email_like_workspace_mcp() {
        assert_eq!(
            encode_credential_email("user@example.com"),
            "user@example.com"
        );
        assert_eq!(
            encode_credential_email("user+tag@example.com"),
            "user%2Btag@example.com"
        );
        assert_eq!(
            decode_credential_email("user%2Btag@example.com").as_deref(),
            Some("user+tag@example.com"),
        );
    }

    #[test]
    fn validates_readonly_scope_strictly() {
        let credential = LocalCredential {
            token: Some("token".to_string()),
            refresh_token: Some("refresh".to_string()),
            token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
            client_id: Some("client-id".to_string()),
            client_secret: Some("client-secret".to_string()),
            scopes: vec![GMAIL_READONLY_SCOPE.to_string()],
            expiry: None,
        };
        assert!(validate_credential(&credential).is_ok());

        let broad = LocalCredential {
            token: Some("token".to_string()),
            refresh_token: Some("refresh".to_string()),
            token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
            client_id: Some("client-id".to_string()),
            client_secret: Some("client-secret".to_string()),
            scopes: vec![
                GMAIL_READONLY_SCOPE.to_string(),
                "https://www.googleapis.com/auth/gmail.modify".to_string(),
            ],
            expiry: None,
        };
        assert!(validate_credential(&broad).is_err());

        let identity_shorthand = LocalCredential {
            token: Some("token".to_string()),
            refresh_token: Some("refresh".to_string()),
            token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
            client_id: Some("client-id".to_string()),
            client_secret: Some("client-secret".to_string()),
            scopes: vec![
                GMAIL_READONLY_SCOPE.to_string(),
                "openid".to_string(),
                "email".to_string(),
                "profile".to_string(),
            ],
            expiry: None,
        };
        assert!(validate_credential(&identity_shorthand).is_ok());
    }

    #[test]
    fn expired_refreshable_credential_has_no_fresh_access_token() {
        let credential = LocalCredential {
            token: Some("token".to_string()),
            refresh_token: Some("refresh".to_string()),
            token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
            client_id: Some("client-id".to_string()),
            client_secret: Some("client-secret".to_string()),
            scopes: vec![GMAIL_READONLY_SCOPE.to_string()],
            expiry: Some(Utc::now() - chrono::Duration::minutes(1)),
        };
        assert!(validate_credential(&credential).is_ok());
        assert!(!access_token_is_fresh(&credential));
    }

    #[test]
    fn runtime_port_is_deterministic_for_launch_and_connection() {
        let first = select_runtime_port("launch-1", "connection-1");
        let second = select_runtime_port("launch-1", "connection-1");
        assert_eq!(first, second);
    }

    #[test]
    fn account_mismatch_does_not_preserve_recent_expected_credential() {
        assert_eq!(
            preserved_email_for_auth_error(
                &LocalMcpOAuthCode::AccountMismatch,
                Some("user@example.com"),
            ),
            None,
        );
        assert_eq!(
            preserved_email_for_auth_error(
                &LocalMcpOAuthCode::CredentialInvalid,
                Some("user@example.com"),
            ),
            Some("user@example.com"),
        );
    }

    #[tokio::test]
    async fn start_auth_honors_preexisting_cancel_marker_before_launch() {
        let setup_id = format!(
            "test_cancel_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        );
        cancelled_setups().lock().await.insert(setup_id.clone());

        let error = start_google_workspace_mcp_auth(StartAuthInput {
            setup_id,
            user_google_email: None,
            oauth_client_id: "client.apps.googleusercontent.com".to_string(),
            oauth_client_secret: "secret".to_string(),
        })
        .await
        .expect_err("pre-cancelled setup should fail before launching uvx");

        assert_eq!(error.code, LocalMcpOAuthCode::Cancelled);
    }
}
