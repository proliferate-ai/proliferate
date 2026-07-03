//! Runtime auth-profile resolution: state file + requested harness → the
//! decided [`AgentRuntimeAuthProfile`], or a typed error.
//!
//! This is the pure decision layer (contract §4). It does NOT touch the
//! filesystem or render env; `render.rs` turns a resolved profile into
//! env/args/config file specs, and the launcher applies those specs.
//!
//! Composition is just "a list of sources": the server already validated which
//! source combinations are legal per harness (contract §2), so resolution here
//! is a straight mapping — the harness entry's enabled `sources[]` become
//! typed [`ResolvedSource`]s. Absent harness or empty sources → [`Native`]
//! (empty delta; the harness's own login owns auth). The only failures are
//! shape problems the server should never emit: an unknown source `kind` or a
//! source missing its required fields.
//!
//! [`Native`]: AgentRuntimeAuthProfile::Native

use super::state::{
    AgentAuthState, AuthSource, SOURCE_KIND_API_KEY, SOURCE_KIND_GATEWAY,
};
use super::RouteAuthError;

/// The resolved auth profile for one harness launch. `Native` renders nothing
/// (the harness's own detection/login owns auth); `Sources` carries the enabled
/// credential sources to compose additively at render time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentRuntimeAuthProfile {
    Native,
    Sources(HarnessSources),
}

/// A harness plus its enabled, typed credential sources (contract §4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessSources {
    pub harness_kind: String,
    /// The state revision that produced these sources — carried so switch-time
    /// materialization (codex/grok/opencode isolated dirs) can key directory
    /// names and GC stale ones.
    pub revision: i64,
    pub sources: Vec<ResolvedSource>,
}

/// One resolved credential source (contract §3 `sources[]`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSource {
    Gateway(GatewayProfile),
    ApiKey(ApiKeyProfile),
}

/// A raw provider key destined for a free-form env var (contract §4: `api_key`
/// source → `set[env_var_name] = value`, nothing else).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeyProfile {
    pub env_var_name: String,
    pub value: String,
}

/// A LiteLLM virtual key + public gateway base URL. The per-harness gateway
/// recipe (render.rs) decides how the CLI is pointed at it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayProfile {
    /// The public gateway base URL (root, no per-harness suffix — the recipes
    /// append `/v1`, etc. per the live matrix).
    pub base_url: String,
    pub key: String,
}

/// Resolve the auth profile for `harness_kind` from the loaded state.
///
/// - `state == None` (no file): `Native`.
/// - harness absent, or present with no sources: `Native`. A harness the user
///   never configured uses its own native login — the least-surprising default,
///   and safe (native = the user's own CLI sign-in, never ambient/leaked
///   credentials).
/// - harness present with sources: each source is validated + typed. An unknown
///   `kind`, or a source missing its required fields, is a typed error (the
///   server should never emit these).
pub fn resolve_profile(
    state: Option<&AgentAuthState>,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let Some(state) = state else {
        return Ok(AgentRuntimeAuthProfile::Native);
    };
    let raw_sources = state.sources_for(harness_kind);
    if raw_sources.is_empty() {
        return Ok(AgentRuntimeAuthProfile::Native);
    }
    let mut sources = Vec::with_capacity(raw_sources.len());
    for source in raw_sources {
        sources.push(resolve_source(harness_kind, source)?);
    }
    Ok(AgentRuntimeAuthProfile::Sources(HarnessSources {
        harness_kind: harness_kind.to_string(),
        revision: state.revision,
        sources,
    }))
}

fn resolve_source(
    harness_kind: &str,
    source: &AuthSource,
) -> Result<ResolvedSource, RouteAuthError> {
    match source.kind.as_str() {
        SOURCE_KIND_GATEWAY => {
            let base_url = require_field(harness_kind, source.base_url.as_deref(), "base_url")?;
            let key = require_field(harness_kind, source.key.as_deref(), "key")?;
            Ok(ResolvedSource::Gateway(GatewayProfile { base_url, key }))
        }
        SOURCE_KIND_API_KEY => {
            let env_var_name =
                require_field(harness_kind, source.env_var_name.as_deref(), "env_var_name")?;
            let value = require_field(harness_kind, source.value.as_deref(), "value")?;
            Ok(ResolvedSource::ApiKey(ApiKeyProfile {
                env_var_name,
                value,
            }))
        }
        unknown => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: format!("unknown agent-auth source kind '{unknown}'"),
        }),
    }
}

