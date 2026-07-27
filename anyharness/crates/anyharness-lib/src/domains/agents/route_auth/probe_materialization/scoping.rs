//! Scoping a harness's flat source list down to ONE auth context, and the
//! discovery-file stats that give login-backed contexts a fingerprint.
//!
//! Split out of the seam's entry points because this is the one genuinely NEW
//! policy the probe needs: `state.json` holds one flat source list per harness
//! (opencode legitimately carries a gateway PLUS several api_key rows at once),
//! while the document wants one entry per auth context.

use std::path::{Path, PathBuf};

use crate::domains::agents::auth::context::BASELINE_CONTEXT_ID;
use crate::domains::agents::catalog::schema::{AgentCatalogAuthContext, AgentCatalogAuthSignal};

use super::super::profile::{AgentRuntimeAuthProfile, HarnessSources, ResolvedSource};
use super::super::RouteAuthError;

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
pub(super) fn scope_profile_to_context(
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
                    // A provider_config source has no env_var_name (it carries
                    // a whole resolved env map under a config_kind) and no
                    // per-context probe materializes it today — same "no
                    // match" answer as Gateway, not a new scoping policy.
                    ResolvedSource::Gateway(_) | ResolvedSource::ProviderConfig(_) => false,
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
pub(super) fn discovery_stats_for_context(
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
