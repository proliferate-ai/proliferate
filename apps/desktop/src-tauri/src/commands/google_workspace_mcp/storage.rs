use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::{EnvPair, PendingSetupRecord};
pub(super) fn delete_local_data_blocking(
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

pub(super) fn reconcile_pending_records(active_emails: &HashSet<String>) -> Result<(), ()> {
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

pub(super) fn remove_dir_if_exists(path: &Path) -> Result<(), ()> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(()),
    }
}

pub(super) fn local_workspace_env(
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

pub(super) fn env_pair(name: &str, value: String) -> EnvPair {
    EnvPair {
        name: name.to_string(),
        value,
    }
}

pub(super) fn app_dir() -> Result<PathBuf, String> {
    crate::app_config::app_dir_path()
}

pub(super) fn google_workspace_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("mcp").join("google-workspace")
}

pub(super) fn credentials_dir(app_dir: &Path) -> PathBuf {
    google_workspace_dir(app_dir).join("credentials")
}

pub(super) fn pending_root_dir(app_dir: &Path) -> PathBuf {
    google_workspace_dir(app_dir).join("pending")
}

pub(super) fn pending_setup_dir(app_dir: &Path, setup_id: &str) -> PathBuf {
    pending_root_dir(app_dir).join(setup_id)
}

pub(super) fn pending_attachments_dir(app_dir: &Path, setup_id: &str) -> PathBuf {
    pending_setup_dir(app_dir, setup_id).join("attachments")
}

pub(super) fn runtime_attachments_dir(app_dir: &Path, connection_id: &str) -> PathBuf {
    google_workspace_dir(app_dir)
        .join("connections")
        .join(connection_id)
        .join("attachments")
}

pub(super) fn write_pending_record(
    app_dir: &Path,
    setup_id: &str,
    email: Option<&str>,
) -> Result<(), String> {
    let record = PendingSetupRecord {
        setup_id: setup_id.to_string(),
        user_google_email: email.map(str::to_string),
        created_at: Utc::now().to_rfc3339(),
    };
    let path = pending_setup_dir(app_dir, setup_id).join("setup.json");
    crate::app_config::write_json_file_atomic(&path, &record)
}

pub(super) fn create_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|_| "create_dir_failed".to_string())
}

pub(super) fn credential_file_path_for_email(
    credentials_dir: &Path,
    email: &str,
) -> Option<PathBuf> {
    all_credential_paths_for_email(credentials_dir, email)
        .into_iter()
        .find(|path| path.exists())
}

pub(super) fn all_credential_paths_for_email(credentials_dir: &Path, email: &str) -> Vec<PathBuf> {
    let encoded = encode_credential_email(email);
    let legacy = legacy_credential_email(email);
    let mut paths = vec![credentials_dir.join(format!("{encoded}.json"))];
    if legacy != encoded {
        paths.push(credentials_dir.join(format!("{legacy}.json")));
    }
    paths
}

pub(super) fn encode_credential_email(email: &str) -> String {
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

pub(super) fn legacy_credential_email(email: &str) -> String {
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

pub(super) fn decode_credential_email(value: &str) -> Option<String> {
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

pub(super) fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

pub(super) fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub(super) fn validate_id(value: &str) -> Result<String, ()> {
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

pub(super) fn normalize_email(value: &str) -> Result<String, ()> {
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

pub(super) fn validate_oauth_client_id(value: &str) -> Result<String, ()> {
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

pub(super) fn validate_oauth_client_secret(value: &str) -> Result<String, ()> {
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

pub(super) fn resolve_command_path(command: &str) -> Result<PathBuf, ()> {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some(path) = crate::sidecar::resolve_shell_path() {
        return which::which_in(command, Some(path), current_dir).map_err(|_| ());
    }
    which::which(command).map_err(|_| ())
}
