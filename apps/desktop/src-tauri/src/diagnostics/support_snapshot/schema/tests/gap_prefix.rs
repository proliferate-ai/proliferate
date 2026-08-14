//! Authorized projection of the unchanged PR 2 gap vector.

use proliferate_diagnostics_protocol::v1::types::{GapReasonV1, GapV1};

use super::super::model::snapshot::SupportSnapshotV3;
use super::super::validate::{stabilize_serialized_bytes, validate_snapshot};

fn populated() -> SupportSnapshotV3 {
    serde_json::from_str(include_str!("../fixtures/golden_populated_compact.json"))
        .expect("populated schema fixture")
}

fn gaps(count: usize) -> Vec<GapV1> {
    (0..count)
        .map(|index| GapV1 {
            reason: GapReasonV1::Evicted,
            from_cursor: Some(index as u64 + 1),
            to_cursor: Some(index as u64 + 1),
            component: None,
            producer_boot_id: None,
            missing_sequence_from: None,
            missing_sequence_to: None,
            dropped_records: 1,
        })
        .collect()
}

fn with_gap_count(count: usize) -> SupportSnapshotV3 {
    let mut snapshot = populated();
    let gaps = gaps(count);
    snapshot.collector.gaps = gaps.clone();
    snapshot
        .collector
        .export_manifest
        .as_mut()
        .expect("successful export manifest")
        .gaps = gaps.clone();
    snapshot.manifest.gaps = gaps.iter().take(128).cloned().collect();
    snapshot.manifest.additional_entries.gaps = count.saturating_sub(128) as u64;
    stabilize_serialized_bytes(&mut snapshot).expect("fixed point");
    snapshot
}

#[test]
fn support_manifest_keeps_exact_gap_prefix_and_checked_suffix_count() {
    for count in [128, 129, 256] {
        let snapshot = with_gap_count(count);
        validate_snapshot(&snapshot).unwrap_or_else(|error| panic!("{count}: {error}"));
        assert_eq!(
            snapshot.manifest.gaps,
            snapshot.collector.gaps[..count.min(128)]
        );
        assert_eq!(
            snapshot.manifest.additional_entries.gaps,
            count.saturating_sub(128) as u64
        );
    }
}

#[test]
fn gap_projection_rejects_a_non_prefix_or_wrong_suffix_count() {
    let mut wrong_prefix = with_gap_count(129);
    wrong_prefix.manifest.gaps.swap(0, 1);
    stabilize_serialized_bytes(&mut wrong_prefix).expect("fixed point");
    assert!(validate_snapshot(&wrong_prefix).is_err());

    let mut wrong_suffix = with_gap_count(256);
    wrong_suffix.manifest.additional_entries.gaps = 127;
    stabilize_serialized_bytes(&mut wrong_suffix).expect("fixed point");
    assert!(validate_snapshot(&wrong_suffix).is_err());
}
