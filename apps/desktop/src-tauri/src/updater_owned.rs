//! Owned desktop update download, staging, and verification.
//!
//! `tauri-plugin-updater` 2.10.1 buffers the whole download in memory, cannot
//! abort/resume, persists nothing, and its `Update::install(bytes)` seam does NO
//! signature verification. So we own the transfer: stream to a staged file with
//! resume, enforce a single live download via an abort token, and verify sha256
//! and minisign against the baked pubkey before install. See Update Flow ADR
//! (FR-2) and `specs/systems/desktop-host/desktop-native.md`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::Engine as _;
use futures::StreamExt as _;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, ResourceId, Runtime, State, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::io::AsyncWriteExt as _;
use tokio_util::sync::CancellationToken;

/// Connect timeout for the owned reqwest client (plugin has none, so a dead endpoint hangs "Starting download…" forever).
const CONNECT_TIMEOUT_SECS: u64 = 10;
/// Per-read inactivity budget; exceeding it surfaces `UPDATER_DOWNLOAD_STALLED`.
const READ_INACTIVITY_SECS: u64 = 30;
/// Bound on how long an aborter/fresh download waits for the prior transfer to release the staged file, so the JS abort ack never hangs on a wedged task.
const ABORT_DRAIN_SECS: u64 = 10;

/// Typed error surfaced to JS (`{ code, message }`); names match the ADR §5 error vocabulary consumed by the TS state machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedUpdaterError {
    pub code: OwnedUpdaterErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OwnedUpdaterErrorCode {
    // Explicit renames pin the shipped wire strings across the 2026-08-27
    // variant de-prefixing (enum_variant_names).
    #[serde(rename = "UPDATER_CHECK_FAILED")]
    CheckFailed,
    #[serde(rename = "UPDATER_DOWNLOAD_STALLED")]
    DownloadStalled,
    #[serde(rename = "UPDATER_DOWNLOAD_ABORTED")]
    DownloadAborted,
    #[serde(rename = "UPDATER_ARTIFACT_HASH_MISMATCH")]
    ArtifactHashMismatch,
    #[serde(rename = "UPDATER_INSTALL_FAILED")]
    InstallFailed,
    #[serde(rename = "UPDATER_DISK_FULL")]
    DiskFull,
}

impl OwnedUpdaterError {
    fn new(code: OwnedUpdaterErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn check(message: impl Into<String>) -> Self {
        Self::new(OwnedUpdaterErrorCode::CheckFailed, message)
    }

    fn install(message: impl Into<String>) -> Self {
        Self::new(OwnedUpdaterErrorCode::InstallFailed, message)
    }

    fn mismatch(message: impl Into<String>) -> Self {
        Self::new(OwnedUpdaterErrorCode::ArtifactHashMismatch, message)
    }

    /// Classify a std::io error: a full disk (ENOSPC) is user-actionable.
    fn from_io(err: &std::io::Error) -> Self {
        if err.raw_os_error() == Some(28) {
            Self::new(OwnedUpdaterErrorCode::DiskFull, err.to_string())
        } else {
            Self::install(err.to_string())
        }
    }
}

/// What `updater_owned_check` returns to JS; `rid` is the stored `Update` handle.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub version: String,
    pub title: Option<String>,
    pub rid: ResourceId,
}

/// Sidecar next to a staged artifact; `sha256` + `signature` are the reuse proof.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedInfo {
    pub version: String,
    pub sha256: String,
    pub byte_length: u64,
    pub signature: String,
    pub staged_at: String,
}

/// Byte-progress event streamed to JS during an owned download.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
}

/// A live download's abort handle, generation-tagged so a slow finisher only clears the slot if no newer download took it over. `done_rx` fires (sender dropped) when the future exits, so an aborter can await the release.
struct LiveDownload {
    token: CancellationToken,
    generation: u64,
    done_rx: tokio::sync::oneshot::Receiver<()>,
}

/// Managed abort token for the single in-flight owned download. "No stacked downloads ever" is enforced two ways: JS aborts-first before a retry, and starting a new download here cancels any token still present.
#[derive(Default)]
pub struct OwnedUpdaterState {
    live: std::sync::Mutex<Option<LiveDownload>>,
    next_generation: std::sync::atomic::AtomicU64,
}

