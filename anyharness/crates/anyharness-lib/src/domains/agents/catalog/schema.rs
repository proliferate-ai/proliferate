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
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum AgentCatalogArtifactSource {
    /// A single executable: download + chmod. Per-platform url+sha.
    Binary {
        targets: BTreeMap<String, AgentCatalogPinTarget>,
    },
    /// A tar/zip archive: extract + find `expectedBinary`. Per-platform url+sha.
    Archive {
        targets: BTreeMap<String, AgentCatalogPinTarget>,
    },
    /// An npm-registry package pinned to an exact version.
    Npm {
        package: String,
        #[serde(default)]
        sha256: Option<String>,
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
/// anyOf | allOf` — no NOT operator, nesting depth <= 2 (enforced in
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
    AnyOf(Vec<AgentCatalogAuthSignal>),
    AllOf(Vec<AgentCatalogAuthSignal>),
}

impl AgentCatalogAuthSignal {
    /// Nesting depth: leaves are 1, combinators are 1 + deepest child.
    pub fn depth(&self) -> usize {
        match self {
            Self::Env(_) | Self::EnvFlag(_) | Self::Discovery(_) => 1,
            Self::AnyOf(children) | Self::AllOf(children) => {
                1 + children.iter().map(Self::depth).max().unwrap_or(0)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSession {
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

#[cfg(test)]
pub(crate) fn draft_catalog_json() -> &'static str {
    include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/agent-catalog/catalog.draft.json"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_draft() -> AgentCatalogDocument {
        serde_json::from_str(draft_catalog_json()).expect("draft catalog must parse")
    }

    #[test]
    fn draft_catalog_parses_with_expected_shape() {
        let catalog = parse_draft();

        assert_eq!(catalog.schema_version, 2);
        assert_eq!(catalog.catalog_version, draft_catalog_version().as_str());
        let probed_against = catalog.probed_against.as_ref().expect("probedAgainst");
        assert_eq!(
            probed_against.registry_version.as_deref(),
            Some(bundled_registry_version().as_str())
        );
        assert_eq!(catalog.agents.len(), 6);

        let claude = &catalog.agents[0];
        assert_eq!(claude.kind, "claude");
        assert_eq!(claude.harness.agent_process.version, "0.29.0");
        assert_eq!(
            claude
                .harness
                .native
                .as_ref()
                .map(|pin| pin.version.as_str()),
            Some("2.1.170 (Claude Code)")
        );
        assert_eq!(
            claude
                .auth_contexts
                .iter()
                .map(|context| context.id.as_str())
                .collect::<Vec<_>>(),
            vec!["bedrock", "anthropic-api", "anthropic-oauth"]
        );
        let sonnet = &claude.session.models[0];
        assert_eq!(sonnet.id, "sonnet");
        assert_eq!(sonnet.availability.any_of, vec!["anthropic-api"]);
        assert!(sonnet.default_visible);
        let effort = sonnet.controls.get("effort").expect("effort control");
        assert_eq!(effort.values, vec!["low", "medium", "high"]);
        assert_eq!(effort.observed_value.as_deref(), Some("high"));
        assert_eq!(effort.default, None);

        let codex = &catalog.agents[1];
        let model_control = codex
            .session
            .controls
            .iter()
            .find(|control| control.key == "model")
            .expect("model control");
        let mapping = model_control.mapping.as_ref().expect("model mapping");
        assert_eq!(mapping.switch_via.as_deref(), Some("setSessionModel"));
        assert_eq!(mapping.variant_syntax.as_deref(), Some("slash-effort"));
        // Variant families are draft data — anchor on the stable shape, not a
        // fixed model id (the probed model list moves between catalog runs).
        let with_variants = codex
            .session
            .models
            .iter()
            .find(|model| {
                model
                    .provenance
                    .as_ref()
                    .is_some_and(|provenance| !provenance.variant_ids.is_empty())
            })
            .expect("some codex model carries variant ids");
        let provenance = with_variants.provenance.as_ref().expect("provenance");
        assert!(provenance
            .variant_ids
            .iter()
            .any(|variant| variant.starts_with(&format!("{}/", with_variants.id))));

        let cursor = &catalog.agents[2];
        assert!(cursor.provenance.attestation.is_none());
        assert!(cursor.harness.native.is_none());

        let opencode = &catalog.agents[5];
        assert!(opencode
            .auth_contexts
            .iter()
            .any(|context| context.id == "baseline" && context.auth_slot_id.is_none()));
        assert_eq!(
            opencode
                .session
                .observed_defaults
                .get("baseline")
                .map(String::as_str),
            Some("opencode/big-pickle")
        );
    }

    #[test]
    fn auth_signals_round_trip_bedrock_all_of_example() {
        // The bedrock-style signature from the migration doc (§5.4).
        let json = serde_json::json!({
            "allOf": [
                { "envFlag": "CLAUDE_CODE_USE_BEDROCK=1" },
                { "discovery": "aws-credential-chain" }
            ]
        });

        let signal: AgentCatalogAuthSignal =
            serde_json::from_value(json.clone()).expect("bedrock signal must parse");

        assert_eq!(
            signal,
            AgentCatalogAuthSignal::AllOf(vec![
                AgentCatalogAuthSignal::EnvFlag("CLAUDE_CODE_USE_BEDROCK=1".to_string()),
                AgentCatalogAuthSignal::Discovery("aws-credential-chain".to_string()),
            ])
        );
        assert_eq!(signal.depth(), 2);
        assert_eq!(serde_json::to_value(&signal).expect("serialize"), json);
    }

    #[test]
    fn auth_signals_round_trip_any_of_and_leaves() {
        let json = serde_json::json!({
            "anyOf": [
                { "env": "CLAUDE_CODE_OAUTH_TOKEN" },
                { "discovery": "claude-oauth-creds" }
            ]
        });

        let signal: AgentCatalogAuthSignal =
            serde_json::from_value(json.clone()).expect("oauth signal must parse");

        assert_eq!(signal.depth(), 2);
        assert_eq!(serde_json::to_value(&signal).expect("serialize"), json);

        let leaf: AgentCatalogAuthSignal =
            serde_json::from_value(serde_json::json!({ "env": "ANTHROPIC_API_KEY" }))
                .expect("leaf signal must parse");
        assert_eq!(
            leaf,
            AgentCatalogAuthSignal::Env("ANTHROPIC_API_KEY".to_string())
        );
        assert_eq!(leaf.depth(), 1);
    }

    fn bundled_registry_version() -> String {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../catalogs/agents/registry.json"
        ))
        .expect("read bundled registry");
        serde_json::from_str::<serde_json::Value>(&text).expect("parse registry")["registryVersion"]
            .as_str()
            .expect("registryVersion")
            .to_string()
    }

    fn draft_catalog_version() -> String {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../scripts/agent-catalog/catalog.draft.json"
        ))
        .expect("read draft catalog");
        serde_json::from_str::<serde_json::Value>(&text).expect("parse draft")["catalogVersion"]
            .as_str()
            .expect("catalogVersion")
            .to_string()
    }
}
