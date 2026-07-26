//! `model-snapshot.json`: what this machine's harness advertised, per auth
//! context, at a known time — and what install it was observed on.
//!
//! One document per harness, in the harness's managed directory beside the
//! `install-manifest.json` whose identity it records. camelCase like the manifest
//! (not snake_case like `state.json`), written atomically (tmp + rename) by the
//! same convention.
//!
//! Read tolerance mirrors the manifest's, and it is a deliberate law rather than
//! laziness: an unreadable or schema-mismatched document reads as **absent**, so
//! the next trigger rewrites it whole. This is derived state — deleting it loses
//! nothing a re-probe cannot restore, and refusing to boot over a corrupt cache
//! would be strictly worse than re-probing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::domains::agents::installer::manifest::{read_manifest, InstallManifest};
use crate::domains::agents::model::ArtifactRole;

pub const MODEL_SNAPSHOT_SCHEMA_VERSION: u32 = 1;
const SNAPSHOT_FILE_NAME: &str = "model-snapshot.json";

/// The whole per-harness document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSnapshotDocument {
    pub schema_version: u32,
    pub agent: String,
    /// Keyed by catalog auth-context id — the exact strings the catalog declares
    /// and `ActiveAuthContexts` carries, never a new vocabulary.
    #[serde(default)]
    pub entries: BTreeMap<String, SnapshotEntry>,
}

impl ModelSnapshotDocument {
    pub fn empty(agent: &str) -> Self {
        Self {
            schema_version: MODEL_SNAPSHOT_SCHEMA_VERSION,
            agent: agent.to_string(),
            entries: BTreeMap::new(),
        }
    }
}

/// One (harness, auth context) observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    /// Timestamp of the last **successful** observation; the lists below are from
    /// that run. Never regresses on failure.
    pub probed_at: String,
    /// `acp` today; present so a future cheaper mechanism can coexist.
    pub mechanism: String,
    /// The ACP `initialize` `agent_info`. **Diagnostics only** — never a
    /// staleness input. See `staleness.rs` for why (the attestation and the
    /// install manifest are different namespaces).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attestation: Option<SnapshotAttestation>,
    /// The staleness baseline: the install manifest's `agent_process` artifact as
    /// read at probe time. `None` when the manifest carried none (a `source:
    /// "path"` dev install, or no manifest at all), which makes the identity
    /// comparison Indeterminate rather than stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_identity: Option<InstallIdentity>,
    /// Digest of the credential material this context resolved to at probe time.
    /// Never leaves the runtime: the wire contract is the boolean `stale` plus its
    /// reason.
    pub auth_fingerprint: String,
    #[serde(default)]
    pub models: Vec<SnapshotModel>,
    #[serde(default)]
    pub modes: Vec<SnapshotMode>,
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
///
/// Both sides of the staleness comparison come from `read_manifest`, so they are
/// in one namespace by construction — the property the design previously assumed
/// rather than established.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallIdentity {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The strictly stronger signal: it hashes what was actually installed, so it
    /// moves even when a version string is reused (a `latest` npm republish, a
    /// re-pinned git sha).
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
        let role = crate::domains::agents::installer::manifest::role_name(
            &ArtifactRole::AgentProcess,
        );
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
/// unparseable manifest, and manifest-without-agent_process all yield `None` —
/// each of which the staleness gate treats as Indeterminate.
pub fn install_identity_of(runtime_home: &Path, harness_kind: &str) -> Option<InstallIdentity> {
    InstallIdentity::from_manifest(&read_manifest(runtime_home, harness_kind)?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotModel {
    pub id: String,
    /// Preserved verbatim when the harness namespaces (`provider/model`), derived
    /// from the serving context otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The per-model ACP option matrix. `null` for runtime probes, which do not
    /// switch models (`switch_models: false`) — control wiring is
    /// catalog-authoritative anyway.
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
/// state reads as absent (model-catalog.md, "Failure modes": "Machine document
/// unreadable or schema-mismatched: treated as absent; the next trigger rewrites
/// it whole").
pub fn read_document(runtime_home: &Path, harness_kind: &str) -> Option<ModelSnapshotDocument> {
    let text = std::fs::read_to_string(snapshot_path(runtime_home, harness_kind)).ok()?;
    let document: ModelSnapshotDocument = serde_json::from_str(&text).ok()?;
    (document.schema_version == MODEL_SNAPSHOT_SCHEMA_VERSION).then_some(document)
}

/// Merge one entry into the document and write it atomically.
///
/// Read-modify-write rather than a partial update because the document is small
/// (one harness, at most six contexts) and the alternative — a per-entry file —
/// would multiply the corrupt-read surface for no gain.
pub fn write_entry(
    runtime_home: &Path,
    harness_kind: &str,
    auth_context_id: &str,
    entry: SnapshotEntry,
) -> std::io::Result<()> {
    let mut document =
        read_document(runtime_home, harness_kind).unwrap_or_else(|| ModelSnapshotDocument::empty(harness_kind));
    // A document that somehow carries another harness's name is not authority for
    // this one; adopt the requested kind rather than propagating the confusion.
    document.agent = harness_kind.to_string();
    document.schema_version = MODEL_SNAPSHOT_SCHEMA_VERSION;
    document
        .entries
        .insert(auth_context_id.to_string(), entry);
    write_document(runtime_home, harness_kind, &document)
}

/// tmp + rename, mirroring `installer::manifest`. The tmp name carries a uuid so
/// two writers cannot collide on it, and a truncated tmp left by a crash is never
/// a candidate for [`read_document`] (which only ever opens the final name).
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
    match std::fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            Err(error)
        }
    }
}
