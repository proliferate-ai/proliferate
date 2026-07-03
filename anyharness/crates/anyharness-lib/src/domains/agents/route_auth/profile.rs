//! Runtime auth-profile resolution: state file + requested harness → the
//! decided [`AgentRuntimeAuthProfile`], or a typed fail-closed error.
//!
//! This is the pure decision layer (spec §2/§3). It does NOT touch the
//! filesystem or render env; `render.rs` turns a resolved profile into
//! env/args/config at launch time. Keeping resolution pure keeps the
//! fail-closed matrix trivially testable.

use super::state::{AgentAuthState, AuthRoute, AuthSelection};
use super::RouteAuthError;

/// Harness kind that composes multiple auth sources (spec §3.3 slot
/// semantics). Everything else is single-source: exactly one selection.
const OPENCODE_HARNESS: &str = "opencode";

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
    /// OpenCode's merged multi-slot profile: an optional gateway source plus
    /// any number of direct provider keys, rendered ADDITIVELY into one launch
    /// delta (one injected config + per-provider env keys).
    OpenCodeComposite(OpenCodeCompositeProfile),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenCodeCompositeProfile {
    pub gateway: Option<GatewayProfile>,
    pub provider_keys: Vec<ApiKeyProfile>,
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
    /// materialization (codex/grok isolated homes) can key directory
    /// names and clean up stale ones.
    pub revision: i64,
}

/// Resolve the auth profile for `harness_kind` from the loaded state.
///
/// - `state == None` (no file): legacy `Native`.
/// - state present, has selection(s) for the harness: profile per route.
///   OpenCode merges ALL its selections into one composite profile
///   (spec §3.3); single-source harnesses error (typed) on more than one.
/// - state present but NO selection for the harness (regardless of revision):
///   legacy `Native`. A harness the user never configured uses its own native
///   login — the least-surprising default, and safe (native = the user's own
///   CLI sign-in, never ambient/leaked credentials). We deliberately do NOT
///   fail-closed here: `revision` scoping is GLOBAL (any one selection bumps
///   it), so fail-closing on a missing selection blocked launching every
///   un-configured harness the moment a different one was configured.
pub fn resolve_profile(
    state: Option<&AgentAuthState>,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let Some(state) = state else {
        return Ok(AgentRuntimeAuthProfile::Native);
    };
    let selections = state.selections_for(harness_kind);
    if selections.is_empty() {
        return Ok(AgentRuntimeAuthProfile::Native);
    }
    if harness_kind == OPENCODE_HARNESS {
        return resolve_opencode_composite(harness_kind, &selections, state.revision);
    }
    if selections.len() > 1 {
        return Err(RouteAuthError::SelectionConflict {
            harness_kind: harness_kind.to_string(),
            count: selections.len(),
        });
    }
    profile_from_selection(harness_kind, selections[0], state.revision)
}

/// Merge OpenCode's slot entries into one composite profile: at most one
/// gateway source plus any number of direct provider keys. Native entries are
/// tolerated (they render nothing); an all-native entry set resolves `Native`.
fn resolve_opencode_composite(
    harness_kind: &str,
    selections: &[&AuthSelection],
    revision: i64,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let mut gateway: Option<GatewayProfile> = None;
    let mut provider_keys: Vec<ApiKeyProfile> = Vec::new();
    for selection in selections {
        match selection.route {
            AuthRoute::Native => continue,
            AuthRoute::ApiKey => {
                let key = require_key(harness_kind, selection, AuthRoute::ApiKey)?;
                provider_keys.push(ApiKeyProfile {
                    harness_kind: harness_kind.to_string(),
                    provider: selection.provider.clone(),
                    key,
                });
            }
            AuthRoute::Gateway => {
                if gateway.is_some() {
                    return Err(RouteAuthError::SelectionConflict {
                        harness_kind: harness_kind.to_string(),
                        count: selections.len(),
                    });
                }
                gateway = Some(gateway_profile_from_selection(
                    harness_kind,
                    selection,
                    revision,
                )?);
            }
        }
    }
    if gateway.is_none() && provider_keys.is_empty() {
        return Ok(AgentRuntimeAuthProfile::Native);
    }
    Ok(AgentRuntimeAuthProfile::OpenCodeComposite(
        OpenCodeCompositeProfile {
            gateway,
            provider_keys,
        },
    ))
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
        AuthRoute::Gateway => Ok(AgentRuntimeAuthProfile::Gateway(
            gateway_profile_from_selection(harness_kind, selection, revision)?,
        )),
    }
}

