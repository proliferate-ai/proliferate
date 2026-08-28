//! Distribution, auth-signature, and presentation catalog schema.
//!
//! Executable model/control/default membership is deliberately absent. The
//! target-observed launch-options store is the only authority for those
//! values; presentation rows join by exact id and cannot add membership.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogDocument {
    /// Early drafts may omit the field; it defaults to the only supported
    /// version.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub catalog_version: String,
    /// Pairing with the registry document the probe ran against. The
    /// registry version is `None` while the probe pipeline does not yet pin
    /// one; registry cross-checks are then deferred (see `validation.rs`).
    #[serde(default)]
    pub probed_against: Option<AgentCatalogProbedAgainst>,
    pub generated_at: String,
    #[serde(default)]
    pub agents: Vec<AgentCatalogAgent>,
}

fn default_schema_version() -> u32 {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogProbedAgainst {
    #[serde(default)]
    pub registry_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAgent {
    pub kind: String,
    pub display_name: String,
    pub harness: AgentCatalogHarnessPins,
    /// Ordered: list position is harness credential precedence (first match
    /// wins per auth slot when the runtime classifies credential facts).
    #[serde(default)]
    pub auth_contexts: Vec<AgentCatalogAuthContext>,
    pub session: AgentCatalogSession,
    pub provenance: AgentCatalogAgentProvenance,
}

/// The pin block: exact versions the probe validated and reconcile installs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogHarnessPins {
    pub agent_process: AgentCatalogArtifactPin,
    #[serde(default)]
    pub native: Option<AgentCatalogArtifactPin>,
    #[serde(default)]
    pub data: Option<AgentCatalogDataPin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogArtifactPin {
    pub version: String,
    /// Legacy single-hash field; superseded by `source`. Kept for migration so
    /// pre-lockfile catalogs still parse.
    #[serde(default)]
    pub sha256: Option<String>,
    /// The resolved, fenced install source (the lockfile's executable truth).
    /// When present, install materializes EXACTLY this — sha256-verified — and
    /// never consults registry install specs. When absent, the legacy
    /// registry-spec path is used (deleted once every pin carries a source).
    #[serde(default)]
    pub source: Option<AgentCatalogArtifactSource>,
}

/// Resolved install source for one artifact. The per-target `sha256` is the
/// trust anchor: install downloads the url, verifies the hash, and refuses
/// anything else — so a url living in the catalog cannot fetch unintended bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentCatalogArtifactSource {
    /// A single executable: download + chmod. Per-platform url+sha.
    Binary {
        targets: BTreeMap<String, AgentCatalogPinTarget>,
    },
    /// A tar/zip archive: extract + find `expectedBinary`. Per-platform url+sha.
    Archive {
        targets: BTreeMap<String, AgentCatalogPinTarget>,
        /// ACP-mode launch args baked into the managed launcher (e.g. `["acp"]`
        /// for a registry-backed adapter binary). Empty for a native CLI.
        #[serde(default)]
        args: Vec<String>,
        /// Sidecar archives installed beside the main binary, each pinned per
        /// platform like `targets` (codex's `codex-code-mode-host`).
        #[serde(default)]
        companions: Vec<AgentCatalogArchiveCompanion>,
    },
    /// An npm-registry package pinned to an exact version.
    Npm {
        package: String,
        #[serde(default)]
        sha256: Option<String>,
        /// ACP-mode launch args baked into the managed launcher (e.g.
        /// `["agent", "stdio"]` for grok).
        #[serde(default)]
        args: Vec<String>,
    },
    /// A git specifier (our adapter forks) installed/built from a pinned ref.
    Git {
        repo: String,
        git_ref: String,
        #[serde(default)]
        package_subdir: Option<String>,
        executable_relpath: String,
    },
}

/// A sidecar archive of an `Archive` source: installed under `name` in the
/// same managed directory, with its own per-platform url+sha.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogArchiveCompanion {
    pub name: String,
    pub targets: BTreeMap<String, AgentCatalogPinTarget>,
}

