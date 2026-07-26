//! The probe seam: what a launch of one (harness, auth context) would get,
//! materialized under a probe-owned root instead of the live one.
//!
//! Two entry points, deliberately split by cost (model-catalog.md, "Probe
//! mechanics"):
//!
//! - [`probe_auth_material`] is **read-only** and runs on every staleness-gate
//!   evaluation. It reads `state.json`, scopes the harness's sources down to the
//!   one auth context being judged, hashes the credential values it would set,
//!   and `stat`s that context's discovery files. It creates no directory and
//!   writes no byte, so a startup pass over an all-fresh machine's 17 contexts
//!   performs 17 reads and zero writes.
//! - [`materialize_for_probe`] is **effectful** and runs only after the gate
//!   decided to probe. It renders the same recipes a launch renders and applies
//!   them under a [`ProbeScratch`] root, which removes itself on drop.
//!
//! Why the split matters: the gate needs the fingerprint, and the fingerprint is
//! a function of credential material. Computing it by materializing would put a
//! virtual key on disk every time the runtime asked "is this entry still fresh?"
//! — including the overwhelmingly common answer, "yes". Hashing in phase A makes
//! "time on disk == one probe attempt" true rather than aspirational.
//!
//! **The one substitution.** [`render_profile`] takes `runtime_home` purely as a
//! materialization root: every path it emits is a deterministic join through
//! [`materialize::revision_dir_path`] / [`materialize::claude_config_dir_path`] /
//! [`materialize::codex_native_home_path`]. Handing it the scratch root relocates
//! every env var and every [`FileSpec`] together, so the probe's configuration is
//! byte-identical to the launch's with no branch in `render.rs`. Two consequences
//! this buys for free:
//!
//! - The launch GC cannot see the scratch. `gc_old_revision_dirs` enumerates
//!   exactly `<runtime_home>/agent-auth`; `agent-auth-probe/` is a sibling.
//! - The probe's own GC is a provable no-op: a fresh scratch holds one revision
//!   dir per family, so "greatest revision strictly below current" finds nothing.
//!
//! And the hazard it removes: `claude-config/` is deliberately NOT revision-keyed,
//! so every running claude session shares it. A probe materializing into the live
//! root would write into the config dir of in-flight sessions.
//!
//! Nothing here isolates an `api_key` or OAuth context, in deliberate contrast to
//! the central `catalog-probe` CLI, which copies credential files because it must
//! reproduce a context on a machine that has no such login. On a user machine the
//! login is real; isolating it would make the observation a fiction. The governing
//! rule is: **probe env == launch env for that context — nothing added, nothing
//! subtracted, only the file root moved.**

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::domains::agents::auth::context::BASELINE_CONTEXT_ID;
use crate::domains::agents::catalog::schema::AgentCatalogAuthContext;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;

use super::materialize::{self};
use super::plan::GatewayModelPlan;
use super::profile::{AgentRuntimeAuthProfile, ResolvedSource};
use super::render::render_profile;
use super::{current_server_origin, load_effective_state, resolve_profile, RouteAuthError};

mod scoping;
mod scratch;

pub use scratch::{sweep_probe_scratch, ProbeScratch};
use scoping::{discovery_stats_for_context, scope_profile_to_context};

/// Directory holding every probe's scratch root. A **sibling** of `agent-auth/`,
/// never a child, so the launch-side revision GC never enumerates it.
const PROBE_ROOT_DIR: &str = "agent-auth-probe";

/// The pseudo-name a gateway key is digested under. The gateway recipes set the
/// key into different vars per harness (`ANTHROPIC_AUTH_TOKEN`,
/// `PROLIFERATE_GATEWAY_KEY`, `XAI_API_KEY`), and which var it lands in is not
/// part of the credential's identity — the key material is. Naming it once keeps
/// the fingerprint stable across a recipe change that only moves the var.
const GATEWAY_KEY_DIGEST_NAME: &str = "gateway.key";

// ---------------------------------------------------------------------------
// PHASE A — read-only. Called on EVERY gate evaluation. Writes nothing.
// ---------------------------------------------------------------------------

