use std::collections::BTreeMap;

use super::*;
use crate::persistence::Db;

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
    let home = tempfile::tempdir().unwrap();
    let service = HarnessLaunchOptionsService::new(Db::open_in_memory().unwrap(), home.path().to_path_buf());
    let first = service.begin_probe("codex", "2026-08-19T00:00:00Z").unwrap();
    assert!(service.record_success(&first, &options(), "2026-08-19T00:00:01Z").unwrap());
    let stale = service.begin_probe("codex", "2026-08-19T00:00:02Z").unwrap();
    let newer = service.begin_probe("codex", "2026-08-19T00:00:03Z").unwrap();
    assert!(!service.record_success(&stale, &HarnessLaunchOptions::default(), "2026-08-19T00:00:04Z").unwrap());
    assert!(service.record_failure(&newer, "2026-08-19T00:00:05Z", "timeout").unwrap());
    let response = service.read("codex").unwrap().unwrap();
    assert_eq!(response.state, HarnessLaunchOptionsState::LastGoodAfterFailure);
    assert_eq!(response.options.unwrap().models[0].id, "unknown/fable");
}

#[test]
fn validation_is_exact_and_never_authors_a_fallback() {
    let home = tempfile::tempdir().unwrap();
    let service = HarnessLaunchOptionsService::new(Db::open_in_memory().unwrap(), home.path().to_path_buf());
    let started = service.begin_probe("codex", "2026-08-19T00:00:00Z").unwrap();
    service.record_success(&started, &options(), "2026-08-19T00:00:01Z").unwrap();
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
