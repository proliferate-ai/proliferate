//! `model-snapshot.json`: what this machine's harness advertised when spawned
//! into its current composed auth world, at a known time — and what install it
//! was observed on.
//!
//! **One observation per harness — there is no per-context map.** The document
//! lives in the harness's managed directory beside the `install-manifest.json`
//! whose identity it records. camelCase like the manifest (not snake_case like
//! `state.json`), written atomically (tmp + rename) by the same convention.
//!
//! Read tolerance mirrors the manifest's, and it is a deliberate law rather than
//! laziness: an unreadable or schema-mismatched document reads as **absent**, so
//! the next probe rewrites it whole. A schemaVersion-1 document (the superseded
//! per-context `entries` map) is exactly such a mismatch. This is derived state —
//! deleting it loses nothing a re-probe cannot restore, and refusing to boot over
//! a corrupt cache would be strictly worse than re-probing.
//!
//! The provenance fields (`attestation`, `installIdentity`, `stateRevision`) are
//! **not gates**: they exist so a human debugging "why does the picker show X"
//! can line the observation up against the state file and the install manifest,
//! and so the Worker upload can skip unchanged documents. Nothing computes
//! freshness from them — freshness is event-driven.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::domains::agents::installer::manifest::{read_manifest, InstallManifest};
use crate::domains::agents::model::ArtifactRole;

pub const MODEL_SNAPSHOT_SCHEMA_VERSION: u32 = 2;
const SNAPSHOT_FILE_NAME: &str = "model-snapshot.json";

/// The whole per-harness document: one composed observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSnapshotDocument {
    pub schema_version: u32,
    pub agent: String,
    /// Timestamp of the last **successful** observation; the lists below are from
    /// that run. Never regresses on failure.
    pub probed_at: String,
    /// The ACP `initialize` `agent_info` — provenance about the binary that
    /// answered. Diagnostics only, never a gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attestation: Option<SnapshotAttestation>,
    /// The install manifest's `agent_process` artifact read at probe time —
    /// provenance about the install that answered. `None` when the manifest
    /// carried none (a `source: "path"` dev install, or no manifest at all).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_identity: Option<InstallIdentity>,
    /// The `state.json` revision the probe materialized under (`0` = no document
    /// = native) — provenance about the auth world that answered.
    #[serde(default)]
    pub state_revision: i64,
    #[serde(default)]
    pub models: Vec<SnapshotModel>,
    #[serde(default)]
    pub modes: Vec<SnapshotMode>,
    /// What the harness itself selected at probe time — curator input only,
    /// never served to users.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_defaults: Option<SnapshotObservedDefaults>,
    #[serde(default)]
    pub warnings: Vec<String>,
    /// The most recent attempt of ANY outcome. A failed refresh updates this and
    /// nothing else, so the last good lists keep serving.
    pub last_attempt: SnapshotAttempt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAttestation {
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The install manifest's `agent_process` artifact, recorded verbatim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallIdentity {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The stronger identity signal: it hashes what was actually installed, so
    /// it moves even when a version string is reused (a `latest` npm republish,
    /// a re-pinned git sha).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub source: String,
}

impl InstallIdentity {
    /// The current `agent_process` identity for a harness, or `None` when the
    /// manifest has no such artifact. `None` is a legitimate answer, not an
    /// error: `readiness/versions.rs` deliberately refuses to fill a version for
    /// a `source: "path"` dev install.
    pub fn from_manifest(manifest: &InstallManifest) -> Option<Self> {
        let role =
            crate::domains::agents::installer::manifest::role_name(&ArtifactRole::AgentProcess);
        let artifact = manifest
            .artifacts
            .iter()
            .find(|artifact| artifact.role == role)?;
        Some(Self {
            role: artifact.role.clone(),
            version: artifact.version.clone(),
            sha256: artifact.sha256.clone(),
            source: artifact.source.clone(),
        })
    }
}

/// Read the harness's current install identity from disk. Absent manifest,
/// unparseable manifest, and manifest-without-agent_process all yield `None`.
pub fn install_identity_of(runtime_home: &Path, harness_kind: &str) -> Option<InstallIdentity> {
    InstallIdentity::from_manifest(&read_manifest(runtime_home, harness_kind)?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotModel {
    pub id: String,
    /// Preserved verbatim when the harness namespaces (`provider/model`), absent
    /// otherwise rather than guessed — the frontend must never infer origin from
    /// a model name or the harness kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The per-model ACP option matrix, carried verbatim where the harness
    /// reports one. `null` for runtime probes, which do not switch models
    /// (`switch_models: false`) — control wiring is catalog-authoritative anyway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMode {
    pub id: String,
    pub name: String,
}

/// What the harness itself selected at probe time — curator input only, never
/// served to users.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotObservedDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttemptOutcome {
    Ok,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAttempt {
    pub at: String,
    pub outcome: AttemptOutcome,
    /// Failure detail (`"timeout"`, an error string). `None` on success.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub fn snapshot_path(runtime_home: &Path, harness_kind: &str) -> PathBuf {
    runtime_home
        .join("agents")
        .join(harness_kind)
        .join(SNAPSHOT_FILE_NAME)
}

/// Read the document if present, parseable, and schema-matched. **Any** other
/// state — including a v1 per-context document — reads as absent (model-catalog.md,
/// "Failure modes": "Machine document unreadable or schema-mismatched: treated as
/// absent; the next probe rewrites it whole").
pub fn read_document(runtime_home: &Path, harness_kind: &str) -> Option<ModelSnapshotDocument> {
    let text = std::fs::read_to_string(snapshot_path(runtime_home, harness_kind)).ok()?;
    let document: ModelSnapshotDocument = serde_json::from_str(&text).ok()?;
    (document.schema_version == MODEL_SNAPSHOT_SCHEMA_VERSION).then_some(document)
}

/// tmp + rename + chmod 0600, mirroring `installer::manifest`'s atomicity and
/// `state.json`'s privacy. The tmp name carries a uuid so two writers cannot
/// collide on it, and a truncated tmp left by a crash is never a candidate for
/// [`read_document`] (which only ever opens the final name).
///
/// **0600, not 0644.** The document carries harness-controlled failure text in
/// `lastAttempt.detail` (redacted, but defense stays in depth) and per-account
/// capability detail a co-tenant process has no business reading. `state.json`
/// next door is 0600; matching it costs one chmod.
///
/// The permission is set on the TMP file before the rename, so the document is
/// never briefly world-readable at its final path.
pub fn write_document(
    runtime_home: &Path,
    harness_kind: &str,
    document: &ModelSnapshotDocument,
) -> std::io::Result<()> {
    let path = snapshot_path(runtime_home, harness_kind);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(document)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let tmp = path.with_extension(format!("json.tmp-{}", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, json)?;
    if let Err(error) = set_private_permissions(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    match std::fs::rename(&tmp, &path) {
        // Re-applied after the rename for the same reason the route-auth writer
        // does: an existing target's mode survives a rename on some filesystems.
        Ok(()) => set_private_permissions(&path),
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            Err(error)
        }
    }
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
