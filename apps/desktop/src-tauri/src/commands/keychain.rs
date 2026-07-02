use std::collections::HashMap;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use anyharness_credential_discovery::{export_portable_auth, PortableAuthExport, ProviderId};
use base64::Engine;
use getrandom::fill;
use serde::{Deserialize, Serialize};

use crate::app_config::{app_dir_path, read_json_file};

const RUNTIME_SERVICE: &str = "com.proliferate.app.runtime";
const ANYHARNESS_DATA_KEY_ACCOUNT: &str = "anyharness_data_key";
const ANYHARNESS_DATA_KEY_ENV: &str = "ANYHARNESS_DATA_KEY";
const KEYCHAIN_OP_TIMEOUT: Duration = Duration::from_secs(5);

// Legacy keychain locations recreatable secrets used to live in, kept only so we
// can purge orphaned items after migrating to file storage (see
// `purge_legacy_keychain_secrets`).
#[cfg(target_os = "macos")]
const LEGACY_ENV_SERVICE: &str = "com.proliferate.app.env";
#[cfg(target_os = "macos")]
const LEGACY_AUTH_SERVICE: &str = "com.proliferate.app.auth";
#[cfg(target_os = "macos")]
const LEGACY_AUTH_SESSION_ACCOUNT: &str = "desktop_session";
#[cfg(target_os = "macos")]
const LEGACY_PENDING_AUTH_ACCOUNT: &str = "desktop_pending_auth";

// Serializes writes to the secret files so concurrent Tauri commands cannot lose
// an update (read-modify-write of env-secrets.json) or collide on a temp file.
static SECRET_FILE_LOCK: Mutex<()> = Mutex::new(());

const KNOWN_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "CURSOR_API_KEY",
    "AMP_API_KEY",
];

// Recreatable secrets — the auth session, pending OAuth state, and provider/env
// credentials — live as 0600 files under the durable app home (`~/.proliferate`,
// dev: `~/.proliferate-local`). That directory survives uninstall/reinstall and
// app updates, so the session persists across them. A macOS keychain item does
// not: its ACL is bound to the build's code signature, so a reinstalled or
// re-signed build can no longer read it (hence the "log in again after
// reinstall" bug). Only the anyharness data key — an at-rest encryption key that
// a plaintext file would defeat — stays in the OS keychain/keyring. Linux builds
// require a working user Secret Service/KWallet-compatible keyring for that data
// key.
fn auth_session_file_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("auth-session.json"))
}

fn pending_auth_file_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("pending-auth.json"))
}

fn env_secrets_path() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("env-secrets.json"))
}

/// The `{ env_var_name: value }` map of stored provider/env credentials.
/// A missing file is an empty map.
fn read_env_secrets_map() -> Result<HashMap<String, String>, String> {
    Ok(read_json_file(&env_secrets_path()?)?.unwrap_or_default())
}

/// Atomically write `value` as JSON with owner-only (0600) permissions set at
/// creation, so the secret is never briefly world-readable (no chmod-after-write
/// window). Callers hold `SECRET_FILE_LOCK`, so the shared temp path cannot
/// collide. The writer for every recreatable secret file.
fn write_secret_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|error| format!("Failed to open {}: {error}", tmp.display()))?;
        use std::io::Write;
        file.write_all(&json)
            .map_err(|error| format!("Failed to write {}: {error}", tmp.display()))?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path)
        .map_err(|error| format!("Failed to persist {}: {error}", path.display()))?;
    Ok(())
}

