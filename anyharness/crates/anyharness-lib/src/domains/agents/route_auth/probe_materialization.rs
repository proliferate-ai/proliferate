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
use crate::domains::agents::catalog::schema::{AgentCatalogAuthContext, AgentCatalogAuthSignal};
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;

use super::materialize::{self};
use super::plan::GatewayModelPlan;
use super::profile::{AgentRuntimeAuthProfile, HarnessSources, ResolvedSource};
use super::render::render_profile;
use super::{current_server_origin, load_effective_state, resolve_profile, RouteAuthError};

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
// Scoping: one flat source list -> the one context being probed.
// ---------------------------------------------------------------------------

/// How a catalog auth context wants to be materialized, decided from the
/// context's own declared signals rather than from a hardcoded per-harness set.
/// Driving it off the catalog is what keeps the seam from ever being asked for a
/// cursor gateway materialization: cursor declares no such context.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ContextShape {
    /// `{"route":"gateway"}` — the managed gateway route.
    Gateway,
    /// Contains one or more `{"env":"NAME"}` signals: a raw provider key.
    ///
    /// `discovery_fallback` is true when the context ALSO declares a discovery
    /// signal, i.e. it can be satisfied by the user's own login as well as by an
    /// injected key. Several shipped contexts are mixed this way — opencode's
    /// `anthropic-api` (`ANTHROPIC_API_KEY` or `opencode-auth-json/anthropic`) and
    /// cursor's `cursor-login` (`CURSOR_API_KEY` or the keychain).
    ///
    /// The distinction decides what an unmatched context means. For a PURE env
    /// context, no matching source is a selection the machine cannot honor. For a
    /// mixed one it is the ordinary case — the user logged in with the CLI and
    /// enrolled nothing — and a launch there renders nothing and reads the real
    /// login. Failing closed on it would turn every login-backed context on every
    /// enrolled machine into a permanent failed attempt.
    EnvNames {
        names: Vec<String>,
        discovery_fallback: bool,
    },
    /// `envFlag`, discovery-only, signal-less, or `baseline`: a launch renders no
    /// credential for these, so a probe injects none either.
    Native,
}

/// Scope a harness's resolved profile down to ONE auth context (pure).
///
/// `state.json` holds one flat source list per harness, and opencode legitimately
/// carries a gateway plus several `api_key` rows at once. The document wants one
/// entry per auth context, so a per-context probe must be handed only that
/// context's material — otherwise every opencode context's entry would be an
/// identical union and one key rotation would move all six fingerprints.
///
/// A `Native` profile scopes to `Native` for every context: the harness has no
/// enrolled selection, so a launch injects nothing and the ambient/discovered
/// credential governs. Refusing here instead would turn every ambient-key context
/// on a developer machine into a failed attempt.
fn scope_profile_to_context(
    profile: &AgentRuntimeAuthProfile,
    auth_context_id: &str,
    catalog_contexts: &[AgentCatalogAuthContext],
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let AgentRuntimeAuthProfile::Sources(sources) = profile else {
        return Ok(AgentRuntimeAuthProfile::Native);
    };
    match context_shape(auth_context_id, catalog_contexts) {
        ContextShape::Native => Ok(AgentRuntimeAuthProfile::Native),
        ContextShape::Gateway => scoped_or_missing(
            sources,
            sources
                .sources
                .iter()
                .filter(|source| matches!(source, ResolvedSource::Gateway(_)))
                .cloned()
                .collect(),
        ),
        ContextShape::EnvNames {
            names,
            discovery_fallback,
        } => {
            let scoped: Vec<ResolvedSource> = sources
                .sources
                .iter()
                .filter(|source| match source {
                    ResolvedSource::ApiKey(profile) => names.contains(&profile.env_var_name),
                    ResolvedSource::Gateway(_) => false,
                })
                .cloned()
                .collect();
            if scoped.is_empty() && discovery_fallback {
                // The login-backed case: nothing enrolled for this context, and a
                // launch would read the user's own credential. Probe it the same
                // way.
                return Ok(AgentRuntimeAuthProfile::Native);
            }
            scoped_or_missing(sources, scoped)
        }
    }
}

