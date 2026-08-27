use std::collections::BTreeMap;

use super::*;
use crate::app::test_support::lock_env;
use crate::domains::agents::installer::manifest::{record_entries, role_name, ManifestArtifact};
use crate::domains::agents::model::ArtifactRole;
use crate::persistence::Db;

struct TestRuntimeHome(std::path::PathBuf);

impl TestRuntimeHome {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-launch-options-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp runtime home");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TestRuntimeHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn options() -> HarnessLaunchOptions {
    HarnessLaunchOptions {
        models: vec![HarnessLaunchModel {
            id: "unknown/fable".to_string(),
            observed_name: None,
            observed_description: None,
        }],
        controls: vec![HarnessLaunchControl {
            id: "mode".to_string(),
            observed_label: Some("Access".to_string()),
            observed_description: None,
            values: vec![HarnessLaunchControlValue {
                value: "agent-full-access".to_string(),
                observed_label: None,
                observed_description: None,
            }],
        }],
        defaults: HarnessLaunchDefaults::default(),
        model_controls: Vec::new(),
    }
}

fn observed_control(id: &str, current_value: &str, values: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": id,
        "currentValue": current_value,
        "options": values
            .iter()
            .map(|value| serde_json::json!({ "value": value, "name": value }))
            .collect::<Vec<_>>(),
    })
}

fn claude_model_scoped_snapshot() -> crate::domains::agents::live_ports::ProbeSnapshot {
    let mut snapshot = crate::domains::agents::launch_probe::test_support::snapshot(
        "claude",
        &["opus".to_string(), "fable".to_string()],
    );
    snapshot.current_model_id = Some("opus".to_string());
    snapshot.baseline_config_options = serde_json::json!([
        observed_control("mode", "default", &["default", "plan"]),
        observed_control("effort", "high", &["low", "high"]),
        observed_control("fast", "off", &["off", "on"]),
    ]);
    snapshot.models[0].config_options = Some(serde_json::json!([
        observed_control("mode", "default", &["default", "plan"]),
        observed_control("effort", "high", &["low", "high"]),
        observed_control("fast", "off", &["off", "on"]),
    ]));
    snapshot.models[1].config_options = Some(serde_json::json!([
        observed_control("mode", "default", &["default", "plan"]),
        observed_control("effort", "high", &["low", "high"]),
    ]));
    snapshot
}

#[test]
fn state_machine_preserves_last_good_and_discards_stale_completion() {
    // `begin_probe`/`record_*` compare basis revisions, and
    // `compute_harness_basis_revision` hashes process-global inputs (PATH
    // walks, `CLAUDE_CODE_EXECUTABLE`) that other tests mutate under
    // `lock_env` — hold the same lock or the basis flips mid-test.
    let _env = lock_env();
    let home = TestRuntimeHome::new("last-good");
    let service =
        HarnessLaunchOptionsService::new(Db::open_in_memory().unwrap(), home.path().to_path_buf());
    let first = service
        .begin_probe("codex", "2026-08-19T00:00:00Z")
        .unwrap();
    assert!(service
        .record_success(&first, &options(), "2026-08-19T00:00:01Z")
        .unwrap());
    let stale = service
        .begin_probe("codex", "2026-08-19T00:00:02Z")
        .unwrap();
    let newer = service
        .begin_probe("codex", "2026-08-19T00:00:03Z")
        .unwrap();
    assert!(!service
        .record_success(
            &stale,
            &HarnessLaunchOptions::default(),
            "2026-08-19T00:00:04Z"
        )
        .unwrap());
    assert!(service
        .record_failure(&newer, "2026-08-19T00:00:05Z", "timeout")
        .unwrap());
    let response = service.read("codex").unwrap().unwrap();
    assert_eq!(
        response.state,
        HarnessLaunchOptionsState::LastGoodAfterFailure
    );
    assert_eq!(response.options.unwrap().models[0].id, "unknown/fable");
}