/// One platform's resolved download for a `Binary`/`Archive` source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogPinTarget {
    /// Keyed in `targets` by the registry platform key (`macos_arm64`, …).
    pub url: String,
    pub sha256: String,
    /// Exact compressed transfer size when the catalog producer can establish
    /// it. Older catalogs omit this; the installer also reads Content-Length.
    #[serde(default)]
    pub download_size_bytes: Option<u64>,
    /// For `Archive`: the binary name inside the extracted tree.
    #[serde(default)]
    pub expected_binary: Option<String>,
}

/// Pinned data dependency that gates model lists (e.g. opencode models.dev).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogDataPin {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub snapshot_path: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAuthContext {
    /// Catalog-local id referenced by model availability. `"baseline"` is
    /// reserved: it means "no credentials at all" and carries no auth slot.
    pub id: String,
    /// References a registry auth slot on the same agent kind; required for
    /// every context except `"baseline"`.
    #[serde(default)]
    pub auth_slot_id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Declarative detection signature evaluated over the composed launch
    /// env + discovery facts. Absent on probe drafts that predate signals.
    #[serde(default)]
    pub signals: Option<AgentCatalogAuthSignal>,
}

/// The minimal probe-testable signal algebra: `env | envFlag | discovery |
/// route | anyOf | allOf` — no NOT operator, nesting depth <= 2 (enforced in
/// `validation.rs`). Externally tagged so JSON reads as
/// `{"env": "ANTHROPIC_API_KEY"}` / `{"allOf": [ ... ]}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentCatalogAuthSignal {
    /// Env var present in the composed launch env (presence only — secret
    /// values are never read).
    Env(String),
    /// `"VAR=value"`: env var present with this exact value; only valid for
    /// registry vars tagged `flag` (values readable only for flags).
    EnvFlag(String),
    /// A named discovery fact kind, e.g. `"claude-oauth-creds"`.
    Discovery(String),
    /// An enrolled runtime route kind (e.g. `"gateway"`): matches a
    /// `Route` fact resolved from workspace-scoped `agent-auth/state.json`
    /// through the launch route resolver. Route facts are collected beside
    /// env facts, never inside `classify()`, so classification stays pure.
    Route(String),
    AnyOf(Vec<AgentCatalogAuthSignal>),
    AllOf(Vec<AgentCatalogAuthSignal>),
}

impl AgentCatalogAuthSignal {
    /// Nesting depth: leaves are 1, combinators are 1 + deepest child.
    pub fn depth(&self) -> usize {
        match self {
            Self::Env(_) | Self::EnvFlag(_) | Self::Discovery(_) | Self::Route(_) => 1,
            Self::AnyOf(children) | Self::AllOf(children) => {
                1 + children.iter().map(Self::depth).max().unwrap_or(0)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSession {
    /// Curation-owned: the pinned harness version implements the GoalPort
    /// (native goals; claude >= 2.1.139, codex >= 0.133). Version-level
    /// declaration only — the runtime capability is the sidecar's
    /// initialize `_meta.anyharness.goals` advertisement.
    #[serde(default)]
    pub supports_goals: bool,
    /// Optional display-only metadata keyed by exact observed model id.
    #[serde(default)]
    pub presentation_models: Vec<AgentCatalogPresentationModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogPresentationModel {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAgentProvenance {
    pub probed_at: String,
    /// `agent_info` from the ACP InitializeResponse during the probe; null
    /// when the harness did not attest (e.g. cursor draft data).
    #[serde(default)]
    pub attestation: Option<AgentCatalogAttestation>,
    #[serde(default)]
    pub runs: Vec<AgentCatalogProbeRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAttestation {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogProbeRun {
    pub id: String,
    #[serde(default)]
    pub snapshot_path: Option<String>,
}

#[cfg(test)]
pub(crate) fn canonical_catalog_json() -> &'static str {
    include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../catalogs/agents/catalog.json"
    ))
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