/// Fingerprint inputs for one (harness, auth context): a pure read of
/// `state.json` plus a `stat` per discovery file. No scratch dir, no
/// [`FileSpec`], no plaintext out. This is the ONLY thing the staleness gate is
/// allowed to call.
///
/// [`FileSpec`]: super::materialize::FileSpec
pub fn probe_auth_material(
    runtime_home: &Path,
    harness_kind: &str,
    auth_context_id: &str,
    catalog_contexts: &[AgentCatalogAuthContext],
) -> Result<ProbeAuthMaterial, RouteAuthError> {
    probe_auth_material_for_server(
        runtime_home,
        harness_kind,
        auth_context_id,
        catalog_contexts,
        current_server_origin().as_deref(),
    )
}

/// Core of [`probe_auth_material`], parameterized on the current server origin so
/// the desktop server-switch guard is unit-testable without mutating
/// process-global env (this crate's tests run concurrently).
///
/// The guard is not optional here: a desktop mid-server-switch would otherwise
/// materialize a just-abandoned server's virtual key and record its model list as
/// this machine's truth.
pub(crate) fn probe_auth_material_for_server(
    runtime_home: &Path,
    harness_kind: &str,
    auth_context_id: &str,
    catalog_contexts: &[AgentCatalogAuthContext],
    current_server_origin: Option<&str>,
) -> Result<ProbeAuthMaterial, RouteAuthError> {
    let state = load_effective_state(runtime_home, current_server_origin)?;
    let state_revision = state.as_ref().map(|state| state.revision).unwrap_or(0);
    let profile = resolve_profile(state.as_ref(), harness_kind)?;
    let scoped = scope_profile_to_context(&profile, auth_context_id, catalog_contexts)?;

    let mut env_value_digests = Vec::new();
    let mut gateway_base_url = None;
    if let AgentRuntimeAuthProfile::Sources(sources) = &scoped {
        for source in &sources.sources {
            match source {
                ResolvedSource::ApiKey(profile) => env_value_digests
                    .push((profile.env_var_name.clone(), sha256_hex(&profile.value))),
                ResolvedSource::Gateway(profile) => {
                    env_value_digests
                        .push((GATEWAY_KEY_DIGEST_NAME.to_string(), sha256_hex(&profile.key)));
                    gateway_base_url = Some(profile.base_url.clone());
                }
            }
        }
    }
    env_value_digests.sort();

    Ok(ProbeAuthMaterial {
        harness_kind: harness_kind.to_string(),
        auth_context_id: auth_context_id.to_string(),
        env_value_digests,
        gateway_base_url,
        discovery_stats: discovery_stats_for_context(auth_context_id, catalog_contexts),
        state_revision,
        scoped_profile: scoped,
    })
}

/// Hashes and non-secret shape only. No plaintext credential ever leaves this
/// struct, so nothing downstream can log one — and the manual [`std::fmt::Debug`]
/// below is part of that guarantee, not decoration: the scoped profile it holds
/// privately DOES carry plaintext, and a derived `Debug` would print it.
pub struct ProbeAuthMaterial {
    pub harness_kind: String,
    pub auth_context_id: String,
    /// (env var name, sha256 of value), sorted by name. Values are hashed at
    /// construction; the plaintext is dropped inside [`probe_auth_material`].
    pub env_value_digests: Vec<(String, String)>,
    /// Gateway base URL — not a secret, and part of the recorded identity.
    pub gateway_base_url: Option<String>,
    /// (path, mtime_nanos, len) per discovery-backed file, `stat` only.
    ///
    /// mtime + size rather than content, deliberately: digesting
    /// `~/.claude/.credentials.json` would read a user's OAuth token into this
    /// process for no functional gain, and the keychain-backed variants would
    /// prompt the OS. Any re-login rewrites the file, so rotation is caught; the
    /// residual false-negative window is what the TTL covers.
    pub discovery_stats: Vec<(PathBuf, i128, u64)>,
    /// The `state.json` revision this material was read at. Carried so ONE state
    /// read serves the gate, the plan lookup and the scratch's revision-keyed
    /// dirs — they cannot drift onto different revisions.
    pub state_revision: i64,
    /// The scoped profile, retained privately so phase B never re-reads
    /// `state.json` and so the observation cannot disagree with what the gate
    /// decided on.
    scoped_profile: AgentRuntimeAuthProfile,
}

