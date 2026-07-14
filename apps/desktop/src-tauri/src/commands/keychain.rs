use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};

use base64::Engine;
use getrandom::fill;
use serde::{Deserialize, Serialize};

use crate::app_config::{app_dir_path, read_json_file};

const RUNTIME_SERVICE: &str = "com.proliferate.app.runtime";
const ANYHARNESS_DATA_KEY_ACCOUNT: &str = "anyharness_data_key";
const ANYHARNESS_DATA_KEY_ENV: &str = "ANYHARNESS_DATA_KEY";

// Legacy keychain locations recreatable secrets used to live in, kept only so we
// can purge orphaned items after migrating to file storage (see
// `purge_legacy_keychain_secrets`).
const LEGACY_ENV_SERVICE: &str = "com.proliferate.app.env";
const LEGACY_AUTH_SERVICE: &str = "com.proliferate.app.auth";
const LEGACY_AUTH_SESSION_ACCOUNT: &str = "desktop_session";
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
// a plaintext file would defeat — stays in the keychain.
//
// The desktop release matrix is macOS-only; the file is owner-only (0600) on
// unix. If Windows/Linux desktop builds are added, revisit storage there:
// Windows has no 0600 path, and both have user-scoped OS keychains that survive
// reinstall and could keep encrypting at rest.
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
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
    pub state: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub created_at: String,
    pub last_handled_callback_url: Option<String>,
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

/// One-time, best-effort cleanup of the keychain items that recreatable secrets
/// used to live in, so an old refresh token / provider key is not left orphaned
/// after the move to file storage. Deleting a keychain item never decrypts it,
/// so this succeeds even on items whose ACL no longer trusts this build. Runs at
/// most once per process and ignores every error (a missing item is the norm on
/// a fresh install).
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
pub async fn get_auth_session() -> Result<Option<AuthSessionRecord>, String> {
    // The boot read is also the natural point to purge any session/creds an older
    // build left in the keychain (runs at most once per process).
    purge_legacy_keychain_secrets();
    read_json_file(&auth_session_file_path()?)
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
pub async fn get_pending_auth() -> Result<Option<PendingAuthRecord>, String> {
    read_json_file(&pending_auth_file_path()?)
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

pub fn load_all_secrets_for_sidecar() -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Ok(map) = read_env_secrets_map() {
        for &var in KNOWN_ENV_VARS {
            if let Some(value) = map.get(var) {
                env.insert(var.to_string(), value.clone());
            }
        }
    }
    if let Ok(data_key) = ensure_runtime_data_key() {
        env.insert(ANYHARNESS_DATA_KEY_ENV.to_string(), data_key);
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
            provider: Some("github".to_string()),
            purpose: Some("login".to_string()),
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
        assert_eq!(parsed.provider, record.provider);
        assert_eq!(parsed.purpose, record.purpose);
        assert_eq!(parsed.code_verifier, record.code_verifier);
        assert_eq!(parsed.redirect_uri, record.redirect_uri);
        assert_eq!(parsed.last_handled_callback_url, None);

        cleanup(&path);
    }

    #[test]
    fn pending_auth_record_reads_legacy_file_without_provider_metadata() {
        let record: PendingAuthRecord = serde_json::from_value(serde_json::json!({
            "state": "legacy-state",
            "code_verifier": "legacy-verifier",
            "redirect_uri": "proliferate://auth/callback",
            "created_at": "2026-06-10T00:00:00Z",
            "last_handled_callback_url": null
        }))
        .expect("legacy pending auth should deserialize");

        assert_eq!(record.provider, None);
        assert_eq!(record.purpose, None);
        assert_eq!(record.state, "legacy-state");
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
        assert_eq!(parsed.get("ANTHROPIC_API_KEY").map(String::as_str), Some("sk-ant-xxx"));
        assert_eq!(parsed.get("OPENAI_API_KEY").map(String::as_str), Some("sk-openai-yyy"));

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