impl OwnedUpdaterState {
    /// Cancel + fully drain any prior download, then install a fresh token and completion channel. Returns the token, its generation, and the sender whose drop signals the future exited. Awaits the prior transfer's teardown (never holding the std mutex across the await) so the file is released.
    async fn install_fresh_token(
        &self,
    ) -> (CancellationToken, u64, tokio::sync::oneshot::Sender<()>) {
        self.cancel_and_drain_live().await;

        let generation = self
            .next_generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let token = CancellationToken::new();
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        {
            let mut guard = self.live.lock().expect("owned updater token poisoned");
            *guard = Some(LiveDownload {
                token: token.clone(),
                generation,
                done_rx,
            });
        }
        (token, generation, done_tx)
    }

    /// Take the live download out, cancel it, await its bounded completion signal. Returns whether something was live.
    async fn cancel_and_drain_live(&self) -> bool {
        let previous = {
            let mut guard = self.live.lock().expect("owned updater token poisoned");
            guard.take()
        };
        match previous {
            Some(previous) => {
                previous.token.cancel();
                let _ = tokio::time::timeout(
                    std::time::Duration::from_secs(ABORT_DRAIN_SECS),
                    previous.done_rx,
                )
                .await;
                true
            }
            None => false,
        }
    }

    fn clear_token(&self, generation: u64) {
        let mut guard = self.live.lock().expect("owned updater token poisoned");
        if guard.as_ref().map(|live| live.generation) == Some(generation) {
            *guard = None;
        }
    }

    /// Cancel the in-flight download and await its teardown, so the JS ack means the transfer released the file, not just that a cancel was requested.
    async fn abort(&self) -> bool {
        self.cancel_and_drain_live().await
    }
}

pub type SharedOwnedUpdaterState = Arc<OwnedUpdaterState>;

pub fn create_owned_updater_state() -> SharedOwnedUpdaterState {
    Arc::new(OwnedUpdaterState::default())
}

/// Lowercase hex sha256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Replicates the plugin's minisign verification (`Update::install` does not verify). `signature_b64`/`pubkey_b64` are base64-wrapped minisign text blocks.
pub fn verify_signature(
    bytes: &[u8],
    signature_b64: &str,
    pubkey_b64: &str,
) -> Result<(), OwnedUpdaterError> {
    let pubkey_text = base64_to_utf8(pubkey_b64)
        .map_err(|e| OwnedUpdaterError::mismatch(format!("pubkey decode failed: {e}")))?;
    let public_key = PublicKey::decode(&pubkey_text)
        .map_err(|e| OwnedUpdaterError::mismatch(format!("pubkey parse failed: {e}")))?;
    let signature_text = base64_to_utf8(signature_b64)
        .map_err(|e| OwnedUpdaterError::mismatch(format!("signature decode failed: {e}")))?;
    let signature = Signature::decode(&signature_text)
        .map_err(|e| OwnedUpdaterError::mismatch(format!("signature parse failed: {e}")))?;
    public_key
        .verify(bytes, &signature, true)
        .map_err(|e| OwnedUpdaterError::mismatch(format!("signature verification failed: {e}")))
}

fn base64_to_utf8(value: &str) -> Result<String, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| e.to_string())?;
    String::from_utf8(decoded).map_err(|e| e.to_string())
}

/// Full artifact verification: sha256 must match the sidecar, then minisign must verify. Ordered cheap-first.
pub fn verify_artifact(
    bytes: &[u8],
    expected_sha256: &str,
    signature_b64: &str,
    pubkey_b64: &str,
) -> Result<(), OwnedUpdaterError> {
    let actual = sha256_hex(bytes);
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(OwnedUpdaterError::mismatch(format!(
            "sha256 mismatch: expected {expected_sha256}, got {actual}"
        )));
    }
    verify_signature(bytes, signature_b64, pubkey_b64)
}