impl std::fmt::Debug for ProbeAuthMaterial {
    /// Deliberately omits `scoped_profile`: it holds raw keys. Every other field
    /// is already a digest, a path, or a non-secret URL.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProbeAuthMaterial")
            .field("harness_kind", &self.harness_kind)
            .field("auth_context_id", &self.auth_context_id)
            .field("env_value_digests", &self.env_value_digests)
            .field("gateway_base_url", &self.gateway_base_url)
            .field("discovery_stats", &self.discovery_stats)
            .field("state_revision", &self.state_revision)
            .field("scoped_profile", &"<redacted>")
            .finish()
    }
}

impl ProbeAuthMaterial {
    /// True when this context resolves to the harness's own login (nothing to
    /// inject). Exposed because the status surface distinguishes "we materialized
    /// a route" from "we observed the user's own credentials".
    pub fn is_native(&self) -> bool {
        matches!(self.scoped_profile, AgentRuntimeAuthProfile::Native)
    }
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// PHASE B — effectful. Called ONLY after the gate decided to probe.
// ---------------------------------------------------------------------------

/// Materialize exactly what a launch of this (harness, context) would get, with
/// ONE substitution: every file lands under a probe-owned scratch root instead of
/// the live runtime home. Takes the phase-A material so the observation and the
/// fingerprint are provably the same read.
///
/// `runtime_home` is READ-ONLY here apart from `agent-auth-probe/`: it is the
/// `state.json` root, and the root `probe_agent` resolves the install from.
pub fn materialize_for_probe(
    runtime_home: &Path,
    harness_kind: &str,
    material: &ProbeAuthMaterial,
    plan: &GatewayModelPlan,
) -> Result<ProbeAuthMaterialization, RouteAuthError> {
    let scratch = ProbeScratch::create(runtime_home, harness_kind, &material.auth_context_id)?;
    let rendered = render_profile(
        &material.scoped_profile,
        harness_kind,
        plan,
        scratch.root(),
    )?;
    for spec in &rendered.files {
        materialize::apply_file_spec(scratch.root(), spec)?;
    }
    let mut env_remove = rendered.remove;
    for key in baseline_scrub(harness_kind, &material.auth_context_id) {
        if !env_remove.contains(&key) {
            env_remove.push(key);
        }
    }
    Ok(ProbeAuthMaterialization {
        env_set: rendered.set,
        env_remove,
        scratch,
    })
}

pub struct ProbeAuthMaterialization {
    /// Injected into `ProbeOptions.auth_env`.
    pub env_set: BTreeMap<String, String>,
    /// Injected into `ProbeOptions.auth_env_remove`, which reaches the child via
    /// `LaunchEnv.route_auth_remove`.
    ///
    /// Carrying this is not polish. `sanitize_claude_ambient` is half of every
    /// non-native claude recipe — it strips `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/
    /// `_FOUNDRY`, `AWS_BEARER_TOKEN_BEDROCK` and any Anthropic selector the route
    /// did not itself set. A probe that dropped removals would observe Bedrock's
    /// menu on a Bedrock-exporting developer machine and record it as gateway (or
    /// `anthropic-api`) truth.
    pub env_remove: Vec<String>,
    /// Owns cleanup. Dropping this removes every file written above.
    pub scratch: ProbeScratch,
}

/// `baseline` means "no credentials at all", but the runtime process inherits a
/// developer's shell. Remove every registry-declared credential var for this
/// harness so the observation is what a credential-less user would see.
///
/// Per-child removal only (`Command::env_remove`). The central CLI mutates its own
/// process env for this; inside a long-lived server that would blind every later
/// credential classification.
///
/// Discovery *files* need no scrub: `baseline` is only ever active when no context
/// matched any slot, i.e. when those files are absent by construction.
fn baseline_scrub(harness_kind: &str, auth_context_id: &str) -> Vec<String> {
    if auth_context_id != BASELINE_CONTEXT_ID {
        return Vec::new();
    }
    let Some(agent) = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == harness_kind)
    else {
        return Vec::new();
    };
    let mut names: Vec<String> = agent
        .auth
        .slots
        .iter()
        .flat_map(|slot| slot.env_vars.iter())
        .map(|env_var| env_var.name().to_string())
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
#[path = "probe_materialization_tests/mod.rs"]
mod probe_materialization_tests;
