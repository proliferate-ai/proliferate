//! Rust leg of T1-WF-CONTRACT-01.
//!
//! Parses and re-serializes every shared golden workflow contract fixture,
//! asserting a byte-faithful (semantic) round-trip, and proves the strict
//! version/kind failure behavior the feature spec requires. Cross-language hash
//! agreement is proven by the Python and TypeScript legs of
//! `scripts/check_workflow_contract_fixtures.py`.
//!
//! Run: `cargo test -p anyharness-contract workflow_contract_fixtures`

use std::path::{Path, PathBuf};

use anyharness_contract::v1::{
    CheckpointManifest, ExecutionBinding, ExecutionEnvelope, GatewayCallReceipt,
    MaterializationOffer, ObservedRun, ResolvedPlan, WorkflowControlCommand,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/contracts/workflows/fixtures")
        .canonicalize()
        .expect("locate fixtures dir")
}

fn read(name: &str) -> String {
    std::fs::read_to_string(fixtures_dir().join(name))
        .unwrap_or_else(|e| panic!("read fixture {name}: {e}"))
}

/// Strict parse, then re-serialize, and assert the JSON value is preserved.
fn assert_roundtrip<T: DeserializeOwned + Serialize>(name: &str) {
    let text = read(name);
    let original: Value = serde_json::from_str(&text).expect("parse fixture json");
    let typed: T =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("strict parse {name}: {e}"));
    let reserialized = serde_json::to_value(&typed).expect("serialize typed");
    assert_eq!(
        reserialized, original,
        "{name} did not round-trip byte-faithfully"
    );
}

#[test]
fn workflow_contract_fixtures_roundtrip_all() {
    assert_roundtrip::<ResolvedPlan>("resolved-plan-v2.json");
    assert_roundtrip::<CheckpointManifest>("checkpoint-manifest-v1.json");
    assert_roundtrip::<ExecutionBinding>("execution-binding-v1.json");
    assert_roundtrip::<MaterializationOffer>("materialization-offer-v1.json");
    assert_roundtrip::<ExecutionEnvelope>("execution-envelope-v1.json");
    assert_roundtrip::<ObservedRun>("observed-run-v2.json");
    assert_roundtrip::<GatewayCallReceipt>("gateway-call-receipt-v1.json");
    assert_roundtrip::<WorkflowControlCommand>("workflow-control-command-v1.json");
}

#[test]
fn workflow_contract_fixtures_reject_unknown_plan_version() {
    let mut plan: Value = serde_json::from_str(&read("resolved-plan-v2.json")).unwrap();
    plan["planVersion"] = Value::from(99);
    assert!(
        serde_json::from_value::<ResolvedPlan>(plan).is_err(),
        "an unknown plan version must fail strict parsing"
    );
}

#[test]
fn workflow_contract_fixtures_reject_unknown_step_kind() {
    let mut plan: Value = serde_json::from_str(&read("resolved-plan-v2.json")).unwrap();
    plan["spine"][0]["steps"][0]["kind"] = Value::from("agent.telepathy");
    assert!(
        serde_json::from_value::<ResolvedPlan>(plan).is_err(),
        "an unknown step kind must fail strict parsing"
    );
}

#[test]
fn workflow_contract_fixtures_reject_structural_checkpoint_invalids() {
    let cases: Value =
        serde_json::from_str(&read("invalid/checkpoint-manifest-invalid-cases.json")).unwrap();
    // Cases the strict Rust type can catch structurally (enums + deny_unknown_fields).
    let structural = [
        "invalid_mode",
        "unknown_origin",
        "unknown_object_format",
        "unknown_top_level_field",
    ];
    for case in cases["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        if structural.contains(&name) {
            assert!(
                serde_json::from_value::<CheckpointManifest>(case["document"].clone()).is_err(),
                "invalid checkpoint manifest '{name}' must fail strict parsing"
            );
        }
    }
}

#[test]
fn workflow_contract_fixtures_legacy_upgrade_grammar_and_shape() {
    let fixture: Value = serde_json::from_str(&read("legacy-definition-upgrade-v1.json")).unwrap();
    let version = fixture["newWorkflowVersionId"].as_str().unwrap();
    assert_eq!(
        fixture["namespace"].as_str().unwrap(),
        "2b5e907a-2cd8-5b8f-b5ab-5c891bb93263"
    );
    for row in fixture["expectedIds"].as_array().unwrap() {
        let kind = row["kind"].as_str().unwrap();
        let identity = row["identity"].as_str().unwrap();
        let name = row["name"].as_str().unwrap();
        let uuid = row["uuid"].as_str().unwrap();
        let expected_name =
            format!("workflow-version={version}\nkind={kind}\nidentity={identity}");
        assert_eq!(name, expected_name, "legacy identity name grammar");
        // Lowercase, dashed, and a UUIDv5 (version nibble at index 14 is '5').
        assert_eq!(uuid, uuid.to_lowercase(), "uuid must be lowercase");
        let compact: String = uuid.chars().filter(|c| *c != '-').collect();
        assert_eq!(compact.len(), 32, "uuid must be 32 hex chars");
        assert_eq!(
            compact.as_bytes()[12] as char,
            '5',
            "legacy ids must be UUIDv5"
        );
    }
}

#[test]
fn workflow_contract_fixtures_credential_canary_absent() {
    let canary: Value = serde_json::from_str(&read("credential-canary.json")).unwrap();
    let marker = canary["marker"].as_str().unwrap();
    for name in canary["fixturesThatMustNotContainMarker"].as_array().unwrap() {
        let text = read(name.as_str().unwrap());
        assert!(
            !text.contains(marker),
            "credential canary leaked into {}",
            name
        );
    }
    // Public (non-envelope) surfaces carry no dummy credential either.
    for name in [
        "resolved-plan-v2.json",
        "observed-run-v2.json",
        "gateway-call-receipt-v1.json",
    ] {
        assert!(
            !read(name).contains("DUMMY_FAKE"),
            "a dummy credential leaked into public surface {name}"
        );
    }
}
