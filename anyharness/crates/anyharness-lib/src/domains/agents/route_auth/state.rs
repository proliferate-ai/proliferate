//! The declarative agent-auth state file contract (state.json v2, AUTH-ONLY).
//!
//! Both delivery surfaces (the cloud materialization worker and the desktop
//! dispatch worker) write the SAME file at `<anyharness home>/agent-auth/
//! state.json` (mode 0600); AnyHarness reads it fresh at every session launch
//! and renders per-harness launch profiles from it. There is no watch/refresh —
//! the render plane re-reads on demand.
//!
//! v2 shape (contract §3): a `harnesses[]` list, each entry carrying the
//! ENABLED `sources[]` for one harness. A source is either a `gateway`
//! (base_url + key) or an `api_key` (env_var_name + value). No slots, no
//! providers, no model catalog — the server validated legality before emitting
//! the sources, so the render plane just composes whatever list it is handed.
//!
//! Tolerance model:
//! - file absent          -> `None` (native behavior; local desktop without
//!   cloud state keeps working)
//! - file present, valid  -> `Some(AgentAuthState)`
//! - file present, broken -> typed [`RouteAuthError::MalformedStateFile`]
//!   (this includes a v1 / version-less file: no users exist, so there is no
//!   back-compat — an old-shape file is simply malformed to this render plane)

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::RouteAuthError;

/// Well-known relative path of the state file under the AnyHarness home.
pub const STATE_FILE_RELATIVE_PATH: &[&str] = &["agent-auth", "state.json"];

/// The only wire schema version this render plane understands.
pub const STATE_VERSION: i64 = 2;

/// Source discriminants on the wire (contract §3).
pub const SOURCE_KIND_GATEWAY: &str = "gateway";
pub const SOURCE_KIND_API_KEY: &str = "api_key";

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

/// A single credential source for a harness (contract §3). `kind` is kept as a
/// raw string (not a serde-tagged enum) so an unrecognized kind surfaces a
/// typed error at resolve time rather than a blanket parse failure: unknown
/// `kind` → typed error, structurally-broken JSON → `MalformedStateFile`.
///
/// The per-kind fields are optional at the serde layer and validated when the
/// source is resolved:
/// - `gateway`: `base_url` + `key`
/// - `api_key`: `env_var_name` + `value`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthSource {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_var_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// One harness's enabled sources (contract §3). Composition is just "a list of
/// sources": single-source harnesses carry at most one, OpenCode may carry a
/// gateway plus any number of api_key rows — the server already enforced which
/// combinations are legal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessAuth {
    pub harness_kind: String,
    #[serde(default)]
    pub sources: Vec<AuthSource>,
    /// Per-harness advanced settings (persisted toggle values). Keys are
    /// setting keys declared in the agent catalog; values are JSON primitives
    /// (booleans for v1). Absent/null when no settings are configured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Map<String, serde_json::Value>>,
}

/// The whole declarative state file (contract §3, v2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentAuthState {
    /// Wire schema version. Must equal [`STATE_VERSION`]; any other value (or a
    /// version-less v1 file) is rejected as malformed on load.
    pub version: i64,
    /// Monotonic revision. Any selection/key mutation bumps it; used for
    /// stale-push protection ([`apply_state_file`]) and revision-keyed
    /// materialization dirs.
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// The origin (`scheme://host[:port]`) of the control-plane server that
    /// produced this document, stamped by the desktop write path at push time
    /// (`use-local-auth-state-sync.ts`). `None` for cloud-materialized state
    /// (no desktop server-switch concern there) and for files written before
    /// this field existed — [`Self::matches_server_origin`] treats an absent
    /// stamp as a match, so single-server users see no behavior change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuing_server_origin: Option<String>,
    #[serde(default)]
    pub harnesses: Vec<HarnessAuth>,
}

impl AgentAuthState {
    /// The enabled sources for a harness kind. Absent harness → empty slice
    /// (the render plane treats this as native — no rendered credentials).
    pub fn sources_for(&self, harness_kind: &str) -> &[AuthSource] {
        self.harnesses
            .iter()
            .find(|entry| entry.harness_kind == harness_kind)
            .map(|entry| entry.sources.as_slice())
            .unwrap_or(&[])
    }

    /// Guards against injecting a PREVIOUS server's gateway tokens after a
    /// desktop server switch: the worker may push a fresh document for the new
    /// server before the app re-enrolls, but a launch racing that window must
    /// not use the just-abandoned server's still-cached state.
    ///
    /// - both origins present and equal (case-insensitively, ignoring a
    ///   trailing slash) → match.
    /// - both present and different → mismatch (the caller treats the state
    ///   as absent, i.e. native/no-injection, until a fresh push lands).
    /// - either side absent (no stamp on the file, or no current-origin
    ///   signal from the caller, e.g. a cloud sandbox) → match. This is the
    ///   backward-compat path: it never regresses a single-server install.
    pub fn matches_server_origin(&self, current_server_origin: Option<&str>) -> bool {
        match (&self.issuing_server_origin, current_server_origin) {
            (Some(stamped), Some(current)) => normalize_origin(stamped) == normalize_origin(current),
            _ => true,
        }
    }
}

