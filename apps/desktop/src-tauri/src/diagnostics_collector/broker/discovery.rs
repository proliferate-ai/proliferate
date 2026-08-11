use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use fs2::FileExt;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::app_config;

#[path = "discovery/profile.rs"]
mod profile;
use profile::read_profile_instance;

use super::protocol::{
    DiagnosticsBrokerLocatorAddressV1, DiagnosticsBrokerLocatorV1, DiagnosticsBrokerRequestV1,
    DiagnosticsBrokerResponseV1, BROKER_PROTOCOL_VERSION, MAX_BROKER_RESPONSE_FRAME_BYTES,
    MAX_LOCATOR_BYTES,
};

const PRODUCTION_IDENTIFIER: &str = "com.proliferate.app";
const LOCK_FILE_NAME: &str = "diagnostics-broker-v1.lock";
const LOCATOR_FILE_NAME: &str = "diagnostics-broker-v1.json";
const STALE_PROBE_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_DARWIN_SOCKET_PATH_BYTES: usize = 103;
const PROFILE_MAX_LEN: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiagnosticsBrokerScope {
    pub(crate) app_dir: PathBuf,
    pub(crate) identifier: String,
    pub(crate) environment: &'static str,
    pub(crate) profile: Option<String>,
    pub(crate) scope_id: String,
    pub(crate) socket_path: PathBuf,
    pub(crate) run_dir: PathBuf,
    pub(crate) lock_path: PathBuf,
    pub(crate) locator_path: PathBuf,
}

#[derive(Debug)]
pub(crate) enum DiscoveryError {
    InvalidProfile,
    InvalidNamespace,
    UnsafeArtifact,
    Busy,
    AmbiguousStaleState,
    Io,
    Protocol,
}

pub(crate) struct BrokerDiscoveryGuard {
    scope: DiagnosticsBrokerScope,
    lock: File,
    app_boot_id: String,
    pid: u32,
    published: bool,
}

impl std::fmt::Debug for BrokerDiscoveryGuard {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BrokerDiscoveryGuard")
            .field("scope_id", &self.scope.scope_id)
            .field("app_boot_id", &self.app_boot_id)
            .field("pid", &self.pid)
            .field("published", &self.published)
            .finish()
    }
}

impl BrokerDiscoveryGuard {
    pub(crate) async fn acquire(
        scope: DiagnosticsBrokerScope,
        app_boot_id: String,
    ) -> Result<Self, DiscoveryError> {
        ensure_namespace(&scope)?;
        let lock = open_persistent_lock(&scope.lock_path)?;
        lock.try_lock_exclusive().map_err(|error| {
            if error.kind() == io::ErrorKind::WouldBlock {
                DiscoveryError::Busy
            } else {
                DiscoveryError::Io
            }
        })?;
        cleanup_stale_after_lock(&scope).await?;
        Ok(Self {
            scope,
            lock,
            app_boot_id,
            pid: std::process::id(),
            published: false,
        })
    }

    pub(crate) fn scope(&self) -> &DiagnosticsBrokerScope {
        &self.scope
    }

    pub(crate) fn publish(&mut self) -> Result<DiagnosticsBrokerLocatorV1, DiscoveryError> {
        let locator = DiagnosticsBrokerLocatorV1 {
            schema_version: BROKER_PROTOCOL_VERSION,
            locator: DiagnosticsBrokerLocatorAddressV1::UnixStream {
                path: self.scope.socket_path.to_string_lossy().into_owned(),
            },
            app_boot_id: self.app_boot_id.clone(),
            pid: self.pid,
            updated_at: Utc::now().to_rfc3339(),
        };
        let bytes = serde_json::to_vec(&locator).map_err(|_| DiscoveryError::Protocol)?;
        if bytes.len() > MAX_LOCATOR_BYTES {
            return Err(DiscoveryError::Protocol);
        }
        let temporary = self
            .scope
            .run_dir
            .join(format!(".{LOCATOR_FILE_NAME}.{}.tmp", self.app_boot_id));
        let publish_result = (|| {
            let mut file = open_new_owner_file(&temporary)?;
            file.write_all(&bytes).map_err(|_| DiscoveryError::Io)?;
            file.sync_all().map_err(|_| DiscoveryError::Io)?;
            fs::rename(&temporary, &self.scope.locator_path).map_err(|_| DiscoveryError::Io)
        })();
        if publish_result.is_err() {
            let _ = remove_if_exists(&temporary);
        }
        publish_result?;
        self.published = true;
        Ok(locator)
    }