/// An enrolled harness whose source list contains nothing for this context is a
/// selection the machine cannot honor for it — the same fail-closed shape
/// `resolve_profile` uses for an empty entry. The reconciler records a failed
/// attempt and does not spawn.
fn scoped_or_missing(
    sources: &HarnessSources,
    scoped: Vec<ResolvedSource>,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    if scoped.is_empty() {
        return Err(RouteAuthError::SelectionMissing {
            harness_kind: sources.harness_kind.clone(),
            revision: sources.revision,
        });
    }
    Ok(AgentRuntimeAuthProfile::Sources(HarnessSources {
        harness_kind: sources.harness_kind.clone(),
        revision: sources.revision,
        sources: scoped,
    }))
}

fn context_shape(
    auth_context_id: &str,
    catalog_contexts: &[AgentCatalogAuthContext],
) -> ContextShape {
    if auth_context_id == BASELINE_CONTEXT_ID {
        return ContextShape::Native;
    }
    let Some(context) = catalog_contexts
        .iter()
        .find(|context| context.id == auth_context_id)
    else {
        return ContextShape::Native;
    };
    let Some(signals) = context.signals.as_ref() else {
        return ContextShape::Native;
    };
    if signal_declares_gateway_route(signals) {
        return ContextShape::Gateway;
    }
    let names = env_names_in_signal(signals);
    if names.is_empty() {
        return ContextShape::Native;
    }
    let mut discovery_kinds = Vec::new();
    collect_discovery_kinds(signals, &mut discovery_kinds);
    ContextShape::EnvNames {
        names,
        discovery_fallback: !discovery_kinds.is_empty(),
    }
}

fn signal_declares_gateway_route(signal: &AgentCatalogAuthSignal) -> bool {
    match signal {
        AgentCatalogAuthSignal::Route(kind) => {
            kind == anyharness_credential_discovery::route_kinds::GATEWAY
        }
        AgentCatalogAuthSignal::AnyOf(children) | AgentCatalogAuthSignal::AllOf(children) => {
            children.iter().any(signal_declares_gateway_route)
        }
        _ => false,
    }
}

fn env_names_in_signal(signal: &AgentCatalogAuthSignal) -> Vec<String> {
    let mut names = Vec::new();
    collect_env_names(signal, &mut names);
    names
}

fn collect_env_names(signal: &AgentCatalogAuthSignal, names: &mut Vec<String>) {
    match signal {
        AgentCatalogAuthSignal::Env(var) => names.push(var.clone()),
        AgentCatalogAuthSignal::AnyOf(children) | AgentCatalogAuthSignal::AllOf(children) => {
            for child in children {
                collect_env_names(child, names);
            }
        }
        // `envFlag` is a provider REROUTE flag, not a credential var: a launch
        // renders nothing for it and the ambient value governs.
        AgentCatalogAuthSignal::EnvFlag(_)
        | AgentCatalogAuthSignal::Discovery(_)
        | AgentCatalogAuthSignal::Route(_) => {}
    }
}

// ---------------------------------------------------------------------------
// Discovery-file stats: the fingerprint input for login-backed contexts.
// ---------------------------------------------------------------------------

/// `stat` every discovery file this context's signals name (sorted, deduped).
///
/// Keychain-backed kinds (`claude-keychain`, `codex-keychain`, `cursor-keychain`)
/// map to no path on purpose: reading them prompts the OS. Their fingerprint is
/// therefore constant by construction and the TTL is their only refresh path,
/// which is one of the two reasons the TTL exists at all.
fn discovery_stats_for_context(
    auth_context_id: &str,
    catalog_contexts: &[AgentCatalogAuthContext],
) -> Vec<(PathBuf, i128, u64)> {
    let Some(home_dir) = dirs::home_dir() else {
        return Vec::new();
    };
    let Some(context) = catalog_contexts
        .iter()
        .find(|context| context.id == auth_context_id)
    else {
        return Vec::new();
    };
    let Some(signals) = context.signals.as_ref() else {
        return Vec::new();
    };
    let mut kinds = Vec::new();
    collect_discovery_kinds(signals, &mut kinds);
    let mut paths: Vec<PathBuf> = kinds
        .iter()
        .flat_map(|kind| discovery_paths_for_kind(kind, &home_dir))
        .collect();
    paths.sort();
    paths.dedup();
    paths.into_iter().map(stat_tuple).collect()
}