/// Decision for a `.partial` resume: reuse existing bytes with a `Range` request only when the server honored it (HTTP 206); a plain 200 restarts from zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResumeAction {
    ResumeFrom(u64),
    RestartFromZero,
}

pub fn resume_decision(partial_len: u64, server_honored_range: bool) -> ResumeAction {
    if partial_len > 0 && server_honored_range {
        ResumeAction::ResumeFrom(partial_len)
    } else {
        ResumeAction::RestartFromZero
    }
}

/// Reject any version that could escape the staged directory before it is interpolated into a filename: only `[A-Za-z0-9._-]+`, non-empty, ≤64 chars, and never the bare `.`/`..` tokens. Returns the version unchanged if accepted.
fn validated_version(version: &str) -> Result<&str, OwnedUpdaterError> {
    if version.is_empty() || version.len() > 64 {
        return Err(OwnedUpdaterError::check(format!(
            "rejected update version: length {} out of allowed range 1..=64",
            version.len()
        )));
    }
    if version == "." || version == ".." {
        return Err(OwnedUpdaterError::check(
            "rejected update version: path traversal token",
        ));
    }
    if !version
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err(OwnedUpdaterError::check(
            "rejected update version: only [A-Za-z0-9._-] permitted",
        ));
    }
    Ok(version)
}

fn staged_dir(base: &Path) -> PathBuf {
    base.join("updates").join("staged")
}

fn staged_artifact_path(base: &Path, version: &str) -> PathBuf {
    staged_dir(base).join(format!("{version}.tar.gz"))
}

fn staged_partial_path(base: &Path, version: &str) -> PathBuf {
    staged_dir(base).join(format!("{version}.tar.gz.partial"))
}

fn staged_sidecar_path(base: &Path, version: &str) -> PathBuf {
    staged_dir(base).join(format!("{version}.staged.json"))
}

/// Validate a staged artifact for `version`: file + sidecar must exist, bytes must re-hash to the sidecar sha256, and minisign must verify. On any mismatch the artifact and sidecar are deleted and `None` returned.
pub fn validate_staged(base: &Path, version: &str, pubkey_b64: &str) -> Option<StagedInfo> {
    if validated_version(version).is_err() {
        return None;
    }
    let artifact = staged_artifact_path(base, version);
    let sidecar_path = staged_sidecar_path(base, version);

    let sidecar_raw = std::fs::read(&sidecar_path).ok()?;
    let sidecar: StagedInfo = serde_json::from_slice(&sidecar_raw).ok()?;
    if sidecar.version != version {
        cleanup_staged(base, version);
        return None;
    }

    let bytes = match std::fs::read(&artifact) {
        Ok(bytes) => bytes,
        Err(_) => {
            cleanup_staged(base, version);
            return None;
        }
    };

    if verify_artifact(&bytes, &sidecar.sha256, &sidecar.signature, pubkey_b64).is_err() {
        tracing::warn!(
            version,
            counter = "artifact.version.mismatch",
            "UPDATER_ARTIFACT_HASH_MISMATCH: staged artifact failed verification, deleting"
        );
        cleanup_staged(base, version);
        return None;
    }

    Some(sidecar)
}

/// Delete the staged artifact, partial, and sidecar for a version. Best-effort.
pub fn cleanup_staged(base: &Path, version: &str) {
    if validated_version(version).is_err() {
        return;
    }
    let _ = std::fs::remove_file(staged_artifact_path(base, version));
    let _ = std::fs::remove_file(staged_partial_path(base, version));
    let _ = std::fs::remove_file(staged_sidecar_path(base, version));
}

/// The baked minisign pubkey from `tauri.conf.json` plugins.updater.pubkey. Verifying against this regardless of endpoint means an override can never weaken signature checks.
fn baked_pubkey<R: Runtime>(app: &AppHandle<R>) -> Result<String, OwnedUpdaterError> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|pubkey| pubkey.as_str())
        .map(|pubkey| pubkey.to_string())
        .ok_or_else(|| OwnedUpdaterError::check("updater pubkey missing from config"))
}

fn app_data_base<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, OwnedUpdaterError> {
    app.path()
        .app_data_dir()
        .map_err(|e| OwnedUpdaterError::install(format!("app data dir unavailable: {e}")))
}

