//! The probe seam: what a launch of one harness would get, materialized under a
//! probe-owned root instead of the live one.
//!
//! Two entry points, split by cost (target-observed launch-options ADR):
//!
//! - [`probe_auth_material`] is **read-only**: it reads `state.json` and resolves
//!   the harness's FULL COMPOSED profile — every enabled source, exactly what a
//!   launch resolves. It creates no directory and writes no byte.
//! - [`materialize_for_probe`] is **effectful** and runs only when the engine has
//!   decided to probe. It renders the same recipes a launch renders and applies
//!   them under a [`ProbeScratch`] root, which removes itself on drop.
//!
//! **The one substitution.** [`render_profile`] takes `runtime_home` purely as a
//! materialization root: every path it emits is a deterministic join through
//! [`materialize::revision_dir_path`] / [`materialize::claude_config_dir_path`].
//! Handing it the scratch root relocates every routed env var and every
//! [`FileSpec`] together, so the probe's auth configuration is byte-identical to
//! the launch's with no branch in `render.rs`. Two consequences this buys for
//! free:
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
//! Nothing here scopes the profile to one auth source, isolates a credential, or
//! scrubs ambient vars beyond what the launch recipes themselves sanitize. The
//! per-context scoping and the attribution scrub of the superseded design are
//! deleted, deliberately: a probe answers "what would a session launched right
//! now show", and a session composes every enabled source. The governing rule:
//! **probe env == launch env — nothing added, nothing subtracted, only the file
//! root moved.**
//!
//! [`FileSpec`]: super::materialize::FileSpec

use std::collections::BTreeMap;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::materialize::{self};
use super::plan::GatewayModelPlan;
use super::profile::{AgentRuntimeAuthProfile, ResolvedSource};
use super::render::render_profile;
use super::{current_server_origin, load_effective_state, resolve_profile, RouteAuthError};

mod scratch;

pub use scratch::{sweep_probe_scratch, ProbeScratch};

/// Directory holding every probe's scratch root. A **sibling** of `agent-auth/`,
/// never a child, so the launch-side revision GC never enumerates it.
const PROBE_ROOT_DIR: &str = "agent-auth-probe";

// ---------------------------------------------------------------------------
// PHASE A — read-only: the composed state read. Writes nothing.
// ---------------------------------------------------------------------------

/// The composed auth world one probe attempt will materialize: a pure read of
/// `state.json`, resolved to the same profile a launch resolves. No scratch dir,
/// no [`FileSpec`], no plaintext out.
///
/// [`FileSpec`]: super::materialize::FileSpec
pub fn probe_auth_material(
    runtime_home: &Path,
    harness_kind: &str,
) -> Result<ProbeAuthMaterial, RouteAuthError> {
    probe_auth_material_for_server(runtime_home, harness_kind, current_server_origin().as_deref())
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
    current_server_origin: Option<&str>,
) -> Result<ProbeAuthMaterial, RouteAuthError> {
    let state = load_effective_state(runtime_home, current_server_origin)?;
    let state_revision = state.as_ref().map(|state| state.revision).unwrap_or(0);
    let profile = resolve_profile(state.as_ref(), harness_kind)?;

    let mut env_value_digests = Vec::new();
    if let AgentRuntimeAuthProfile::Sources(sources) = &profile {
        for source in &sources.sources {
            match source {
                ResolvedSource::ApiKey(profile) => {
                    env_value_digests.push(credential_value_digest(&profile.value))
                }
                ResolvedSource::Gateway(profile) => {
                    env_value_digests.push(credential_value_digest(&profile.key))
                }
                ResolvedSource::ProviderConfig(profile) => {
                    for value in profile.env.values() {
                        env_value_digests.push(credential_value_digest(value));
                    }
                }
                ResolvedSource::Seat(profile) => {
                    for value in profile.env.values() {
                        env_value_digests.push(credential_value_digest(value));
                    }
                }
            }
        }
    }
    env_value_digests.sort();
    env_value_digests.dedup();

    Ok(ProbeAuthMaterial {
        harness_kind: harness_kind.to_string(),
        env_value_digests,
        state_revision,
        profile,
    })
}