fn collect_discovery_kinds(signal: &AgentCatalogAuthSignal, kinds: &mut Vec<String>) {
    match signal {
        AgentCatalogAuthSignal::Discovery(kind) => kinds.push(kind.clone()),
        AgentCatalogAuthSignal::AnyOf(children) | AgentCatalogAuthSignal::AllOf(children) => {
            for child in children {
                collect_discovery_kinds(child, kinds);
            }
        }
        _ => {}
    }
}

/// Discovery kind -> the file(s) whose mtime+size prove a re-login, mirroring
/// `anyharness-credential-discovery`'s own layout. Kinds with no observable file
/// (keychain, the AWS credential chain) map to nothing rather than to a guess.
fn discovery_paths_for_kind(kind: &str, home_dir: &Path) -> Vec<PathBuf> {
    use anyharness_credential_discovery::fact_kinds;

    if let Some(provider) = kind.strip_prefix(fact_kinds::OPENCODE_AUTH_JSON_PREFIX) {
        let _ = provider;
        return vec![home_dir
            .join(".local")
            .join("share")
            .join("opencode")
            .join("auth.json")];
    }
    match kind {
        fact_kinds::CLAUDE_OAUTH_CREDS => vec![
            home_dir.join(".claude").join(".credentials.json"),
            home_dir.join(".claude-oauth-credentials.json"),
        ],
        fact_kinds::CLAUDE_CONFIG_API_KEY => vec![
            home_dir.join(".claude.json"),
            home_dir.join(".claude.json.api"),
        ],
        fact_kinds::CLAUDE_OAUTH_ACCOUNT => vec![home_dir.join(".claude.json")],
        fact_kinds::CODEX_AUTH_JSON_API_KEY | fact_kinds::CODEX_AUTH_JSON_OAUTH => {
            vec![home_dir.join(".codex").join("auth.json")]
        }
        fact_kinds::GROK_AUTH_JSON_OAUTH => vec![home_dir.join(".grok").join("auth.json")],
        // Keychain entries and the AWS chain expose no file we may read without
        // prompting or guessing. TTL covers them.
        _ => Vec::new(),
    }
}

/// An absent file stats as `(path, 0, 0)` rather than being dropped, so its
/// APPEARANCE moves the fingerprint. A user who logs in mid-session must not read
/// as unchanged.
fn stat_tuple(path: PathBuf) -> (PathBuf, i128, u64) {
    let Ok(metadata) = std::fs::metadata(&path) else {
        return (path, 0, 0);
    };
    let mtime_nanos = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos() as i128)
        .unwrap_or_default();
    let len = metadata.len();
    (path, mtime_nanos, len)
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

// ---------------------------------------------------------------------------
// The scratch root: created 0700, owned by the probe thread, gone on drop.
// ---------------------------------------------------------------------------

/// A probe-owned scratch root, removed on `Drop` — every exit path, including an
/// unwind.
///
/// It lives under the runtime home rather than `temp_dir()` on purpose: `/tmp` is
/// world-readable and shared with every user, while the runtime home is already
/// the 0600 custody boundary for `state.json`. It also makes the orphan sweep a
/// bounded single directory instead of prefix-matching shared space.
///
/// **Ownership is load-bearing.** The guard must live on the thread that owns the
/// harness child, so the scratch outlives the child and never the reverse.
/// Dropping it from a cancelling caller would delete `claude-config/` or
/// `codex-home-<rev>/config.toml` out from under a process actively reading them.
pub struct ProbeScratch {
    root: PathBuf,
}

impl ProbeScratch {
    /// `<runtime_home>/agent-auth-probe/<harness>-<context>-<pid>-<nanos>`, 0700
    /// before any content is written (so nested `create_dir_all` dirs cannot be
    /// world-traversable regardless of umask).
    ///
    /// pid + nanos make a name collision impossible between two probes of the
    /// same (harness, context), and they are what lets the sweep tell an
    /// abandoned root from a live one.
    fn create(
        runtime_home: &Path,
        harness_kind: &str,
        auth_context_id: &str,
    ) -> Result<Self, RouteAuthError> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root = probe_root(runtime_home).join(format!(
            "{harness_kind}-{auth_context_id}-{}-{nanos}",
            std::process::id()
        ));
        create_private_dir(&root)?;
        let scratch = Self { root };
        create_private_dir(&scratch.workspace_root())?;
        Ok(scratch)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Parent for `probe_agent`'s throwaway spawn workspace, so one guard cleans
    /// everything — including on a cancelled probe, whose own teardown never runs.
    pub fn workspace_root(&self) -> PathBuf {
        self.root.join("workspace")
    }
}