#[tauri::command]
pub async fn updater_owned_check<R: Runtime>(
    webview: Webview<R>,
    endpoint_override: Option<String>,
) -> Result<CheckResult, OwnedUpdaterError> {
    let mut builder = webview.updater_builder();

    if let Some(endpoint) = endpoint_override
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        let url = url::Url::parse(endpoint)
            .map_err(|e| OwnedUpdaterError::check(format!("bad endpoint override: {e}")))?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|e| OwnedUpdaterError::check(e.to_string()))?;
    }

    let updater = builder
        .build()
        .map_err(|e| OwnedUpdaterError::check(e.to_string()))?;
    let update = updater
        .check()
        .await
        .map_err(|e| OwnedUpdaterError::check(e.to_string()))?;

    let Some(update) = update else {
        return Err(OwnedUpdaterError::new(
            OwnedUpdaterErrorCode::CheckFailed,
            "no update available",
        ));
    };

    let version = update.version.clone();
    let title = update.body.clone();
    let rid = webview.resources_table().add(update);
    Ok(CheckResult {
        version,
        title,
        rid,
    })
}

#[tauri::command]
pub async fn updater_owned_download<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, SharedOwnedUpdaterState>,
    rid: ResourceId,
    on_progress: Channel<DownloadProgress>,
) -> Result<StagedInfo, OwnedUpdaterError> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| OwnedUpdaterError::install(e.to_string()))?;

    let app = webview.app_handle().clone();
    let pubkey = baked_pubkey(&app)?;
    let base = app_data_base(&app)?;
    let (token, generation, done_tx) = state.install_fresh_token().await;

    let result = download_to_staged(&base, &update, &pubkey, &on_progress, &token).await;
    state.clear_token(generation);
    // Drop the completion sender so an aborter awaiting release resolves.
    drop(done_tx);
    result
}