fn delete_file_if_exists(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to delete {}: {error}", path.display())),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSessionRecord {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub user_id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub github_login: Option<String>,
    pub avatar_url: Option<String>,
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
pub struct AuthSessionResponse {
    pub session: Option<AuthSessionRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAuthResponse {
    pub record: Option<PendingAuthRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentAuthSource {
    pub provider: String,
    pub auth_mode: String,
    pub detected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAgentAuthCredentialFile {
    pub relative_path: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedEnvAgentAuthCredential {
    pub auth_mode: String,
    pub env_vars: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedFileAgentAuthCredential {
    pub auth_mode: String,
    pub files: Vec<ExportedAgentAuthCredentialFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ExportedAgentAuthCredential {
    Env(ExportedEnvAgentAuthCredential),
    File(ExportedFileAgentAuthCredential),
}

#[derive(Clone, Copy)]
struct AgentAuthProviderSpec {
    id: &'static str,
    default_auth_mode: &'static str,
    env_secret_names: &'static [&'static str],
    discovery_provider: Option<ProviderId>,
    missing_message: &'static str,
    augment_env_vars: Option<fn(&str, &mut HashMap<String, String>)>,
}

fn augment_gemini_env_vars(name: &str, env_vars: &mut HashMap<String, String>) {
    if name == "GOOGLE_API_KEY" {
        env_vars.insert("GOOGLE_GENAI_USE_VERTEXAI".to_string(), "true".to_string());
    }
}

const AGENT_AUTH_PROVIDERS: &[AgentAuthProviderSpec] = &[
    AgentAuthProviderSpec {
        id: "claude",
        default_auth_mode: "file",
        env_secret_names: &[],
        discovery_provider: Some(ProviderId::Claude),
        missing_message: "No portable Claude credentials found. Log in to Claude Code to sync file-based auth.",
        augment_env_vars: None,
    },
    AgentAuthProviderSpec {
        id: "codex",
        default_auth_mode: "file",
        env_secret_names: &[],
        discovery_provider: Some(ProviderId::Codex),
        missing_message: "No Codex credentials found. Log in to Codex or ensure local auth is available.",
        augment_env_vars: None,
    },
    AgentAuthProviderSpec {
        id: "gemini",
        default_auth_mode: "env",
        // Order matters: prefer a direct Gemini API key over Vertex-style Google API key auth.
        env_secret_names: &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        discovery_provider: Some(ProviderId::Gemini),
        missing_message: "No Gemini credentials found. Set GEMINI_API_KEY, set GOOGLE_API_KEY for Vertex AI, or log in to Gemini CLI.",
        augment_env_vars: Some(augment_gemini_env_vars),
    },
];

fn read_env_secret(name: &str) -> Result<Option<String>, String> {
    Ok(read_env_secrets_map()?.get(name).cloned())
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
                            // The only writer left is the anyharness data key
                            // (RUNTIME_SERVICE), which must never be pre-deleted —
                            // losing it in a delete-add window would orphan the
                            // data it encrypts. So this is a plain set.
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
                                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
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
        .recv_timeout(KEYCHAIN_OP_TIMEOUT)
        .map_err(|_| "Keychain read timed out or worker is unavailable.".to_string())?
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
        .recv_timeout(KEYCHAIN_OP_TIMEOUT)
        .map_err(|_| "Keychain write timed out or worker is unavailable.".to_string())?
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
        .recv_timeout(KEYCHAIN_OP_TIMEOUT)
        .map_err(|_| "Keychain delete timed out or worker is unavailable.".to_string())?
}

/// One-time, best-effort cleanup of keychain items that recreatable secrets used
/// to live in, so an old refresh token / provider key is not left orphaned after
/// the move to file storage. Only runs on macOS where the legacy entries may
/// exist — Linux desktop support is new and has never stored secrets in the
/// keyring under the legacy service names.
#[cfg(target_os = "macos")]
fn purge_legacy_keychain_secrets() {
    static PURGED: AtomicBool = AtomicBool::new(false);
    if PURGED.swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = delete_password(LEGACY_AUTH_SERVICE, LEGACY_AUTH_SESSION_ACCOUNT);
    let _ = delete_password(LEGACY_AUTH_SERVICE, LEGACY_PENDING_AUTH_ACCOUNT);
    for &var in KNOWN_ENV_VARS {
        let _ = delete_password(LEGACY_ENV_SERVICE, var);
    }
}

fn ensure_runtime_data_key() -> Result<String, String> {
    if let Some(value) = read_password(RUNTIME_SERVICE, ANYHARNESS_DATA_KEY_ACCOUNT)? {
        return Ok(value);
    }
    let mut bytes = [0u8; 32];
    fill(&mut bytes).map_err(|e| e.to_string())?;
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
    let map = read_env_secrets_map()?;
    Ok(KNOWN_ENV_VARS
        .iter()
        .filter(|var| map.contains_key(**var))
        .map(|var| var.to_string())
        .collect())
}

#[tauri::command]
pub async fn set_env_var_secret(name: String, value: String) -> Result<(), String> {
    let _guard = SECRET_FILE_LOCK
        .lock()
        .map_err(|_| "secret file lock poisoned".to_string())?;
    let mut map = read_env_secrets_map()?;
    map.insert(name, value);
    write_secret_file(&env_secrets_path()?, &map)
}

#[tauri::command]
pub async fn delete_env_var_secret(name: String) -> Result<(), String> {
    let _guard = SECRET_FILE_LOCK
        .lock()
        .map_err(|_| "secret file lock poisoned".to_string())?;
    let mut map = read_env_secrets_map()?;
    if map.remove(&name).is_some() {
        write_secret_file(&env_secrets_path()?, &map)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_auth_session() -> Result<AuthSessionResponse, String> {
    tracing::debug!("get_auth_session command started");
    // The boot read is also the natural point to purge any session/creds an older
    // build left in the keychain (runs at most once per process).
    #[cfg(target_os = "macos")]
    purge_legacy_keychain_secrets();
    let path = auth_session_file_path()?;
    let session = read_json_file(&path)?;
    tracing::debug!(
        has_session = session.is_some(),
        "get_auth_session command completed"
    );
    Ok(AuthSessionResponse { session })
}

#[tauri::command]
pub async fn set_auth_session(session: AuthSessionRecord) -> Result<(), String> {
    let _guard = SECRET_FILE_LOCK
        .lock()
        .map_err(|_| "secret file lock poisoned".to_string())?;
    write_secret_file(&auth_session_file_path()?, &session)
}

#[tauri::command]
pub async fn clear_auth_session() -> Result<(), String> {
    let _guard = SECRET_FILE_LOCK
        .lock()
        .map_err(|_| "secret file lock poisoned".to_string())?;
    delete_file_if_exists(&auth_session_file_path()?)
}

#[tauri::command]
pub fn get_pending_auth() -> Result<PendingAuthResponse, String> {
    let record = read_json_file(&pending_auth_file_path()?)?;
    Ok(PendingAuthResponse { record })
}

#[tauri::command]
pub async fn set_pending_auth(record: PendingAuthRecord) -> Result<(), String> {
    let _guard = SECRET_FILE_LOCK
        .lock()
        .map_err(|_| "secret file lock poisoned".to_string())?;
    write_secret_file(&pending_auth_file_path()?, &record)
}

#[tauri::command]
pub async fn clear_pending_auth() -> Result<(), String> {
    let _guard = SECRET_FILE_LOCK
        .lock()
        .map_err(|_| "secret file lock poisoned".to_string())?;
    delete_file_if_exists(&pending_auth_file_path()?)
}

#[tauri::command]
pub async fn list_syncable_agent_auth_credentials() -> Result<Vec<LocalAgentAuthSource>, String> {
    let home = home_dir()?;
    tracing::info!(home_dir = %home.display(), "Listing syncable agent-auth credentials");
    let sources = AGENT_AUTH_PROVIDERS
        .iter()
        .map(|spec| {
            let env_detected = detect_env_secret(spec)?.is_some();
            let file_detected = spec
                .discovery_provider
                .map(|provider| portable_auth_detected(provider, &home))
                .unwrap_or(false);
            let auth_mode = if env_detected {
                "env"
            } else if file_detected {
                "file"
            } else {
                spec.default_auth_mode
            };

            tracing::info!(
                provider = spec.id,
                env_detected,
                file_detected,
                auth_mode,
                "Resolved syncable agent-auth credential state"
            );

            Ok(LocalAgentAuthSource {
                provider: spec.id.to_string(),
                auth_mode: auth_mode.to_string(),
                detected: env_detected || file_detected,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(sources)
}

#[tauri::command]
pub async fn export_syncable_agent_auth_credential(
    provider: String,
) -> Result<ExportedAgentAuthCredential, String> {
    let Some(spec) = agent_auth_provider(&provider) else {
        return Err(format!("Unsupported agent-auth provider: {provider}"));
    };

    if let Some(env_credential) = export_env_credential(spec)? {
        return Ok(env_credential);
    }

    if let Some(discovery_provider) = spec.discovery_provider {
        return match export_portable_file_credential(discovery_provider) {
            Ok(credential) => Ok(credential),
            Err(err) if err == "No portable agent-auth credential found for provider." => {
                Err(spec.missing_message.to_string())
            }
            Err(err) => Err(err),
        };
    }

    Err(spec.missing_message.to_string())
}

fn export_portable_file_credential(
    provider: ProviderId,
) -> Result<ExportedAgentAuthCredential, String> {
    let home = home_dir()?;
    tracing::info!(provider = ?provider, home_dir = %home.display(), "Exporting portable agent-auth credential");
    let Some(export) = export_portable_auth(provider, &home).map_err(|e| e.to_string())? else {
        tracing::warn!(provider = ?provider, "Portable agent-auth credential export returned no files");
        return Err("No portable agent-auth credential found for provider.".to_string());
    };

    tracing::info!(provider = ?provider, file_count = export.files.len(), "Portable agent-auth credential export succeeded");
    Ok(ExportedAgentAuthCredential::File(
        ExportedFileAgentAuthCredential {
            auth_mode: "file".to_string(),
            files: portable_export_to_agent_auth_files(export),
        },
    ))
}

fn agent_auth_provider(provider: &str) -> Option<&'static AgentAuthProviderSpec> {
    AGENT_AUTH_PROVIDERS.iter().find(|spec| spec.id == provider)
}

fn detect_env_secret(
    spec: &AgentAuthProviderSpec,
) -> Result<Option<(&'static str, String)>, String> {
    for &name in spec.env_secret_names {
        if let Some(value) = read_env_secret(name)? {
            return Ok(Some((name, value)));
        }
    }
    Ok(None)
}

fn export_env_credential(
    spec: &AgentAuthProviderSpec,
) -> Result<Option<ExportedAgentAuthCredential>, String> {
    let Some((name, value)) = detect_env_secret(spec)? else {
        return Ok(None);
    };

    tracing::info!(
        provider = spec.id,
        env_var = name,
        "Exporting agent-auth credential from desktop env secret"
    );
    let mut env_vars = HashMap::new();
    env_vars.insert(name.to_string(), value);
    if let Some(augment_env_vars) = spec.augment_env_vars {
        augment_env_vars(name, &mut env_vars);
    }

    Ok(Some(ExportedAgentAuthCredential::Env(
        ExportedEnvAgentAuthCredential {
            auth_mode: "env".to_string(),
            env_vars,
        },
    )))
}

fn portable_auth_detected(provider: ProviderId, home_dir: &std::path::Path) -> bool {
    match export_portable_auth(provider, home_dir) {
        Ok(Some(export)) => {
            tracing::info!(
                provider = ?provider,
                file_count = export.files.len(),
                "Portable agent-auth credential detected"
            );
            true
        }
        Ok(None) => {
            tracing::info!(provider = ?provider, "Portable agent-auth credential not detected");
            false
        }
        Err(err) => {
            tracing::warn!(provider = ?provider, error = %err, "Portable agent-auth credential detection failed");
            false
        }
    }
}

fn portable_export_to_agent_auth_files(
    export: PortableAuthExport,
) -> Vec<ExportedAgentAuthCredentialFile> {
    export
        .files
        .into_iter()
        .map(|file| ExportedAgentAuthCredentialFile {
            relative_path: file.relative_path.as_str().to_string(),
            content_base64: base64::engine::general_purpose::STANDARD.encode(file.content),
        })
        .collect()
}

pub fn load_all_secrets_for_sidecar() -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Ok(map) = read_env_secrets_map() {
        for &var in KNOWN_ENV_VARS {
            if let Some(value) = map.get(var) {
                env.insert(var.to_string(), value.clone());
            }
        }
    }
    match ensure_runtime_data_key() {
        Ok(data_key) => {
            env.insert(ANYHARNESS_DATA_KEY_ENV.to_string(), data_key);
        }
        Err(error) => {
            tracing::warn!(
                %error,
                "failed to load AnyHarness data key from OS keychain/keyring"
            );
        }
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(file_name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!("proliferate-keychain-{unique}-{counter}"))
            .join(file_name)
    }

    fn cleanup(path: &Path) {
        std::fs::remove_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir cleanup should succeed");
    }

    #[test]
    fn auth_session_record_round_trips_through_file() {
        let path = temp_path("auth-session.json");
        let record = AuthSessionRecord {
            access_token: "access".to_string(),
            refresh_token: "refresh".to_string(),
            expires_at: "2026-06-10T00:00:00Z".to_string(),
            user_id: "user-1".to_string(),
            email: "dev@example.com".to_string(),
            display_name: Some("Dev".to_string()),
            github_login: None,
            avatar_url: None,
        };

        write_secret_file(&path, &record).expect("write should succeed");
        let parsed: AuthSessionRecord = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(parsed.access_token, record.access_token);
        assert_eq!(parsed.refresh_token, record.refresh_token);
        assert_eq!(parsed.expires_at, record.expires_at);
        assert_eq!(parsed.user_id, record.user_id);
        assert_eq!(parsed.email, record.email);
        assert_eq!(parsed.display_name, record.display_name);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)
                .expect("metadata should be readable")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        cleanup(&path);
    }

    #[test]
    fn pending_auth_record_round_trips_through_file() {
        let path = temp_path("pending-auth.json");
        let record = PendingAuthRecord {
            state: "state".to_string(),
            code_verifier: "verifier".to_string(),
            redirect_uri: "proliferate://auth".to_string(),
            created_at: "2026-06-10T00:00:00Z".to_string(),
            last_handled_callback_url: None,
        };

        write_secret_file(&path, &record).expect("write should succeed");
        let parsed: PendingAuthRecord = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(parsed.state, record.state);
        assert_eq!(parsed.code_verifier, record.code_verifier);
        assert_eq!(parsed.redirect_uri, record.redirect_uri);
        assert_eq!(parsed.last_handled_callback_url, None);

        cleanup(&path);
    }

    #[test]
    fn delete_file_if_exists_tolerates_missing_files() {
        let path = temp_path("auth-session.json");
        delete_file_if_exists(&path).expect("missing file should be Ok");

        std::fs::create_dir_all(path.parent().expect("temp dir should exist"))
            .expect("temp dir should be creatable");
        std::fs::write(&path, b"{}").expect("write should succeed");
        delete_file_if_exists(&path).expect("existing file should delete");
        assert!(!path.exists());

        cleanup(&path);
    }

    #[test]
    fn env_secrets_map_round_trips_through_file_at_0600() {
        let path = temp_path("env-secrets.json");
        let mut map = HashMap::new();
        map.insert("ANTHROPIC_API_KEY".to_string(), "sk-ant-xxx".to_string());
        map.insert("OPENAI_API_KEY".to_string(), "sk-openai-yyy".to_string());

        write_secret_file(&path, &map).expect("write should succeed");
        let parsed: HashMap<String, String> = read_json_file(&path)
            .expect("read should succeed")
            .expect("file should exist");
        assert_eq!(
            parsed.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("sk-ant-xxx")
        );
        assert_eq!(
            parsed.get("OPENAI_API_KEY").map(String::as_str),
            Some("sk-openai-yyy")
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)
                .expect("metadata should be readable")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        cleanup(&path);
    }
}