#[test]
fn validation_is_exact_and_never_authors_a_fallback() {
    // Same basis coupling as the state-machine test above: validation reads
    // the recorded snapshot back, so the env-derived basis must not move.
    let _env = lock_env();
    let home = TestRuntimeHome::new("validation");
    let service =
        HarnessLaunchOptionsService::new(Db::open_in_memory().unwrap(), home.path().to_path_buf());
    let started = service
        .begin_probe("codex", "2026-08-19T00:00:00Z")
        .unwrap();
    service
        .record_success(&started, &options(), "2026-08-19T00:00:01Z")
        .unwrap();
    let accepted = LaunchSelection {
        model_id: Some("unknown/fable".to_string()),
        control_values: BTreeMap::from([("mode".to_string(), "agent-full-access".to_string())]),
    };
    service.validate_selection("codex", &accepted).unwrap();
    let rejected = LaunchSelection {
        model_id: Some("unknown/fable".to_string()),
        control_values: BTreeMap::from([("mode".to_string(), "full-access".to_string())]),
    };
    assert!(matches!(
        service.validate_selection("codex", &rejected),
        Err(LaunchSelectionUnsupported::ControlValue { .. })
    ));
}

#[test]
fn probe_legacy_modes_are_not_advertised_without_a_confirmable_config_control() {
    let snapshot = crate::domains::agents::launch_probe::test_support::snapshot(
        "codex",
        &["gpt-5.6-sol".to_string()],
    );

    let options = HarnessLaunchOptionsService::options_from_probe(&snapshot)
        .expect("codex projection does not require model-scoped controls");

    assert!(options.controls.is_empty());
    assert!(options.defaults.control_values.is_empty());
}

#[test]
fn claude_probe_projects_exact_model_scoped_controls_and_defaults() {
    let options = HarnessLaunchOptionsService::options_from_probe(&claude_model_scoped_snapshot())
        .expect("complete Claude model-control matrix projects");

    assert_eq!(options.model_controls.len(), 2);
    let opus = options
        .model_controls
        .iter()
        .find(|scope| scope.model_id == "opus")
        .expect("opus scope");
    assert_eq!(
        opus.controls
            .iter()
            .map(|control| control.id.as_str())
            .collect::<Vec<_>>(),
        vec!["mode", "effort", "fast"]
    );
    assert_eq!(opus.default_control_values["fast"], "off");

    let fable = options
        .model_controls
        .iter()
        .find(|scope| scope.model_id == "fable")
        .expect("fable scope");
    assert_eq!(
        fable
            .controls
            .iter()
            .map(|control| control.id.as_str())
            .collect::<Vec<_>>(),
        vec!["mode", "effort"]
    );
    assert_eq!(
        fable.default_control_values,
        BTreeMap::from([
            ("effort".to_string(), "high".to_string()),
            ("mode".to_string(), "default".to_string()),
        ])
    );
}

#[test]
fn claude_probe_rejects_an_incomplete_model_control_matrix() {
    let mut snapshot = claude_model_scoped_snapshot();
    snapshot.models[1].config_options = None;

    let error = HarnessLaunchOptionsService::options_from_probe(&snapshot)
        .expect_err("partial Claude model-control matrix must fail closed");

    assert_eq!(
        error.to_string(),
        "model-scoped launch-control observation was incomplete"
    );
}

