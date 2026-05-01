use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use super::credentials::{
    credential_status, read_credential_file, validate_credential, verify_gmail_profile,
};
use super::storage::{
    all_credential_paths_for_email, app_dir, create_dir, credentials_dir, decode_credential_email,
    normalize_email, pending_attachments_dir, pending_setup_dir, remove_dir_if_exists,
    write_pending_record,
};
use super::{
    setup_children, take_cancelled_setup, CredentialStatus, LocalMcpOAuthCode, RecentCredential,
    AUTH_TIMEOUT, RESPONSE_TIMEOUT, WORKSPACE_MCP_PACKAGE,
};
pub(super) async fn run_auth_flow(
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

pub(super) fn preserved_email_for_auth_error<'a>(
    code: &LocalMcpOAuthCode,
    expected_email: Option<&'a str>,
) -> Option<&'a str> {
    if *code == LocalMcpOAuthCode::AccountMismatch {
        None
    } else {
        expected_email
    }
}
