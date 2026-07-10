//! Agent catalog schema (schemaVersion 2): the probe-generated WHICH
//! document — harness version pins, model rows, per-model option matrices,
//! and ordered auth contexts with observed availability. Shapes mirror the
//! build-catalog output (`scripts/agent-catalog/catalog.draft.json`);
//! cross-field invariants live in `validation.rs`, parse entry in
//! `loader.rs`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::domains::agents::model::ModelCatalogStatus;

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
    /// The shipped default agent kind when the user has no stored preference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_agent_kind: Option<String>,
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
    /// Per-harness advanced settings (v1: boolean toggles mapped to CLI flags or
    /// env vars). Absent when a harness declares no settings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub settings: Vec<AgentCatalogSetting>,
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

/// One platform's resolved download for a `Binary`/`Archive` source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogPinTarget {
    /// Keyed in `targets` by the registry platform key (`macos_arm64`, …).
    pub url: String,
    pub sha256: String,
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
    /// (decisions ledger 13). Route facts are collected in layer 1 beside the
    /// env facts, never inside `classify()`, so purity holds.
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
    /// The control universe: every key/value any model of this harness might
    /// support. Per-model matrices are subsets of this.
    #[serde(default)]
    pub controls: Vec<AgentCatalogSessionControl>,
    #[serde(default)]
    pub models: Vec<AgentCatalogModel>,
    /// Curation-owned default model per auth-context id.
    #[serde(default)]
    pub defaults: BTreeMap<String, String>,
    /// Probe-owned: the model actually selected at session start per probed
    /// auth context. Curation input only, never consumed by the runtime.
    #[serde(default)]
    pub observed_defaults: BTreeMap<String, String>,
    /// Per-harness gateway curation (present on gateway-capable agents). Carries
    /// the compat-group `providers` filter, model-role pins (`roles`, e.g.
    /// `small_fast`) that used to live in Rust consts, and `seedModels` — the
    /// pre-probe fallback model list. The gateway model default itself lives in
    /// `defaults["gateway"]`. Consumed by the runtime gateway resolver.
    #[serde(default)]
    pub gateway_policy: Option<AgentCatalogGatewayPolicy>,
}

/// Gateway-route curation for one harness (spec §1). All fields optional:
/// `providers` empty/absent means "all providers"; `roles` and `seed_models`
/// default empty.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogGatewayPolicy {
    /// The compat group the gateway serves for this harness (e.g.
    /// `["anthropic"]` for claude, `["anthropic","openai"]` for codex). Empty
    /// means no filter — every probed/seed model is offered.
    #[serde(default)]
    pub providers: Vec<String>,
    /// Model-role pins formerly hard-coded in Rust (currently only claude's
    /// `small_fast`). Keyed by role name.
    #[serde(default)]
    pub roles: BTreeMap<String, String>,
    /// The fallback model ids used before the first live gateway probe
    /// succeeds (opencode's four-entry Anthropic fallback list).
    #[serde(default)]
    pub seed_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSessionControl {
    pub key: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub mapping: Option<AgentCatalogControlMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlMapping {
    #[serde(default)]
    pub create_field: Option<String>,
    #[serde(default)]
    pub live_config_id: Option<String>,
    /// Model control only: `setSessionModel` | `configOption`, as observed
    /// by the probe.
    #[serde(default)]
    pub switch_via: Option<String>,
    /// e.g. `"slash-effort"` (codex) or `"bracket-params"` (cursor).
    #[serde(default)]
    pub variant_syntax: Option<String>,
    #[serde(default)]
    pub missing_live_config_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogModel {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Display-only grouping tag; never used for resolution or fallback.
    #[serde(default)]
    pub family: Option<String>,
    pub availability: AgentCatalogAvailability,
    #[serde(default)]
    pub default_visible: bool,
    /// The per-model option matrix: control key -> exactly the values this
    /// model supports. A key absent here means the model lacks that control.
    #[serde(default)]
    pub controls: BTreeMap<String, AgentCatalogModelControl>,
    pub status: ModelCatalogStatus,
    #[serde(default)]
    pub provenance: Option<AgentCatalogModelProvenance>,
}

/// Observed-set availability: exactly the auth contexts (incl. `"baseline"`)
/// whose probe runs contained this model. No monotonicity inference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAvailability {
    pub any_of: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogModelControl {
    pub values: Vec<String>,
    /// Curation-owned product default.
    #[serde(default)]
    pub default: Option<String>,
    /// Probe-owned session state captured after switching to this model.
    #[serde(default)]
    pub observed_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogModelProvenance {
    #[serde(default)]
    pub observed_in: Vec<String>,
    #[serde(default)]
    pub observed_in_all_contexts: Option<bool>,
    #[serde(default)]
    pub via_trial_only: Option<bool>,
    #[serde(default)]
    pub variant_ids: Vec<String>,
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

/// A declared per-harness setting (v1: boolean toggles). Applied at spawn
/// according to the mapping kind: `cli_flag` appends the flag to argv when
/// the value is `true`; `env` sets an env var to the string form of the value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSetting {
    pub key: String,
    /// v1: only `"boolean"` is supported.
    #[serde(rename = "type")]
    pub setting_type: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// The default value for this setting (JSON-typed: bool for boolean settings).
    #[serde(default)]
    pub default: serde_json::Value,
    /// Which delivery surfaces this setting is relevant to (subset of `{local, cloud}`).
    #[serde(default)]
    pub surfaces: Vec<String>,
    pub mapping: AgentCatalogSettingMapping,
}

/// How a setting value maps to the harness spawn. Externally tagged by `kind`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSettingMapping {
    pub kind: String,
    /// For `cli_flag`: the flag to append (e.g. `"--chrome"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flag: Option<String>,
    /// For `env`: the env var name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
}

#[cfg(test)]
pub(crate) fn draft_catalog_json() -> &'static str {
    include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/agent-catalog/catalog.draft.json"
    ))
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