async fn download_to_staged(
    base: &Path,
    update: &Update,
    pubkey: &str,
    on_progress: &Channel<DownloadProgress>,
    token: &CancellationToken,
) -> Result<StagedInfo, OwnedUpdaterError> {
    let version = validated_version(&update.version)?.to_string();
    let dir = staged_dir(base);
    std::fs::create_dir_all(&dir).map_err(|e| OwnedUpdaterError::from_io(&e))?;

    let partial = staged_partial_path(base, &version);
    let final_path = staged_artifact_path(base, &version);

    let existing_len = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| OwnedUpdaterError::install(e.to_string()))?;

    let mut request = client.get(update.download_url.clone());
    if existing_len > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing_len}-"));
    }
    let response = request
        .send()
        .await
        .map_err(|e| OwnedUpdaterError::install(e.to_string()))?;

    let server_honored_range = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let action = resume_decision(existing_len, server_honored_range);
    tracing::info!(
        version,
        counter = "updater.resume.vs.restart",
        resumed = matches!(action, ResumeAction::ResumeFrom(_)),
        "owned updater resume decision"
    );

    let content_length = response.content_length();
    let (mut file, mut received) = match action {
        ResumeAction::ResumeFrom(offset) => {
            let file = tokio::fs::OpenOptions::new()
                .append(true)
                .open(&partial)
                .await
                .map_err(|e| OwnedUpdaterError::from_io(&e))?;
            (file, offset)
        }
        ResumeAction::RestartFromZero => {
            let file = tokio::fs::File::create(&partial)
                .await
                .map_err(|e| OwnedUpdaterError::from_io(&e))?;
            (file, 0u64)
        }
    };
    // When resuming, the range response length covers only the remaining bytes.
    let total_bytes = content_length.map(|len| received + len);

    let _ = on_progress.send(DownloadProgress {
        received_bytes: received,
        total_bytes,
    });

    let mut stream = response.bytes_stream();
    loop {
        // Race cancellation against the timed read so an abort interrupts a
        // slow read immediately, not after the inactivity budget.
        let chunk = tokio::select! {
            biased;
            _ = token.cancelled() => {
                return Err(OwnedUpdaterError::new(
                    OwnedUpdaterErrorCode::DownloadAborted,
                    "download aborted",
                ));
            }
            next = tokio::time::timeout(
                std::time::Duration::from_secs(READ_INACTIVITY_SECS),
                stream.next(),
            ) => match next {
                Err(_) => {
                    tracing::warn!(version, counter = "updater.download.stall", "owned download stalled");
                    return Err(OwnedUpdaterError::new(
                        OwnedUpdaterErrorCode::DownloadStalled,
                        "download stalled: no bytes received",
                    ));
                }
                Ok(None) => break,
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(e))) => return Err(OwnedUpdaterError::install(e.to_string())),
            },
        };

        file.write_all(&chunk)
            .await
            .map_err(|e| OwnedUpdaterError::from_io(&e))?;
        received += chunk.len() as u64;
        let _ = on_progress.send(DownloadProgress {
            received_bytes: received,
            total_bytes,
        });
    }

    // Terminal progress: with no Content-Length the TS layer never saw
    // received == total. Emit total == received so it flips to "verifying".
    let _ = on_progress.send(DownloadProgress {
        received_bytes: received,
        total_bytes: Some(received),
    });

    file.flush()
        .await
        .map_err(|e| OwnedUpdaterError::from_io(&e))?;
    drop(file);

    let bytes = std::fs::read(&partial).map_err(|e| OwnedUpdaterError::from_io(&e))?;
    let sha256 = sha256_hex(&bytes);
    verify_signature(&bytes, &update.signature, pubkey)?;

    std::fs::rename(&partial, &final_path).map_err(|e| OwnedUpdaterError::from_io(&e))?;

    let info = StagedInfo {
        version: version.clone(),
        sha256,
        byte_length: bytes.len() as u64,
        signature: update.signature.clone(),
        staged_at: chrono::Utc::now().to_rfc3339(),
    };
    let sidecar =
        serde_json::to_vec(&info).map_err(|e| OwnedUpdaterError::install(e.to_string()))?;
    std::fs::write(staged_sidecar_path(base, &version), sidecar)
        .map_err(|e| OwnedUpdaterError::from_io(&e))?;

    Ok(info)
}

#[tauri::command]
pub async fn updater_owned_abort(
    state: State<'_, SharedOwnedUpdaterState>,
) -> Result<bool, OwnedUpdaterError> {
    Ok(state.abort().await)
}

#[tauri::command]
pub async fn updater_staged_status<R: Runtime>(
    app: AppHandle<R>,
    version: String,
) -> Result<Option<StagedInfo>, OwnedUpdaterError> {
    validated_version(&version)?;
    let pubkey = baked_pubkey(&app)?;
    let base = app_data_base(&app)?;
    Ok(validate_staged(&base, &version, &pubkey))
}

#[tauri::command]
pub async fn updater_owned_install<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    version: String,
) -> Result<(), OwnedUpdaterError> {
    validated_version(&version)?;
    let app = webview.app_handle().clone();
    let pubkey = baked_pubkey(&app)?;
    let base = app_data_base(&app)?;

    let artifact = staged_artifact_path(&base, &version);
    let sidecar_raw = std::fs::read(staged_sidecar_path(&base, &version))
        .map_err(|_| OwnedUpdaterError::install("no staged artifact to install"))?;
    let sidecar: StagedInfo = serde_json::from_slice(&sidecar_raw)
        .map_err(|e| OwnedUpdaterError::install(e.to_string()))?;
    let bytes = std::fs::read(&artifact).map_err(|e| OwnedUpdaterError::from_io(&e))?;

    // Re-verify immediately before install: the file may have been tampered
    // with or truncated since it was written.
    verify_artifact(&bytes, &sidecar.sha256, &sidecar.signature, &pubkey)?;

    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| OwnedUpdaterError::install(e.to_string()))?;

    update
        .install(&bytes)
        .map_err(|e| OwnedUpdaterError::install(e.to_string()))?;

    cleanup_staged(&base, &version);
    Ok(())
}

#[cfg(test)]
#[path = "updater_owned_tests.rs"]
mod tests;