impl Drop for ProbeScratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn probe_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join(PROBE_ROOT_DIR)
}

fn create_private_dir(dir: &Path) -> Result<(), RouteAuthError> {
    std::fs::create_dir_all(dir).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", dir.display()),
    })?;
    set_private_dir_permissions(dir)
}

#[cfg(unix)]
fn set_private_dir_permissions(dir: &Path) -> Result<(), RouteAuthError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|error| {
        RouteAuthError::Materialize {
            detail: format!("failed to chmod {}: {error}", dir.display()),
        }
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_dir: &Path) -> Result<(), RouteAuthError> {
    Ok(())
}

// ---------------------------------------------------------------------------
// The conservative orphan sweep.
// ---------------------------------------------------------------------------

/// Reclaim scratch roots whose owning process died without running any guard
/// (SIGKILL, power loss). Called once at startup, and only by the runtime that
/// holds the probe-engine lock.
///
/// A root is removed only when **both** hold:
/// (a) its embedded pid is neither ours nor live, and
/// (b) its embedded timestamp is older than `max_probe_age`.
///
/// Both, because either alone mis-deletes: (a) alone loses to pid reuse, (b) alone
/// deletes another runtime's slow probe. Requiring both makes a wrongful delete
/// need pid reuse AND a root older than three probe timeouts. Names we cannot
/// parse fall back to (b) on directory mtime.
///
/// Returns the roots it removed, so the caller can log and tests can assert.
pub fn sweep_probe_scratch(runtime_home: &Path, max_probe_age: std::time::Duration) -> Vec<PathBuf> {
    let root = probe_root(runtime_home);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let own_pid = std::process::id();
    let now_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let max_age_nanos = max_probe_age.as_nanos();
    let mut removed = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let parsed = name.to_str().and_then(parse_scratch_name);
        let old_enough = match parsed {
            Some((_, nanos)) => now_nanos.saturating_sub(nanos) > max_age_nanos,
            // Unparseable: fall back to directory mtime.
            None => dir_age_exceeds(&path, max_probe_age),
        };
        if !old_enough {
            continue;
        }
        if let Some((pid, _)) = parsed {
            if pid == own_pid || process_is_live(pid) {
                continue;
            }
        }
        if std::fs::remove_dir_all(&path).is_ok() {
            removed.push(path);
        }
    }
    removed
}

/// `<harness>-<context>-<pid>-<nanos>` -> (pid, nanos). Harness and context ids
/// may themselves contain `-`, so the two numeric fields are taken from the END.
fn parse_scratch_name(name: &str) -> Option<(u32, u128)> {
    let (head, nanos) = name.rsplit_once('-')?;
    let (_, pid) = head.rsplit_once('-')?;
    Some((pid.parse().ok()?, nanos.parse().ok()?))
}

fn dir_age_exceeds(path: &Path, max_age: std::time::Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age > max_age)
        // Unknown age: leave it alone. A stray directory costs bytes; deleting a
        // live probe's config mid-spawn costs a correct observation.
        .unwrap_or(false)
}

/// Is `pid` a live process? `ESRCH` means dead; `EPERM` means alive but owned by
/// another user (which a second runtime's probe legitimately is).
///
/// There is no pid-liveness helper anywhere in the workspace today, so this is
/// the narrowest possible one.
#[cfg(unix)]
fn process_is_live(pid: u32) -> bool {
    // SAFETY: signal 0 performs error checking only — it delivers no signal and
    // cannot affect the target process.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

/// Without a liveness check, report every pid as live: the age gate alone then
/// governs, which is the conservative direction (a stray root survives rather
/// than a live probe being deleted).
#[cfg(not(unix))]
fn process_is_live(_pid: u32) -> bool {
    true
}

#[cfg(test)]
#[path = "probe_materialization_tests.rs"]
mod probe_materialization_tests;