    pub(crate) fn cleanup(&mut self) -> Result<(), DiscoveryError> {
        if self.published {
            if let Ok(locator) = read_locator_file(&self.scope.locator_path) {
                if locator.app_boot_id == self.app_boot_id
                    && locator.pid == self.pid
                    && locator_path(&locator) == self.scope.socket_path
                {
                    remove_if_exists(&self.scope.locator_path)?;
                    remove_owned_socket(&self.scope.socket_path)?;
                }
            }
            self.published = false;
        }
        fs2::FileExt::unlock(&self.lock).map_err(|_| DiscoveryError::Io)
    }
}

impl Drop for BrokerDiscoveryGuard {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

pub(crate) fn current_server_scope() -> Result<DiagnosticsBrokerScope, DiscoveryError> {
    if std::env::var_os("PROLIFERATE_DEV").is_some() {
        let profile =
            std::env::var("PROLIFERATE_DEV_PROFILE").map_err(|_| DiscoveryError::InvalidProfile)?;
        validate_profile(&profile)?;
        let app_dir = app_config::app_dir_path().map_err(|_| DiscoveryError::InvalidNamespace)?;
        build_scope(
            app_dir,
            format!("com.proliferate.app.local.{}", profile.replace('_', "-")),
            "development",
            Some(profile),
        )
    } else {
        build_scope(
            app_config::app_dir_path().map_err(|_| DiscoveryError::InvalidNamespace)?,
            PRODUCTION_IDENTIFIER.to_string(),
            "production",
            None,
        )
    }
}

pub(crate) fn client_scope(
    profile: Option<&str>,
) -> Result<DiagnosticsBrokerScope, DiscoveryError> {
    match profile {
        None => build_scope(
            app_config::home_dir()
                .map_err(|_| DiscoveryError::InvalidNamespace)?
                .join(".proliferate"),
            PRODUCTION_IDENTIFIER.to_string(),
            "production",
            None,
        ),
        Some(profile) => {
            validate_profile(profile)?;
            let instance_path = app_config::home_dir()
                .map_err(|_| DiscoveryError::InvalidNamespace)?
                .join(".proliferate-local/dev/profiles")
                .join(profile)
                .join("instance.json");
            let (instance_profile, desktop_home) = read_profile_instance(&instance_path)?;
            if instance_profile != profile {
                return Err(DiscoveryError::InvalidProfile);
            }
            let app_dir = PathBuf::from(desktop_home);
            if !app_dir.is_absolute() {
                return Err(DiscoveryError::InvalidNamespace);
            }
            build_scope(
                app_dir,
                format!("com.proliferate.app.local.{}", profile.replace('_', "-")),
                "development",
                Some(profile.to_string()),
            )
        }
    }
}

pub(crate) fn read_locator(
    scope: &DiagnosticsBrokerScope,
) -> Result<DiagnosticsBrokerLocatorV1, DiscoveryError> {
    validate_app_directory(&scope.app_dir)?;
    validate_directory(&scope.run_dir, 0o700)?;
    let locator = read_locator_file(&scope.locator_path)?;
    if locator.schema_version != BROKER_PROTOCOL_VERSION
        || uuid::Uuid::parse_str(&locator.app_boot_id).is_err()
        || locator.pid == 0
        || locator_path(&locator) != scope.socket_path
    {
        return Err(DiscoveryError::Protocol);
    }
    chrono::DateTime::parse_from_rfc3339(&locator.updated_at)
        .map_err(|_| DiscoveryError::Protocol)?;
    Ok(locator)
}

fn build_scope(
    app_dir: PathBuf,
    identifier: String,
    environment: &'static str,
    profile: Option<String>,
) -> Result<DiagnosticsBrokerScope, DiscoveryError> {
    let app_dir = fs::canonicalize(&app_dir).map_err(|_| DiscoveryError::InvalidNamespace)?;
    validate_app_directory(&app_dir)?;
    let profile_value = profile.as_deref().unwrap_or_default();
    let mut hasher = Sha256::new();
    for (index, value) in [
        identifier.as_bytes(),
        environment.as_bytes(),
        profile_value.as_bytes(),
        app_dir.as_os_str().as_bytes(),
    ]
    .into_iter()
    .enumerate()
    {
        if index > 0 {
            hasher.update([0_u8]);
        }
        hasher.update(value);
    }
    let digest = hasher.finalize();
    let scope_id = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let socket_root = darwin_user_temp_dir()?.join("pd");
    let socket_path = socket_root.join(format!("{scope_id}.sock"));
    if socket_path.as_os_str().as_bytes().len() > MAX_DARWIN_SOCKET_PATH_BYTES {
        return Err(DiscoveryError::InvalidNamespace);
    }
    let run_dir = app_dir.join("run");
    Ok(DiagnosticsBrokerScope {
        app_dir,
        identifier,
        environment,
        profile,
        scope_id,
        socket_path,
        run_dir: run_dir.clone(),
        lock_path: run_dir.join(LOCK_FILE_NAME),
        locator_path: run_dir.join(LOCATOR_FILE_NAME),
    })
}

fn ensure_namespace(scope: &DiagnosticsBrokerScope) -> Result<(), DiscoveryError> {
    validate_app_directory(&scope.app_dir)?;
    create_or_validate_directory(&scope.run_dir, 0o700)?;
    let socket_root = scope
        .socket_path
        .parent()
        .ok_or(DiscoveryError::InvalidNamespace)?;
    create_or_validate_directory(socket_root, 0o700)
}

fn validate_profile(profile: &str) -> Result<(), DiscoveryError> {
    let valid = !profile.is_empty()
        && profile.len() <= PROFILE_MAX_LEN
        && profile.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'_' | b'-'))
        })
        && profile
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    valid.then_some(()).ok_or(DiscoveryError::InvalidProfile)
}

