//! The Rust side of the cross-plane contract fixtures
//! (`fixtures/contracts/workflow-definition/`): the server's validator and
//! this runtime must accept and reject the SAME definitions, and the fixtures
//! are the lockstep. Directory-driven on purpose — a fixture added for the
//! server plane is picked up here without a code change, so the two
//! validators cannot drift silently.

use std::path::PathBuf;

use serde_json::Value;

use super::definition::{InvocationSnapshot, WorkflowDefinition};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/contracts/workflow-definition")
}

fn load(name: &str) -> Value {
    let path = fixtures_dir().join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read fixture {}: {error}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|error| panic!("fixture {name} is not JSON: {error}"))
}

#[test]
fn valid_v2_fixtures_parse_and_validate() {
    for name in ["v2-full.json", "v2-minimal.json"] {
        let record = load(name);
        let definition: WorkflowDefinition = serde_json::from_value(record["definition"].clone())
            .unwrap_or_else(|error| panic!("{name}: definition must parse: {error}"));
        definition
            .validate()
            .unwrap_or_else(|error| panic!("{name}: definition must validate: {error:?}"));
    }
}

#[test]
fn the_run_snapshot_fixture_is_a_valid_put_body() {
    let snapshot_fixture = load("run-snapshot-v2.json");
    // The PUT contract: `id` is required (the invocation's own id), and the
    // remaining fields form a valid invocation snapshot; extras (`title`,
    // `definitionRevision`, ...) are tolerated.
    assert!(
        snapshot_fixture["id"].is_string(),
        "run snapshot must carry the invocation id"
    );
    let snapshot: InvocationSnapshot = serde_json::from_value(snapshot_fixture)
        .expect("run snapshot must parse as an invocation snapshot");
    snapshot
        .validate()
        .expect("run snapshot's definition must validate");
}

/// Every `v2-invalid-*.json` fixture declares HOW it must be rejected:
/// `"shape"` fails at the serde layer (the definition does not even parse),
/// `"structure"` parses but `validate()` refuses it. The runtime must agree
/// with the declaration exactly — a shape reject that only structure catches
/// (or the reverse) is validator drift.
#[test]
fn invalid_v2_fixtures_are_rejected_at_their_declared_layer() {
    let mut seen = 0usize;
    let entries = std::fs::read_dir(fixtures_dir()).expect("fixtures directory");
    for entry in entries {
        let name = entry.expect("dir entry").file_name();
        let name = name.to_string_lossy().to_string();
        if !name.starts_with("v2-invalid-") {
            continue;
        }
        seen += 1;
        let fixture = load(&name);
        let rejected_by = fixture["rejectedBy"]
            .as_str()
            .unwrap_or_else(|| panic!("{name}: missing rejectedBy"));
        let parsed = serde_json::from_value::<WorkflowDefinition>(fixture["definition"].clone());
        match rejected_by {
            "shape" => {
                assert!(parsed.is_err(), "{name}: shape reject must fail to parse");
            }
            "structure" => {
                let definition = parsed
                    .unwrap_or_else(|error| panic!("{name}: structure reject must parse: {error}"));
                assert!(
                    definition.validate().is_err(),
                    "{name}: structure reject must fail validate()"
                );
            }
            other => panic!("{name}: unknown rejectedBy {other}"),
        }
    }
    assert!(seen >= 12, "expected the fixture corpus, found {seen}");
}