fn require_field(
    harness_kind: &str,
    value: Option<&str>,
    field: &str,
) -> Result<String, RouteAuthError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RouteAuthError::SelectionIncomplete {
            harness_kind: harness_kind.to_string(),
            detail: format!("source is missing required field '{field}'"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::route_auth::state::{AuthSource, HarnessAuth, STATE_VERSION};

    fn state(revision: i64, harnesses: Vec<HarnessAuth>) -> AgentAuthState {
        AgentAuthState {
            version: STATE_VERSION,
            revision,
            user_id: None,
            harnesses,
        }
    }

    fn gateway_source(base_url: &str, key: &str) -> AuthSource {
        AuthSource {
            kind: SOURCE_KIND_GATEWAY.into(),
            base_url: Some(base_url.into()),
            key: Some(key.into()),
            env_var_name: None,
            value: None,
        }
    }

    fn api_key_source(env_var_name: &str, value: &str) -> AuthSource {
        AuthSource {
            kind: SOURCE_KIND_API_KEY.into(),
            base_url: None,
            key: None,
            env_var_name: Some(env_var_name.into()),
            value: Some(value.into()),
        }
    }

    fn harness(kind: &str, sources: Vec<AuthSource>) -> HarnessAuth {
        HarnessAuth {
            harness_kind: kind.into(),
            sources,
        }
    }

    #[test]
    fn no_state_file_is_native() {
        let profile = resolve_profile(None, "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn missing_harness_falls_back_to_native() {
        // codex configured (bumps the global revision) must NOT block claude,
        // which the user never configured — claude resolves Native.
        let state = state(
            7,
            vec![harness("codex", vec![gateway_source("https://gw", "sk")])],
        );
        let profile = resolve_profile(Some(&state), "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn empty_sources_is_native() {
        let state = state(4, vec![harness("claude", vec![])]);
        let profile = resolve_profile(Some(&state), "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn single_gateway_source_resolves() {
        let state = state(
            3,
            vec![harness("claude", vec![gateway_source("https://gw", "sk-vk")])],
        );
        let profile = resolve_profile(Some(&state), "claude").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::Sources(sources) => {
                assert_eq!(sources.harness_kind, "claude");
                assert_eq!(sources.revision, 3);
                assert_eq!(sources.sources.len(), 1);
                assert_eq!(
                    sources.sources[0],
                    ResolvedSource::Gateway(GatewayProfile {
                        base_url: "https://gw".into(),
                        key: "sk-vk".into(),
                    })
                );
            }
            other => panic!("expected sources, got {other:?}"),
        }
    }

    #[test]
    fn single_api_key_source_resolves() {
        let state = state(
            1,
            vec![harness(
                "codex",
                vec![api_key_source("OPENAI_API_KEY", "sk-raw")],
            )],
        );
        let profile = resolve_profile(Some(&state), "codex").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::Sources(sources) => {
                assert_eq!(
                    sources.sources[0],
                    ResolvedSource::ApiKey(ApiKeyProfile {
                        env_var_name: "OPENAI_API_KEY".into(),
                        value: "sk-raw".into(),
                    })
                );
            }
            other => panic!("expected sources, got {other:?}"),
        }
    }

    #[test]
    fn multiple_sources_compose_in_order() {
        // OpenCode: a gateway plus two direct api_key rows, all enabled.
        let state = state(
            6,
            vec![harness(
                "opencode",
                vec![
                    gateway_source("https://gw", "sk-vk"),
                    api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                    api_key_source("XAI_API_KEY", "xai-raw"),
                ],
            )],
        );
        let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::Sources(sources) => {
                assert_eq!(sources.sources.len(), 3);
                assert!(matches!(sources.sources[0], ResolvedSource::Gateway(_)));
                assert!(matches!(sources.sources[1], ResolvedSource::ApiKey(_)));
                assert!(matches!(sources.sources[2], ResolvedSource::ApiKey(_)));
            }
            other => panic!("expected sources, got {other:?}"),
        }
    }

    #[test]
    fn unknown_source_kind_is_typed_error() {
        let state = state(
            1,
            vec![harness(
                "claude",
                vec![AuthSource {
                    kind: "bogus".into(),
                    base_url: None,
                    key: None,
                    env_var_name: None,
                    value: None,
                }],
            )],
        );
        let error = resolve_profile(Some(&state), "claude").expect_err("unknown kind");
        assert!(matches!(error, RouteAuthError::UnsupportedRoute { .. }));
        assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
    }

    #[test]
    fn gateway_missing_base_url_is_incomplete() {
        let state = state(
            1,
            vec![harness(
                "claude",
                vec![AuthSource {
                    kind: SOURCE_KIND_GATEWAY.into(),
                    base_url: None,
                    key: Some("sk".into()),
                    env_var_name: None,
                    value: None,
                }],
            )],
        );
        let error = resolve_profile(Some(&state), "claude").expect_err("no base_url");
        assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
    }

    #[test]
    fn api_key_missing_value_is_incomplete() {
        let state = state(
            1,
            vec![harness(
                "codex",
                vec![AuthSource {
                    kind: SOURCE_KIND_API_KEY.into(),
                    base_url: None,
                    key: None,
                    env_var_name: Some("OPENAI_API_KEY".into()),
                    value: None,
                }],
            )],
        );
        let error = resolve_profile(Some(&state), "codex").expect_err("no value");
        assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
    }

    #[test]
    fn blank_field_is_incomplete() {
        let state = state(
            1,
            vec![harness("claude", vec![gateway_source("   ", "sk")])],
        );
        let error = resolve_profile(Some(&state), "claude").expect_err("blank base_url");
        assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
    }
}