fn open_persistent_lock(path: &Path) -> Result<File, DiscoveryError> {
    match open_new_owner_file(path) {
        Ok(file) => Ok(file),
        Err(DiscoveryError::Io) if path.exists() => open_existing_owner_file(path, Some(0o600)),
        Err(error) => Err(error),
    }
}

fn open_new_owner_file(path: &Path) -> Result<File, DiscoveryError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| DiscoveryError::Io)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| DiscoveryError::Io)?;
    validate_open_file(&file, Some(0o600))?;
    Ok(file)
}

fn open_existing_owner_file(path: &Path, exact_mode: Option<u32>) -> Result<File, DiscoveryError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| DiscoveryError::Io)?;
    validate_open_file(&file, exact_mode)?;
    Ok(file)
}

fn validate_open_file(file: &File, exact_mode: Option<u32>) -> Result<(), DiscoveryError> {
    let metadata = file.metadata().map_err(|_| DiscoveryError::Io)?;
    let mode = metadata.mode() & 0o777;
    if !metadata.file_type().is_file()
        || metadata.uid() != effective_uid()
        || exact_mode.is_some_and(|expected| mode != expected)
        || (exact_mode.is_none() && mode & 0o022 != 0)
    {
        return Err(DiscoveryError::UnsafeArtifact);
    }
    Ok(())
}

fn validate_app_directory(path: &Path) -> Result<(), DiscoveryError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| DiscoveryError::InvalidNamespace)?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != effective_uid()
        || metadata.mode() & 0o022 != 0
    {
        return Err(DiscoveryError::UnsafeArtifact);
    }
    Ok(())
}

fn create_or_validate_directory(path: &Path, mode: u32) -> Result<(), DiscoveryError> {
    match fs::create_dir(path) {
        Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|_| DiscoveryError::Io)?,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(DiscoveryError::Io),
    }
    validate_directory(path, mode)
}

fn validate_directory(path: &Path, mode: u32) -> Result<(), DiscoveryError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| DiscoveryError::Io)?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != effective_uid()
        || metadata.mode() & 0o777 != mode
    {
        return Err(DiscoveryError::UnsafeArtifact);
    }
    Ok(())
}

