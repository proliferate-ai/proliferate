use std::collections::HashMap;
use std::path::PathBuf;

use anyharness_credential_discovery::{export_portable_auth, PortableAuthExport, ProviderId};
use base64::Engine;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.proliferate.app.env";
const AUTH_SERVICE: &str = "com.proliferate.app.auth";
const AUTH_SESSION_ACCOUNT: &str = "desktop_session";
const PENDING_AUTH_ACCOUNT: &str = "desktop_pending_auth";

const KNOWN_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "CURSOR_API_KEY",
    "AMP_API_KEY",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSessionRecord {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub user_id: String,
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingAuthRecord {
    pub state: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub created_at: String,
    pub last_handled_callback_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCloudCredentialSource {
    pub provider: String,
    pub auth_mode: String,
    pub detected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedCloudCredentialFile {
    pub relative_path: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedEnvCloudCredential {
    pub auth_mode: String,
    pub env_vars: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedFileCloudCredential {
    pub auth_mode: String,
    pub files: Vec<ExportedCloudCredentialFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ExportedCloudCredential {
    Env(ExportedEnvCloudCredential),
    File(ExportedFileCloudCredential),
}

fn read_env_secret(name: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| "Home directory not available".to_string())
}

#[tauri::command]
pub async fn list_configured_env_var_names() -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for &var in KNOWN_ENV_VARS {
        let entry = keyring::Entry::new(SERVICE, var).map_err(|e| e.to_string())?;
        if entry.get_password().is_ok() {
            names.push(var.to_string());
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn set_env_var_secret(name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_env_var_secret(name: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_auth_session() -> Result<Option<AuthSessionRecord>, String> {
    let entry =
        keyring::Entry::new(AUTH_SERVICE, AUTH_SESSION_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn set_auth_session(session: AuthSessionRecord) -> Result<(), String> {
    let entry =
        keyring::Entry::new(AUTH_SERVICE, AUTH_SESSION_ACCOUNT).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    entry.set_password(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_auth_session() -> Result<(), String> {
    let entry =
        keyring::Entry::new(AUTH_SERVICE, AUTH_SESSION_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_pending_auth() -> Result<Option<PendingAuthRecord>, String> {
    let entry =
        keyring::Entry::new(AUTH_SERVICE, PENDING_AUTH_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn set_pending_auth(record: PendingAuthRecord) -> Result<(), String> {
    let entry =
        keyring::Entry::new(AUTH_SERVICE, PENDING_AUTH_ACCOUNT).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    entry.set_password(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_pending_auth() -> Result<(), String> {
    let entry =
        keyring::Entry::new(AUTH_SERVICE, PENDING_AUTH_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn list_syncable_cloud_credentials() -> Result<Vec<LocalCloudCredentialSource>, String> {
    let home = home_dir()?;
    tracing::info!(home_dir = %home.display(), "Listing syncable cloud credentials");
    let claude_env_detected = read_env_secret("ANTHROPIC_API_KEY")?.is_some();
    let claude_file_detected = portable_auth_detected(ProviderId::Claude, &home);
    let claude_auth_mode = if claude_env_detected {
        "env"
    } else if claude_file_detected {
        "file"
    } else {
        "env"
    };

    let codex_detected = portable_auth_detected(ProviderId::Codex, &home);

    tracing::info!(
        claude_env_detected,
        claude_file_detected,
        codex_detected,
        "Resolved syncable cloud credential state"
    );

    Ok(vec![
        LocalCloudCredentialSource {
            provider: "claude".to_string(),
            auth_mode: claude_auth_mode.to_string(),
            detected: claude_env_detected || claude_file_detected,
        },
        LocalCloudCredentialSource {
            provider: "codex".to_string(),
            auth_mode: "file".to_string(),
            detected: codex_detected,
        },
    ])
}

#[tauri::command]
pub async fn export_syncable_cloud_credential(
    provider: String,
) -> Result<ExportedCloudCredential, String> {
    match provider.as_str() {
        "claude" => export_claude_credential(),
        "codex" => export_portable_file_credential(ProviderId::Codex),
        _ => Err(format!("Unsupported cloud credential provider: {provider}")),
    }
}

/// Export Claude credential: env-var takes priority, then file-backed auth.
fn export_claude_credential() -> Result<ExportedCloudCredential, String> {
    // Prefer env-var auth if available.
    if let Some(api_key) = read_env_secret("ANTHROPIC_API_KEY")? {
        tracing::info!("Exporting Claude cloud credential from desktop env secret");
        let mut env_vars = HashMap::new();
        env_vars.insert("ANTHROPIC_API_KEY".to_string(), api_key);
        return Ok(ExportedCloudCredential::Env(ExportedEnvCloudCredential {
            auth_mode: "env".to_string(),
            env_vars,
        }));
    }

    // Fall back to file-backed auth.
    match export_portable_file_credential(ProviderId::Claude) {
        Ok(credential) => Ok(credential),
        Err(err) if err == "No portable cloud credential found for provider." => Err(
            "No Claude credentials found. Set ANTHROPIC_API_KEY or log in to Claude Code."
                .to_string(),
        ),
        Err(err) => Err(err),
    }
}

fn export_portable_file_credential(
    provider: ProviderId,
) -> Result<ExportedCloudCredential, String> {
    let home = home_dir()?;
    tracing::info!(provider = ?provider, home_dir = %home.display(), "Exporting portable cloud credential");
    let Some(export) = export_portable_auth(provider, &home).map_err(|e| e.to_string())? else {
        tracing::warn!(provider = ?provider, "Portable cloud credential export returned no files");
        return Err("No portable cloud credential found for provider.".to_string());
    };

    tracing::info!(provider = ?provider, file_count = export.files.len(), "Portable cloud credential export succeeded");
    Ok(ExportedCloudCredential::File(ExportedFileCloudCredential {
        auth_mode: "file".to_string(),
        files: portable_export_to_cloud_files(export),
    }))
}

fn portable_auth_detected(provider: ProviderId, home_dir: &std::path::Path) -> bool {
    match export_portable_auth(provider, home_dir) {
        Ok(Some(export)) => {
            tracing::info!(
                provider = ?provider,
                file_count = export.files.len(),
                "Portable cloud credential detected"
            );
            true
        }
        Ok(None) => {
            tracing::info!(provider = ?provider, "Portable cloud credential not detected");
            false
        }
        Err(err) => {
            tracing::warn!(provider = ?provider, error = %err, "Portable cloud credential detection failed");
            false
        }
    }
}

fn portable_export_to_cloud_files(export: PortableAuthExport) -> Vec<ExportedCloudCredentialFile> {
    export
        .files
        .into_iter()
        .map(|file| ExportedCloudCredentialFile {
            relative_path: file.relative_path.as_str().to_string(),
            content_base64: base64::engine::general_purpose::STANDARD.encode(file.content),
        })
        .collect()
}

pub fn load_all_secrets_for_sidecar() -> HashMap<String, String> {
    let mut env = HashMap::new();
    for &var in KNOWN_ENV_VARS {
        if let Ok(entry) = keyring::Entry::new(SERVICE, var) {
            if let Ok(password) = entry.get_password() {
                env.insert(var.to_string(), password);
            }
        }
    }
    env
}
