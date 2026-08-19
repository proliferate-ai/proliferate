use std::collections::BTreeMap;

use super::*;
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
    }
}

#[test]
fn state_machine_preserves_last_good_and_discards_stale_completion() {
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
