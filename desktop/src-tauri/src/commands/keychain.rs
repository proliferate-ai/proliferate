use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc, OnceLock};

use anyharness_credential_discovery::{export_portable_auth, PortableAuthExport, ProviderId};
use base64::Engine;
use getrandom::getrandom;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.proliferate.app.env";
const AUTH_SERVICE: &str = "com.proliferate.app.auth";
const CONNECTOR_SERVICE: &str = "com.proliferate.app.connectors";
const RUNTIME_SERVICE: &str = "com.proliferate.app.runtime";
const AUTH_SESSION_ACCOUNT: &str = "desktop_session";
const PENDING_AUTH_ACCOUNT: &str = "desktop_pending_auth";
const ANYHARNESS_DATA_KEY_ACCOUNT: &str = "anyharness_data_key";
const ANYHARNESS_DATA_KEY_ENV: &str = "ANYHARNESS_DATA_KEY";

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
    read_password(SERVICE, name)
}

fn connector_account(connection_id: &str, field_id: &str) -> String {
    format!("{connection_id}:{field_id}")
}

enum KeychainRequest {
    Read {
        service: String,
        account: String,
        response: mpsc::SyncSender<Result<Option<String>, String>>,
    },
    Set {
        service: String,
        account: String,
        value: String,
        response: mpsc::SyncSender<Result<(), String>>,
    },
    Delete {
        service: String,
        account: String,
        response: mpsc::SyncSender<Result<(), String>>,
    },
}

fn get_or_create_entry<'a>(
    entries: &'a mut HashMap<(String, String), keyring::Entry>,
    service: &str,
    account: &str,
) -> Result<&'a keyring::Entry, String> {
    let key = (service.to_string(), account.to_string());
    if !entries.contains_key(&key) {
        let entry = keyring::Entry::new(service, account).map_err(|e| e.to_string())?;
        entries.insert(key.clone(), entry);
    }
    entries
        .get(&key)
        .ok_or_else(|| "Keychain entry cache was not populated.".to_string())
}

fn keychain_sender() -> &'static mpsc::Sender<KeychainRequest> {
    static KEYCHAIN_SENDER: OnceLock<mpsc::Sender<KeychainRequest>> = OnceLock::new();
    KEYCHAIN_SENDER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<KeychainRequest>();
        std::thread::Builder::new()
            .name("proliferate-keychain".to_string())
            .spawn(move || {
                let mut entries: HashMap<(String, String), keyring::Entry> = HashMap::new();
                while let Ok(request) = rx.recv() {
                    match request {
                        KeychainRequest::Read {
                            service,
                            account,
                            response,
                        } => {
                            let result = get_or_create_entry(&mut entries, &service, &account)
                                .and_then(|entry| match entry.get_password() {
                                    Ok(value) => Ok(Some(value)),
                                    Err(keyring::Error::NoEntry) => Ok(None),
                                    Err(error) => Err(error.to_string()),
                                });
                            let _ = response.send(result);
                        }
                        KeychainRequest::Set {
                            service,
                            account,
                            value,
                            response,
                        } => {
                            let result = get_or_create_entry(&mut entries, &service, &account)
                                .and_then(|entry| {
                                    entry.set_password(&value).map_err(|e| e.to_string())
                                });
                            let _ = response.send(result);
                        }
                        KeychainRequest::Delete {
                            service,
                            account,
                            response,
                        } => {
                            let result = get_or_create_entry(&mut entries, &service, &account)
                                .and_then(|entry| match entry.delete_credential() {
                                    Ok(()) => Ok(()),
                                    Err(keyring::Error::NoEntry) => Ok(()),
                                    Err(error) => Err(error.to_string()),
                                });
                            let _ = response.send(result);
                        }
                    }
                }
            })
            .expect("failed to start keychain worker");
        tx
    })
}

fn read_password(service: &str, account: &str) -> Result<Option<String>, String> {
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    keychain_sender()
        .send(KeychainRequest::Read {
            service: service.to_string(),
            account: account.to_string(),
            response: response_tx,
        })
        .map_err(|_| "Keychain worker is unavailable.".to_string())?;
    response_rx
        .recv()
        .map_err(|_| "Keychain worker did not return a result.".to_string())?
}