fn normalize_origin(origin: &str) -> String {
    origin.trim().trim_end_matches('/').to_ascii_lowercase()
}

/// Read + parse the state file on demand. Returns:
/// - `Ok(None)` when the file is absent (native behavior),
/// - `Ok(Some(state))` when present and a valid v2 document,
/// - `Err(RouteAuthError::MalformedStateFile)` when present but unparseable or
///   not v2 (a v1 / version-less file counts as malformed — no back-compat).
pub fn load_state_file(runtime_home: &Path) -> Result<Option<AgentAuthState>, RouteAuthError> {
    let path = state_file_path(runtime_home);
    load_state_from_path(&path)
}

/// Persist a state document pushed by a delivery surface (the desktop local
/// writer, mirroring what the cloud materialization worker writes into
/// sandboxes). The write is atomic and 0600 via the shared route-auth private
/// file helper.
///
/// Stale-write protection: a payload whose revision is BELOW the persisted
/// file's revision is rejected (a delayed push must never roll live
/// selections back). Equal revisions are accepted — content is authoritative
/// (e.g. a virtual-key rotation changes the file without a revision bump). A
/// malformed on-disk file carries no trustworthy revision and is healed by
/// any valid push.
pub fn apply_state_file(runtime_home: &Path, state: &AgentAuthState) -> Result<(), RouteAuthError> {
    let path = state_file_path(runtime_home);
    let persisted_revision = match load_state_from_path(&path) {
        Ok(existing) => existing.map(|existing| existing.revision),
        Err(RouteAuthError::MalformedStateFile { .. }) => None,
        Err(error) => return Err(error),
    };
    if let Some(current) = persisted_revision {
        if state.revision < current {
            return Err(RouteAuthError::StaleStateRevision {
                incoming: state.revision,
                current,
            });
        }
    }
    let parent = path.parent().expect("state file path has a parent");
    fs::create_dir_all(parent).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", parent.display()),
    })?;
    let mut serialized =
        serde_json::to_vec_pretty(state).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to serialize agent-auth state: {error}"),
        })?;
    serialized.push(b'\n');
    super::materialize::write_private_file(&path, &serialized)
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
    if state.version != STATE_VERSION {
        return Err(RouteAuthError::MalformedStateFile {
            path: path.to_path_buf(),
            detail: format!(
                "unsupported agent-auth state version {} (expected {STATE_VERSION})",
                state.version
            ),
        });
    }
    Ok(Some(state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::route_auth::test_support::TempHome;

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

    #[test]
    fn state_file_path_uses_well_known_layout() {
        let path = state_file_path(Path::new("/home/x/.proliferate/anyharness"));
        assert!(path.ends_with("agent-auth/state.json"));
    }

    #[test]
    fn missing_file_is_native_none() {
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
    fn v1_file_is_rejected_as_malformed() {
        // A v1 document (no `version`, `selections` instead of `harnesses`) has
        // no trustworthy shape for this render plane: reject as malformed.
        let home = TempHome::new("state-v1");
        home.write_state_raw(
            br#"{ "revision": 3, "selections": [ { "harness": "claude", "route": "native" } ] }"#,
        );
        let error = load_state_file(home.path()).expect_err("v1 rejected");
        assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
    }

    #[test]
    fn wrong_version_is_rejected_as_malformed() {
        let home = TempHome::new("state-badver");
        home.write_state_json(&serde_json::json!({
            "version": 1,
            "revision": 3,
            "harnesses": []
        }));
        let error = load_state_file(home.path()).expect_err("bad version");
        assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
    }

    #[test]
    fn round_trip_serde_preserves_sources() {
        let state = AgentAuthState {
            version: STATE_VERSION,
            revision: 42,
            user_id: Some("user-1".into()),
            issuing_server_origin: None,
            harnesses: vec![
                HarnessAuth {
                    harness_kind: "claude".into(),
                    sources: vec![gateway_source("https://llm.proliferate.ai", "sk-vk")],
                    settings: None,
                },
                HarnessAuth {
                    harness_kind: "opencode".into(),
                    sources: vec![
                        gateway_source("https://llm.proliferate.ai", "sk-vk"),
                        api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                    ],
                    settings: None,
                },
            ],
        };
        let json = serde_json::to_string(&state).expect("serialize");
        let parsed: AgentAuthState = serde_json::from_str(&json).expect("parse");
        assert_eq!(state, parsed);
        // gateway source drops the api_key-only fields on the wire.
        assert!(!json.contains("\"env_var_name\":null"));
    }

    #[test]
    fn sources_lookup() {
        let state = AgentAuthState {
            version: STATE_VERSION,
            revision: 5,
            user_id: None,
            issuing_server_origin: None,
            harnesses: vec![HarnessAuth {
                harness_kind: "codex".into(),
                sources: vec![api_key_source("OPENAI_API_KEY", "sk-raw")],
                settings: None,
            }],
        };
        assert_eq!(state.sources_for("codex").len(), 1);
        assert_eq!(state.sources_for("codex")[0].kind, SOURCE_KIND_API_KEY);
        // Absent harness → empty slice (native).
        assert!(state.sources_for("claude").is_empty());
    }

    #[test]
    fn empty_harnesses_field_defaults() {
        let json = r#"{ "version": 2, "revision": 0 }"#;
        let state: AgentAuthState = serde_json::from_str(json).expect("parse");
        assert!(state.harnesses.is_empty());
        // No stamp on this (legacy) shape either.
        assert!(state.issuing_server_origin.is_none());
    }

    #[test]
    fn issuing_server_origin_round_trips_and_is_absent_by_default() {
        let json = r#"{ "version": 2, "revision": 0, "issuing_server_origin": "https://proliferate.corp.example" }"#;
        let state: AgentAuthState = serde_json::from_str(json).expect("parse");
        assert_eq!(
            state.issuing_server_origin,
            Some("https://proliferate.corp.example".to_string())
        );
        let serialized = serde_json::to_string(&state).expect("serialize");
        assert!(serialized.contains("\"issuing_server_origin\":\"https://proliferate.corp.example\""));
    }

    fn stamped_state(origin: Option<&str>) -> AgentAuthState {
        AgentAuthState {
            version: STATE_VERSION,
            revision: 1,
            user_id: None,
            issuing_server_origin: origin.map(str::to_string),
            harnesses: vec![],
        }
    }

    #[test]
    fn matches_server_origin_when_both_stamps_agree() {
        let state = stamped_state(Some("https://proliferate.corp.example"));
        assert!(state.matches_server_origin(Some("https://proliferate.corp.example")));
    }

    #[test]
    fn matches_server_origin_is_case_and_trailing_slash_insensitive() {
        let state = stamped_state(Some("https://Proliferate.Corp.Example/"));
        assert!(state.matches_server_origin(Some("https://proliferate.corp.example")));
    }

    #[test]
    fn matches_server_origin_rejects_a_real_mismatch() {
        let state = stamped_state(Some("https://old-server.example"));
        assert!(!state.matches_server_origin(Some("https://new-server.example")));
    }

    #[test]
    fn matches_server_origin_treats_legacy_unstamped_file_as_a_match() {
        // Backward compat (task requirement): a file written before this field
        // existed must not suddenly start losing its gateway credentials.
        let state = stamped_state(None);
        assert!(state.matches_server_origin(Some("https://proliferate.corp.example")));
    }

    #[test]
    fn matches_server_origin_treats_absent_current_origin_signal_as_a_match() {
        // No current-origin signal (e.g. a cloud sandbox launch, which never
        // sets the env var this is sourced from) -> never second-guess the
        // state file.
        let state = stamped_state(Some("https://proliferate.corp.example"));
        assert!(state.matches_server_origin(None));
    }

    fn state_with_revision(revision: i64) -> AgentAuthState {
        AgentAuthState {
            version: STATE_VERSION,
            revision,
            user_id: Some("user-1".into()),
            issuing_server_origin: None,
            harnesses: vec![HarnessAuth {
                harness_kind: "claude".into(),
                sources: vec![api_key_source("ANTHROPIC_API_KEY", "sk-raw")],
                settings: None,
            }],
        }
    }

    #[test]
    fn apply_state_file_writes_private_and_round_trips() {
        let home = TempHome::new("apply-write");
        let state = state_with_revision(7);
        apply_state_file(home.path(), &state).expect("apply");
        let loaded = load_state_file(home.path()).expect("load").expect("state");
        assert_eq!(loaded, state);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(state_file_path(home.path()))
                .expect("metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn apply_state_file_rejects_lower_revision_and_keeps_file() {
        let home = TempHome::new("apply-stale");
        apply_state_file(home.path(), &state_with_revision(5)).expect("apply");
        let error = apply_state_file(home.path(), &state_with_revision(4)).expect_err("stale");
        assert!(matches!(
            error,
            RouteAuthError::StaleStateRevision {
                incoming: 4,
                current: 5
            }
        ));
        assert_eq!(error.code(), "AGENT_ROUTE_STATE_STALE");
        let loaded = load_state_file(home.path()).expect("load").expect("state");
        assert_eq!(loaded.revision, 5);
    }

    #[test]
    fn apply_state_file_accepts_equal_and_higher_revisions() {
        let home = TempHome::new("apply-monotonic");
        apply_state_file(home.path(), &state_with_revision(5)).expect("apply");
        // Equal revision: content is authoritative (vkey rotation case).
        let mut rotated = state_with_revision(5);
        rotated.harnesses[0].harness_kind = "codex".into();
        apply_state_file(home.path(), &rotated).expect("equal revision");
        apply_state_file(home.path(), &state_with_revision(6)).expect("higher revision");
        let loaded = load_state_file(home.path()).expect("load").expect("state");
        assert_eq!(loaded.revision, 6);
    }

    #[test]
    fn apply_state_file_heals_a_malformed_file() {
        let home = TempHome::new("apply-heal");
        home.write_state_raw(b"{ not json");
        apply_state_file(home.path(), &state_with_revision(3)).expect("heal");
        let loaded = load_state_file(home.path()).expect("load").expect("state");
        assert_eq!(loaded.revision, 3);
    }
}
