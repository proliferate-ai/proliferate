//! Runtime auth-profile resolution: state file + requested harness → the
//! decided [`AgentRuntimeAuthProfile`], or a typed fail-closed error.
//!
//! This is the pure decision layer (spec §2/§3). It does NOT touch the
//! filesystem or render env; `render.rs` turns a resolved profile into
//! env/args/config at launch time. Keeping resolution pure keeps the
//! fail-closed matrix trivially testable.

use super::state::{AgentAuthState, AuthRoute, AuthSelection};
use super::RouteAuthError;

/// The resolved auth profile for one harness launch (spec §4
/// `AgentRuntimeAuthProfile`). `Native` means "unchanged legacy behavior"; the
/// render layer emits nothing for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentRuntimeAuthProfile {
    /// No state file, or a native selection: render nothing (detection/login
    /// stack owns auth).
    Native,
    ApiKey(ApiKeyProfile),
    Gateway(GatewayProfile),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeyProfile {
    pub harness_kind: String,
    pub provider: Option<String>,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayProfile {
    pub harness_kind: String,
    /// The public gateway base URL (root, no per-harness suffix — the adapters
    /// append `/v1`, `/anthropic`, etc. per the live matrix).
    pub base_url: String,
    pub key: String,
    /// Explicit model list for adapters that require it in-config (OpenCode).
    pub model_catalog: Option<Vec<String>>,
    /// The revision that produced this profile — carried so switch-time
    /// materialization (codex/grok/gemini isolated homes) can key directory
    /// names and clean up stale ones.
    pub revision: i64,
}

/// Resolve the auth profile for `harness_kind` from the loaded state.
///
/// - `state == None` (no file): legacy `Native`.
/// - state present, has a selection for the harness: profile per its route.
/// - state present + scoped (`revision > 0`) but NO selection for the harness:
///   fail-closed [`RouteAuthError::SelectionMissing`] (spec §3), mirroring the
///   old `AGENT_AUTH_SELECTION_REQUIRED` semantics against the new model.
/// - state present but NOT scoped (`revision == 0`) with no selection: legacy
///   `Native` (bootstrapping state before any selection exists).
pub fn resolve_profile(
    state: Option<&AgentAuthState>,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let Some(state) = state else {
        return Ok(AgentRuntimeAuthProfile::Native);
    };
    match state.selection_for(harness_kind) {
        Some(selection) => profile_from_selection(harness_kind, selection, state.revision),
        None => {
            if state.is_scoped() {
                Err(RouteAuthError::SelectionMissing {
                    harness_kind: harness_kind.to_string(),
                    revision: state.revision,
                })
            } else {
                Ok(AgentRuntimeAuthProfile::Native)
            }
        }
    }
}

fn profile_from_selection(
    harness_kind: &str,
    selection: &AuthSelection,
    revision: i64,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    match selection.route {
        AuthRoute::Native => Ok(AgentRuntimeAuthProfile::Native),
        AuthRoute::ApiKey => {
            let key = require_key(harness_kind, selection, AuthRoute::ApiKey)?;
            Ok(AgentRuntimeAuthProfile::ApiKey(ApiKeyProfile {
                harness_kind: harness_kind.to_string(),
                provider: selection.provider.clone(),
                key,
            }))
        }
        AuthRoute::Gateway => {
            let key = require_key(harness_kind, selection, AuthRoute::Gateway)?;
            let base_url = selection
                .base_url
                .clone()
                .filter(|url| !url.trim().is_empty())
                .ok_or_else(|| RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    route: AuthRoute::Gateway,
                    detail: "gateway route requires baseUrl".to_string(),
                })?;
            Ok(AgentRuntimeAuthProfile::Gateway(GatewayProfile {
                harness_kind: harness_kind.to_string(),
                base_url,
                key,
                model_catalog: selection.model_catalog.clone(),
                revision,
            }))
        }
    }
}

fn require_key(
    harness_kind: &str,
    selection: &AuthSelection,
    route: AuthRoute,
) -> Result<String, RouteAuthError> {
    selection
        .key
        .clone()
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| RouteAuthError::SelectionIncomplete {
            harness_kind: harness_kind.to_string(),
            route,
            detail: format!("{} route requires a key", route.as_str()),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::route_auth::state::AuthSelection;

    fn state(revision: i64, selections: Vec<AuthSelection>) -> AgentAuthState {
        AgentAuthState {
            revision,
            user_id: None,
            selections,
        }
    }

    #[test]
    fn no_state_file_is_native() {
        let profile = resolve_profile(None, "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn scoped_missing_selection_fails_closed() {
        let state = state(
            7,
            vec![AuthSelection {
                harness: "codex".into(),
                route: AuthRoute::Gateway,
                provider: None,
                base_url: Some("https://gw".into()),
                key: Some("sk".into()),
                model_catalog: None,
            }],
        );
        let error = resolve_profile(Some(&state), "claude").expect_err("fail-closed");
        assert!(matches!(
            error,
            RouteAuthError::SelectionMissing { revision: 7, .. }
        ));
    }

    #[test]
    fn unscoped_missing_selection_is_native() {
        let state = state(0, vec![]);
        let profile = resolve_profile(Some(&state), "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn native_selection_is_native() {
        let state = state(
            3,
            vec![AuthSelection {
                harness: "claude".into(),
                route: AuthRoute::Native,
                provider: None,
                base_url: None,
                key: None,
                model_catalog: None,
            }],
        );
        let profile = resolve_profile(Some(&state), "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn gateway_requires_key_and_base_url() {
        let missing_key = state(
            1,
            vec![AuthSelection {
                harness: "claude".into(),
                route: AuthRoute::Gateway,
                provider: None,
                base_url: Some("https://gw".into()),
                key: None,
                model_catalog: None,
            }],
        );
        assert!(matches!(
            resolve_profile(Some(&missing_key), "claude").expect_err("no key"),
            RouteAuthError::SelectionIncomplete { .. }
        ));

        let missing_url = state(
            1,
            vec![AuthSelection {
                harness: "claude".into(),
                route: AuthRoute::Gateway,
                provider: None,
                base_url: None,
                key: Some("sk".into()),
                model_catalog: None,
            }],
        );
        assert!(matches!(
            resolve_profile(Some(&missing_url), "claude").expect_err("no url"),
            RouteAuthError::SelectionIncomplete { .. }
        ));
    }

    #[test]
    fn api_key_requires_key() {
        let missing_key = state(
            1,
            vec![AuthSelection {
                harness: "claude".into(),
                route: AuthRoute::ApiKey,
                provider: Some("anthropic".into()),
                base_url: None,
                key: None,
                model_catalog: None,
            }],
        );
        assert!(matches!(
            resolve_profile(Some(&missing_key), "claude").expect_err("no key"),
            RouteAuthError::SelectionIncomplete { .. }
        ));
    }

    #[test]
    fn gateway_profile_carries_revision_and_catalog() {
        let state = state(
            9,
            vec![AuthSelection {
                harness: "opencode".into(),
                route: AuthRoute::Gateway,
                provider: None,
                base_url: Some("https://gw".into()),
                key: Some("sk".into()),
                model_catalog: Some(vec!["m1".into(), "m2".into()]),
            }],
        );
        let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::Gateway(gw) => {
                assert_eq!(gw.revision, 9);
                assert_eq!(gw.model_catalog.as_deref().unwrap().len(), 2);
            }
            other => panic!("expected gateway, got {other:?}"),
        }
    }
}