fn set_password(service: &str, account: &str, value: &str) -> Result<(), String> {
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    keychain_sender()
        .send(KeychainRequest::Set {
            service: service.to_string(),
            account: account.to_string(),
            value: value.to_string(),
            response: response_tx,
        })
        .map_err(|_| "Keychain worker is unavailable.".to_string())?;
    response_rx
        .recv()
        .map_err(|_| "Keychain worker did not return a result.".to_string())?
}

fn delete_password(service: &str, account: &str) -> Result<(), String> {
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    keychain_sender()
        .send(KeychainRequest::Delete {
            service: service.to_string(),
            account: account.to_string(),
            response: response_tx,
        })
        .map_err(|_| "Keychain worker is unavailable.".to_string())?;
    response_rx
        .recv()
        .map_err(|_| "Keychain worker did not return a result.".to_string())?
}

fn ensure_runtime_data_key() -> Result<String, String> {
    if let Some(value) = read_password(RUNTIME_SERVICE, ANYHARNESS_DATA_KEY_ACCOUNT)? {
        return Ok(value);
    }
    let mut bytes = [0u8; 32];
    getrandom(&mut bytes).map_err(|e| e.to_string())?;
    let value = base64::engine::general_purpose::STANDARD.encode(bytes);
    set_password(RUNTIME_SERVICE, ANYHARNESS_DATA_KEY_ACCOUNT, &value)?;
    Ok(value)
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
        if read_password(SERVICE, var)?.is_some() {
            names.push(var.to_string());
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn set_env_var_secret(name: String, value: String) -> Result<(), String> {
    set_password(SERVICE, &name, &value)
}

#[tauri::command]
pub async fn delete_env_var_secret(name: String) -> Result<(), String> {
    delete_password(SERVICE, &name)
}

#[tauri::command]
pub async fn get_connector_secret(
    connection_id: String,
    field_id: String,
) -> Result<Option<String>, String> {
    read_password(
        CONNECTOR_SERVICE,
        &connector_account(&connection_id, &field_id),
    )
}

#[tauri::command]
pub async fn set_connector_secret(
    connection_id: String,
    field_id: String,
    value: String,
) -> Result<(), String> {
    set_password(
        CONNECTOR_SERVICE,
        &connector_account(&connection_id, &field_id),
        &value,
    )
}

#[tauri::command]
pub async fn delete_connector_secret(
    connection_id: String,
    field_id: String,
) -> Result<(), String> {
    delete_password(
        CONNECTOR_SERVICE,
        &connector_account(&connection_id, &field_id),
    )
}

#[tauri::command]
pub async fn get_auth_session() -> Result<Option<AuthSessionRecord>, String> {
    match read_password(AUTH_SERVICE, AUTH_SESSION_ACCOUNT)? {
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn set_auth_session(session: AuthSessionRecord) -> Result<(), String> {
    let raw = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    set_password(AUTH_SERVICE, AUTH_SESSION_ACCOUNT, &raw)
}

#[tauri::command]
pub async fn clear_auth_session() -> Result<(), String> {
    delete_password(AUTH_SERVICE, AUTH_SESSION_ACCOUNT)
}

#[tauri::command]
pub async fn get_pending_auth() -> Result<Option<PendingAuthRecord>, String> {
    match read_password(AUTH_SERVICE, PENDING_AUTH_ACCOUNT)? {
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn set_pending_auth(record: PendingAuthRecord) -> Result<(), String> {
    let raw = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    set_password(AUTH_SERVICE, PENDING_AUTH_ACCOUNT, &raw)
}

#[tauri::command]
pub async fn clear_pending_auth() -> Result<(), String> {
    delete_password(AUTH_SERVICE, PENDING_AUTH_ACCOUNT)
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
        if let Ok(Some(password)) = read_password(SERVICE, var) {
            env.insert(var.to_string(), password);
        }
    }
    if let Ok(data_key) = ensure_runtime_data_key() {
        env.insert(ANYHARNESS_DATA_KEY_ENV.to_string(), data_key);
    }
    env
}