/// Digests and non-secret shape only. No plaintext credential ever leaves this
/// struct, so nothing downstream can log one — and the manual [`std::fmt::Debug`]
/// below is part of that guarantee, not decoration: the composed profile it holds
/// privately DOES carry plaintext, and a derived `Debug` would print it.
pub struct ProbeAuthMaterial {
    pub harness_kind: String,
    /// sha256 of every credential VALUE the composed profile would set, sorted.
    ///
    /// Not a fingerprint and never a gate (freshness is event-driven): the sole
    /// consumer is the failure-detail redactor, which needs to ask "is this token
    /// the credential we handed the harness?" without being given the credential.
    pub env_value_digests: Vec<String>,
    /// The `state.json` revision this material was read at. Carried so ONE state
    /// read serves the plan lookup, the scratch's revision-keyed dirs, and the
    /// observation's `stateRevision` provenance — they cannot drift onto
    /// different revisions.
    pub state_revision: i64,
    /// The composed profile, retained privately so phase B never re-reads
    /// `state.json` and so the observation cannot disagree with the state the
    /// engine read.
    profile: AgentRuntimeAuthProfile,
}

impl std::fmt::Debug for ProbeAuthMaterial {
    /// Deliberately omits `profile`: it holds raw keys. Every other field is
    /// already a digest or a revision number.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProbeAuthMaterial")
            .field("harness_kind", &self.harness_kind)
            .field("env_value_digests", &self.env_value_digests)
            .field("state_revision", &self.state_revision)
            .field("profile", &"<redacted>")
            .finish()
    }
}

impl ProbeAuthMaterial {
    /// True when the harness resolves to its own login (nothing to inject).
    /// Exposed for tests only: nothing on the wire consumes this. If a consumer
    /// needs the distinction, give it a real field and drop this `cfg`.
    #[cfg(test)]
    pub fn is_native(&self) -> bool {
        matches!(self.profile, AgentRuntimeAuthProfile::Native)
    }

    /// The composed profile, visible to sibling tests that compare a probe
    /// render against a launch render of the same profile.
    #[cfg(test)]
    pub(crate) fn profile(&self) -> &AgentRuntimeAuthProfile {
        &self.profile
    }
}

/// The digest a credential VALUE is recorded under.
///
/// `pub` because the failure-detail redactor downstream needs to ask "is this token
/// the credential we handed the harness?" without being given the credential. One
/// definition, so the producer and that consumer cannot drift into never matching.
pub fn credential_value_digest(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// PHASE B — effectful. Called ONLY when the engine decided to probe.
// ---------------------------------------------------------------------------

/// Materialize exactly what a launch of this harness would get, with ONE
/// substitution: every file lands under a probe-owned scratch root instead of
/// the live runtime home. Takes the phase-A material so the observation and the
/// recorded `stateRevision` are provably the same read.
///
/// `runtime_home` is READ-ONLY here apart from `agent-auth-probe/`: it is the
/// `state.json` root, and the root `probe_agent` resolves the install from.
pub fn materialize_for_probe(
    runtime_home: &Path,
    harness_kind: &str,
    material: &ProbeAuthMaterial,
    plan: &GatewayModelPlan,
) -> Result<ProbeAuthMaterialization, RouteAuthError> {
    let scratch = ProbeScratch::create(runtime_home, harness_kind)?;
    let rendered = render_profile(&material.profile, harness_kind, plan, scratch.root())?;
    for spec in &rendered.files {
        materialize::apply_file_spec(scratch.root(), spec)?;
    }
    Ok(ProbeAuthMaterialization {
        env_set: rendered.set,
        env_remove: rendered.remove,
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
    /// `anthropic-api`) truth. The recipes' sanitization is fidelity: a launch
    /// strips these too, and the probe runs the same recipe.
    pub env_remove: Vec<String>,
    /// Owns cleanup. Dropping this removes every file written above.
    pub scratch: ProbeScratch,
}

#[cfg(test)]
#[path = "probe_materialization_tests/mod.rs"]
mod probe_materialization_tests;
