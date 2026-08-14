use sha2::{Digest, Sha256};

use super::super::assemble_support_snapshot;
use super::{input_from_fixture, SCHEMA_NO_EVIDENCE, SCHEMA_POPULATED};

const NO_EVIDENCE: &str = include_str!("../fixtures/golden_no_evidence.json");
const POPULATED: &str = include_str!("../fixtures/golden_populated.json");

#[test]
fn no_evidence_assembly_is_exact_compact_json_and_stable_sha() {
    let output = assemble_support_snapshot(input_from_fixture(SCHEMA_NO_EVIDENCE))
        .expect("no-evidence assembly");
    assert_eq!(output.compact_json, NO_EVIDENCE.trim_end().as_bytes());
    assert_eq!(output.serialized_bytes, output.compact_json.len() as u64);
    assert_eq!(
        output.snapshot.manifest.serialized_bytes,
        output.serialized_bytes
    );
    assert_eq!(
        output.sha256,
        "15963d9efac7ce485be125f6d8c36d55d53df46ccaaec06bfa35d3762e68a628"
    );
}

#[test]
fn populated_assembly_is_exact_compact_json_and_stable_sha() {
    let output = assemble_support_snapshot(input_from_fixture(SCHEMA_POPULATED))
        .expect("populated assembly");
    assert_eq!(output.compact_json, POPULATED.trim_end().as_bytes());
    assert_eq!(
        output.sha256,
        "a1eabed4541560bbeba7eccfd3b5adefeb39d5e744e7b880df7c42b3153dae97"
    );
    assert_eq!(output.snapshot.manifest.degradation.removed_by_tier, [0; 8]);
    assert_eq!(
        Sha256::digest(&output.compact_json).as_slice(),
        Sha256::digest(POPULATED.trim_end().as_bytes()).as_slice()
    );
}

#[test]
fn serialized_bytes_is_a_stable_self_referential_fixed_point() {
    for fixture in [SCHEMA_NO_EVIDENCE, SCHEMA_POPULATED] {
        let first = assemble_support_snapshot(input_from_fixture(fixture)).expect("first");
        let encoded = serde_json::to_vec(&first.snapshot).expect("encode");
        assert_eq!(encoded, first.compact_json);
        assert_eq!(
            encoded.len() as u64,
            first.snapshot.manifest.serialized_bytes
        );
    }
}