#[test]
fn validation_uses_selected_model_scope_and_falls_back_only_when_absent() {
    let home = TestRuntimeHome::new("model-scoped-validation");
    let service =
        HarnessLaunchOptionsService::new(Db::open_in_memory().unwrap(), home.path().to_path_buf());
    let started = service
        .begin_probe("claude", "2026-08-19T00:00:00Z")
        .unwrap();
    let mut projected =
        HarnessLaunchOptionsService::options_from_probe(&claude_model_scoped_snapshot())
            .expect("complete Claude model-control matrix projects");
    projected.defaults.model_id = Some("fable".to_string());
    service
        .record_success(&started, &projected, "2026-08-19T00:00:01Z")
        .unwrap();

    service
        .validate_selection(
            "claude",
            &LaunchSelection {
                model_id: Some("opus".to_string()),
                control_values: BTreeMap::from([("fast".to_string(), "on".to_string())]),
            },
        )
        .expect("opus offers fast");
    assert!(matches!(
        service.validate_selection(
            "claude",
            &LaunchSelection {
                model_id: None,
                control_values: BTreeMap::from([("fast".to_string(), "on".to_string())]),
            },
        ),
        Err(LaunchSelectionUnsupported::Control { control_id, .. }) if control_id == "fast"
    ));
    assert!(matches!(
        service.validate_selection(
            "claude",
            &LaunchSelection {
                model_id: Some("fable".to_string()),
                control_values: BTreeMap::from([("fast".to_string(), "off".to_string())]),
            },
        ),
        Err(LaunchSelectionUnsupported::Control { control_id, .. }) if control_id == "fast"
    ));
    service
        .validate_selection(
            "claude",
            &LaunchSelection {
                model_id: Some("fable".to_string()),
                control_values: BTreeMap::from([
                    ("effort".to_string(), "high".to_string()),
                    ("mode".to_string(), "plan".to_string()),
                ]),
            },
        )
        .expect("fable offers mode and effort");

    let legacy_started = service
        .begin_probe("codex", "2026-08-19T00:00:02Z")
        .unwrap();
    service
        .record_success(&legacy_started, &options(), "2026-08-19T00:00:03Z")
        .unwrap();
    service
        .validate_selection(
            "codex",
            &LaunchSelection {
                model_id: Some("unknown/fable".to_string()),
                control_values: BTreeMap::from([(
                    "mode".to_string(),
                    "agent-full-access".to_string(),
                )]),
            },
        )
        .expect("legacy row without a model scope uses baseline controls");
}

#[test]
fn native_identity_change_then_probe_failure_never_serves_old_options() {
    let home = TestRuntimeHome::new("native-identity");
    let manifest_entries = |native_sha: &str| {
        vec![
            ManifestArtifact {
                role: role_name(&ArtifactRole::AgentProcess).to_string(),
                version: Some("adapter-1".to_string()),
                sha256: Some("adapter-sha".to_string()),
                source: "managed_npm".to_string(),
                installed_at: "2026-08-19T00:00:00Z".to_string(),
                path: "not-hashed".to_string(),
            },
            ManifestArtifact {
                role: role_name(&ArtifactRole::NativeCli).to_string(),
                version: Some("native-1".to_string()),
                sha256: Some(native_sha.to_string()),
                source: "managed".to_string(),
                installed_at: "2026-08-19T00:00:00Z".to_string(),
                path: "not-hashed".to_string(),
            },
        ]
    };
    record_entries(home.path(), "claude", manifest_entries("native-sha-1")).unwrap();

    let service =
        HarnessLaunchOptionsService::new(Db::open_in_memory().unwrap(), home.path().to_path_buf());
    let first = service
        .begin_probe("claude", "2026-08-19T00:00:00Z")
        .unwrap();
    service
        .record_success(&first, &options(), "2026-08-19T00:00:01Z")
        .unwrap();

    record_entries(home.path(), "claude", manifest_entries("native-sha-2")).unwrap();
    let changed = service
        .begin_probe("claude", "2026-08-19T00:00:02Z")
        .unwrap();
    assert_ne!(changed.basis_revision, first.basis_revision);
    assert!(
        changed.options.is_none(),
        "basis change must clear old options"
    );
    service
        .record_failure(&changed, "2026-08-19T00:00:03Z", "spawn_failed")
        .unwrap();

    let response = service.read("claude").unwrap().unwrap();
    assert_eq!(
        response.state,
        HarnessLaunchOptionsState::FailedWithoutObservation
    );
    assert!(response.options.is_none());
}
