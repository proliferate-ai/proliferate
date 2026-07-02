//! The declarative agent-auth state file contract.
//!
//! Both delivery surfaces (the cloud materialization worker and the desktop
//! dispatch worker) write the SAME file at `<anyharness home>/agent-auth/
//! state.json` (mode 0600); AnyHarness reads it fresh at every session launch
//! and renders per-harness launch profiles from it (spec §5). There is no
//! watch/refresh — the render plane re-reads on demand.
//!
//! Tolerance model:
//! - file absent          -> `None` (legacy / native behavior; local desktop
//!   without cloud state keeps working)
//! - file present, valid  -> `Some(AgentAuthState)`
//! - file present, broken -> typed [`RouteAuthError::MalformedStateFile`]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::RouteAuthError;

/// Well-known relative path of the state file under the AnyHarness home.
pub const STATE_FILE_RELATIVE_PATH: &[&str] = &["agent-auth", "state.json"];

/// Resolve the absolute path of the agent-auth state file for a given
/// AnyHarness runtime home. Single source of truth for the layout so delivery
/// (worker/desktop) and the render plane agree.
pub fn state_file_path(runtime_home: &Path) -> PathBuf {
    let mut path = runtime_home.to_path_buf();
    for segment in STATE_FILE_RELATIVE_PATH {
        path.push(segment);
    }
    path
}

/// Which route pays for a harness's LLM calls (spec §1). `native` is local-only
/// (the harness's own auth; we detect + leave alone) and carries no rendered
/// credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthRoute {
    Native,
    ApiKey,
    Gateway,
}

impl AuthRoute {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::ApiKey => "api_key",
            Self::Gateway => "gateway",
        }
    }
}

/// A single (harness, route) selection materialized by the control plane. The
/// optional fields carry only what a route needs: `key`/`base_url`/`provider`
/// for api_key/gateway, `model_catalog` for OpenCode's explicit models map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthSelection {
    /// Harness kind string, e.g. `"claude"`, `"codex"` (matches
    /// [`AgentKind::as_str`](crate::domains::agents::model::AgentKind::as_str)).
    pub harness: String,
    pub route: AuthRoute,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// The rendered credential (virtual key for gateway, raw provider key for
    /// api_key). Never logged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Explicit model ids for adapters that require them in-config (OpenCode).
    /// Populated by the catalog (PR 7); absent means the adapter falls back to
    /// a static minimal list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_catalog: Option<Vec<String>>,
}

/// The whole declarative state file (spec §5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentAuthState {
    /// Monotonic revision. `0` means "no scoped selections yet" (legacy /
    /// native behavior); `> 0` engages fail-closed semantics for harnesses
    /// without a selection.
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default)]
    pub selections: Vec<AuthSelection>,
}

impl AgentAuthState {
    /// The selection for a harness kind, if any.
    pub fn selection_for(&self, harness_kind: &str) -> Option<&AuthSelection> {
        self.selections
            .iter()
            .find(|selection| selection.harness == harness_kind)
    }

    /// Whether the state engages fail-closed semantics (a scoped launch, spec
    /// §3): the file exists with a real revision, so a harness with no
    /// selection must error rather than fall through to ambient credentials.
    pub fn is_scoped(&self) -> bool {
        self.revision > 0
    }
}

/// Read + parse the state file on demand. Returns:
/// - `Ok(None)` when the file is absent (legacy behavior),
/// - `Ok(Some(state))` when present and valid,
/// - `Err(RouteAuthError::MalformedStateFile)` when present but unparseable.
pub fn load_state_file(runtime_home: &Path) -> Result<Option<AgentAuthState>, RouteAuthError> {
    let path = state_file_path(runtime_home);
    load_state_from_path(&path)
}

pub(super) fn load_state_from_path(path: &Path) -> Result<Option<AgentAuthState>, RouteAuthError> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(RouteAuthError::MalformedStateFile {
                path: path.to_path_buf(),
                detail: format!("failed to read state file: {error}"),
            })
        }
    };
    let state: AgentAuthState =
        serde_json::from_slice(&contents).map_err(|error| RouteAuthError::MalformedStateFile {
            path: path.to_path_buf(),
            detail: format!("failed to parse state file JSON: {error}"),
        })?;
    Ok(Some(state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::route_auth::test_support::TempHome;

    #[test]
    fn state_file_path_uses_well_known_layout() {
        let path = state_file_path(Path::new("/home/x/.proliferate/anyharness"));
        assert!(path.ends_with("agent-auth/state.json"));
    }

    #[test]
    fn missing_file_is_legacy_none() {
        let home = TempHome::new("state-missing");
        let state = load_state_file(home.path()).expect("load");
        assert!(state.is_none());
    }

    #[test]
    fn malformed_file_is_typed_error() {
        let home = TempHome::new("state-malformed");
        home.write_state_raw(b"{ not json");
        let error = load_state_file(home.path()).expect_err("malformed");
        assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
    }

    #[test]
    fn round_trip_serde_preserves_selection_fields() {
        let state = AgentAuthState {
            revision: 42,
            user_id: Some("user-1".into()),
            selections: vec![
                AuthSelection {
                    harness: "claude".into(),
                    route: AuthRoute::Gateway,
                    provider: None,
                    base_url: Some("https://llm.proliferate.ai".into()),
                    key: Some("sk-virtual".into()),
                    model_catalog: None,
                },
                AuthSelection {
                    harness: "opencode".into(),
                    route: AuthRoute::Gateway,
                    provider: None,
                    base_url: Some("https://llm.proliferate.ai".into()),
                    key: Some("sk-virtual".into()),
                    model_catalog: Some(vec!["claude-haiku-4-5-20251001".into()]),
                },
            ],
        };
        let json = serde_json::to_string(&state).expect("serialize");
        let parsed: AgentAuthState = serde_json::from_str(&json).expect("parse");
        assert_eq!(state, parsed);
        // camelCase-insensitive: routes serialize snake_case.
        assert!(json.contains("\"gateway\""));
    }

    #[test]
    fn selection_lookup_and_scoping() {
        let state = AgentAuthState {
            revision: 5,
            user_id: None,
            selections: vec![AuthSelection {
                harness: "codex".into(),
                route: AuthRoute::ApiKey,
                provider: Some("openai".into()),
                base_url: None,
                key: Some("sk-raw".into()),
                model_catalog: None,
            }],
        };
        assert!(state.is_scoped());
        assert_eq!(
            state.selection_for("codex").unwrap().route,
            AuthRoute::ApiKey
        );
        assert!(state.selection_for("claude").is_none());

        let legacy = AgentAuthState {
            revision: 0,
            user_id: None,
            selections: vec![],
        };
        assert!(!legacy.is_scoped());
    }

    #[test]
    fn tolerates_minimal_native_selection() {
        let json =
            r#"{ "revision": 3, "selections": [ { "harness": "claude", "route": "native" } ] }"#;
        let state: AgentAuthState = serde_json::from_str(json).expect("parse");
        let selection = state.selection_for("claude").expect("selection");
        assert_eq!(selection.route, AuthRoute::Native);
        assert!(selection.key.is_none());
    }
}