async fn cleanup_stale_after_lock(scope: &DiagnosticsBrokerScope) -> Result<(), DiscoveryError> {
    let locator = match fs::symlink_metadata(&scope.locator_path) {
        Ok(_) => Some(read_locator_file(&scope.locator_path)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(_) => return Err(DiscoveryError::Io),
    };
    if let Some(locator) = &locator {
        if locator.schema_version != BROKER_PROTOCOL_VERSION
            || uuid::Uuid::parse_str(&locator.app_boot_id).is_err()
            || locator.pid == 0
            || locator_path(locator) != scope.socket_path
        {
            return Err(DiscoveryError::AmbiguousStaleState);
        }
    }

    match probe_old_broker(&scope.socket_path, locator.as_ref()).await? {
        Liveness::Absent => {
            if scope.socket_path.exists() {
                remove_owned_socket(&scope.socket_path)?;
            }
            if locator.is_some() {
                remove_if_exists(&scope.locator_path)?;
            }
            Ok(())
        }
        Liveness::Matching | Liveness::Ambiguous => Err(DiscoveryError::AmbiguousStaleState),
    }
}

enum Liveness {
    Absent,
    Matching,
    Ambiguous,
}

async fn probe_old_broker(
    path: &Path,
    locator: Option<&DiagnosticsBrokerLocatorV1>,
) -> Result<Liveness, DiscoveryError> {
    let result = tokio::time::timeout(STALE_PROBE_TIMEOUT, async {
        let mut stream = match tokio::net::UnixStream::connect(path).await {
            Ok(stream) => stream,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) =>
            {
                return Liveness::Absent;
            }
            Err(_) => return Liveness::Ambiguous,
        };
        let Ok(credentials) = stream.peer_cred() else {
            return Liveness::Ambiguous;
        };
        let Some(locator) = locator else {
            return Liveness::Ambiguous;
        };
        if credentials.uid() != effective_uid()
            || credentials.pid().and_then(|pid| u32::try_from(pid).ok()) != Some(locator.pid)
        {
            return Liveness::Ambiguous;
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let request = DiagnosticsBrokerRequestV1::Health {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: locator.app_boot_id.clone(),
            request_id: request_id.clone(),
        };
        let Ok(bytes) = serde_json::to_vec(&request) else {
            return Liveness::Ambiguous;
        };
        if bytes.is_empty()
            || bytes.len() > u32::MAX as usize
            || stream.write_u32(bytes.len() as u32).await.is_err()
            || stream.write_all(&bytes).await.is_err()
            || stream.flush().await.is_err()
        {
            return Liveness::Ambiguous;
        }
        let Ok(length) = stream.read_u32().await.map(|value| value as usize) else {
            return Liveness::Ambiguous;
        };
        if length == 0 || length > MAX_BROKER_RESPONSE_FRAME_BYTES {
            return Liveness::Ambiguous;
        }
        let mut response_bytes = vec![0_u8; length];
        if stream.read_exact(&mut response_bytes).await.is_err() {
            return Liveness::Ambiguous;
        }
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&response_bytes) else {
            return Liveness::Ambiguous;
        };
        let Ok(response) = serde_json::from_value::<DiagnosticsBrokerResponseV1>(value.clone())
        else {
            return Liveness::Ambiguous;
        };
        if serde_json::to_value(&response).ok().as_ref() != Some(&value) {
            return Liveness::Ambiguous;
        }
        match response {
            DiagnosticsBrokerResponseV1::Accepted {
                protocol_version,
                app_boot_id,
                request_id: response_request_id,
            } if protocol_version == BROKER_PROTOCOL_VERSION
                && app_boot_id == locator.app_boot_id
                && response_request_id == request_id =>
            {
                Liveness::Matching
            }
            _ => Liveness::Ambiguous,
        }
    })
    .await;
    Ok(result.unwrap_or(Liveness::Ambiguous))
}

fn read_locator_file(path: &Path) -> Result<DiagnosticsBrokerLocatorV1, DiscoveryError> {
    let mut file = open_existing_owner_file(path, Some(0o600))?;
    let length = file.metadata().map_err(|_| DiscoveryError::Io)?.len();
    if length == 0 || length > MAX_LOCATOR_BYTES as u64 {
        return Err(DiscoveryError::Protocol);
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| DiscoveryError::Io)?;
    serde_json::from_slice(&bytes).map_err(|_| DiscoveryError::Protocol)
}

fn locator_path(locator: &DiagnosticsBrokerLocatorV1) -> PathBuf {
    match &locator.locator {
        DiagnosticsBrokerLocatorAddressV1::UnixStream { path } => PathBuf::from(path),
    }
}

fn remove_owned_socket(path: &Path) -> Result<(), DiscoveryError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(DiscoveryError::Io),
    };
    if !metadata.file_type().is_socket()
        || metadata.uid() != effective_uid()
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(DiscoveryError::UnsafeArtifact);
    }
    fs::remove_file(path).map_err(|_| DiscoveryError::Io)
}

fn remove_if_exists(path: &Path) -> Result<(), DiscoveryError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(DiscoveryError::Io),
    }
}

fn effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() }
}

#[cfg(target_os = "macos")]
fn darwin_user_temp_dir() -> Result<PathBuf, DiscoveryError> {
    // SAFETY: confstr is called first with a null buffer to obtain its size,
    // then with a buffer of exactly that size.
    unsafe {
        let required = libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, std::ptr::null_mut(), 0);
        if required == 0 {
            return Err(DiscoveryError::InvalidNamespace);
        }
        let mut bytes = vec![0_u8; required];
        if libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            bytes.as_mut_ptr().cast(),
            bytes.len(),
        ) == 0
        {
            return Err(DiscoveryError::InvalidNamespace);
        }
        while bytes.last() == Some(&0) {
            bytes.pop();
        }
        let path = std::ffi::OsStr::from_bytes(&bytes);
        Ok(PathBuf::from(path))
    }
}

#[cfg(not(target_os = "macos"))]
fn darwin_user_temp_dir() -> Result<PathBuf, DiscoveryError> {
    Ok(std::env::temp_dir())
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