fn gateway_profile_from_selection(
    harness_kind: &str,
    selection: &AuthSelection,
    revision: i64,
) -> Result<GatewayProfile, RouteAuthError> {
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
    Ok(GatewayProfile {
        harness_kind: harness_kind.to_string(),
        base_url,
        key,
        model_catalog: selection.model_catalog.clone(),
        revision,
    })
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
    fn missing_selection_falls_back_to_native_even_when_scoped() {
        // Configuring a DIFFERENT harness (codex) bumps the global revision to
        // 7, but claude — which the user never configured — must still launch
        // on its own native login, not fail-closed.
        let state = state(
            7,
            vec![AuthSelection {
                harness: "codex".into(),
                route: AuthRoute::Gateway,
                slot: "primary".into(),
                provider: None,
                base_url: Some("https://gw".into()),
                key: Some("sk".into()),
                model_catalog: None,
            }],
        );
        let profile = resolve_profile(Some(&state), "claude").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
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
                slot: "primary".into(),
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
                slot: "primary".into(),
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
                slot: "primary".into(),
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
                slot: "primary".into(),
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

    fn slot_selection(
        harness: &str,
        route: AuthRoute,
        slot: &str,
        provider: Option<&str>,
        key: Option<&str>,
        base_url: Option<&str>,
    ) -> AuthSelection {
        AuthSelection {
            harness: harness.into(),
            route,
            slot: slot.into(),
            provider: provider.map(Into::into),
            base_url: base_url.map(Into::into),
            key: key.map(Into::into),
            model_catalog: None,
        }
    }

    #[test]
    fn single_source_harness_with_multiple_entries_is_typed_conflict() {
        let state = state(
            4,
            vec![
                slot_selection(
                    "claude",
                    AuthRoute::Gateway,
                    "primary",
                    None,
                    Some("sk-vk"),
                    Some("https://gw"),
                ),
                slot_selection(
                    "claude",
                    AuthRoute::ApiKey,
                    "anthropic",
                    Some("anthropic"),
                    Some("sk-raw"),
                    None,
                ),
            ],
        );
        let error = resolve_profile(Some(&state), "claude").expect_err("conflict");
        assert!(matches!(
            error,
            RouteAuthError::SelectionConflict { count: 2, .. }
        ));
        assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_CONFLICT");
    }

    #[test]
    fn opencode_merges_gateway_and_provider_slots() {
        let state = state(
            6,
            vec![
                slot_selection(
                    "opencode",
                    AuthRoute::Gateway,
                    "gateway",
                    None,
                    Some("sk-vk"),
                    Some("https://gw"),
                ),
                slot_selection(
                    "opencode",
                    AuthRoute::ApiKey,
                    "anthropic",
                    Some("anthropic"),
                    Some("sk-ant"),
                    None,
                ),
                slot_selection(
                    "opencode",
                    AuthRoute::ApiKey,
                    "xai",
                    Some("xai"),
                    Some("xai-raw"),
                    None,
                ),
            ],
        );
        let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::OpenCodeComposite(composite) => {
                let gateway = composite.gateway.expect("gateway source");
                assert_eq!(gateway.base_url, "https://gw");
                assert_eq!(gateway.revision, 6);
                assert_eq!(
                    composite
                        .provider_keys
                        .iter()
                        .map(|entry| entry.provider.as_deref().unwrap())
                        .collect::<Vec<_>>(),
                    vec!["anthropic", "xai"],
                );
            }
            other => panic!("expected composite, got {other:?}"),
        }
    }

    #[test]
    fn opencode_provider_keys_without_gateway_compose() {
        let state = state(
            2,
            vec![slot_selection(
                "opencode",
                AuthRoute::ApiKey,
                "openai",
                Some("openai"),
                Some("sk-openai"),
                None,
            )],
        );
        let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::OpenCodeComposite(composite) => {
                assert!(composite.gateway.is_none());
                assert_eq!(composite.provider_keys.len(), 1);
            }
            other => panic!("expected composite, got {other:?}"),
        }
    }

    #[test]
    fn opencode_double_gateway_entries_are_conflict() {
        let state = state(
            3,
            vec![
                slot_selection(
                    "opencode",
                    AuthRoute::Gateway,
                    "gateway",
                    None,
                    Some("sk-a"),
                    Some("https://gw"),
                ),
                slot_selection(
                    "opencode",
                    AuthRoute::Gateway,
                    "gateway",
                    None,
                    Some("sk-b"),
                    Some("https://gw"),
                ),
            ],
        );
        let error = resolve_profile(Some(&state), "opencode").expect_err("conflict");
        assert!(matches!(error, RouteAuthError::SelectionConflict { .. }));
    }

    #[test]
    fn opencode_all_native_entries_resolve_native() {
        let state = state(
            1,
            vec![slot_selection(
                "opencode",
                AuthRoute::Native,
                "gateway",
                None,
                None,
                None,
            )],
        );
        let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
        assert_eq!(profile, AgentRuntimeAuthProfile::Native);
    }

    #[test]
    fn gateway_profile_carries_revision_and_catalog() {
        // OpenCode resolves through the composite path; its gateway member
        // still carries the revision + model catalog like a plain profile.
        let state = state(
            9,
            vec![AuthSelection {
                harness: "opencode".into(),
                route: AuthRoute::Gateway,
                slot: "gateway".into(),
                provider: None,
                base_url: Some("https://gw".into()),
                key: Some("sk".into()),
                model_catalog: Some(vec!["m1".into(), "m2".into()]),
            }],
        );
        let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
        match profile {
            AgentRuntimeAuthProfile::OpenCodeComposite(composite) => {
                let gw = composite.gateway.expect("gateway source");
                assert_eq!(gw.revision, 9);
                assert_eq!(gw.model_catalog.as_deref().unwrap().len(), 2);
            }
            other => panic!("expected composite, got {other:?}"),
        }
    }
}
