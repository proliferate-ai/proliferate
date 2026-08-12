use crate::diagnostics::support_snapshot::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportTruncationReasonV1,
};
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::scrub::{
    SupportExportScrubber, SupportScrubError, SupportTextKind,
};

fn nested(depth: usize, leaf: SupportJsonValueV1) -> SupportJsonValueV1 {
    (0..depth).fold(leaf, |value, _| SupportJsonValueV1::Array(vec![value]))
}

#[test]
fn depth_sixteen_is_inclusive_and_depth_seventeen_fails_closed() {
    let scrubber = SupportExportScrubber::default();
    scrubber
        .scrub_value(
            nested(16, SupportJsonValueV1::Null),
            SupportEvidenceSourceV1::SessionLedger,
        )
        .expect("depth sixteen");

    let canary = "depth-error-canary-never-rendered";
    let error = scrubber
        .scrub_value(
            nested(17, SupportJsonValueV1::String(canary.to_owned())),
            SupportEvidenceSourceV1::SessionLedger,
        )
        .expect_err("depth seventeen must fail mandatory traversal");
    assert_eq!(error, SupportScrubError::TraversalLimit);
    assert!(!format!("{error:?} {error}").contains(canary));

    let optional = scrubber
        .scrub_optional_value(
            nested(17, SupportJsonValueV1::String(canary.to_owned())),
            SupportEvidenceSourceV1::SessionLedger,
        )
        .expect("optional depth omission");
    assert!(optional.value.is_none());
    assert_eq!(optional.accounting.omissions.len(), 1);
    assert_eq!(
        optional.accounting.omissions[0].reason,
        SupportOmissionReasonV1::SourceInvalid
    );
    assert!(!format!("{optional:?}").contains(canary));
}

#[test]
fn wide_arrays_and_objects_stop_at_256_with_exact_item_accounting() {
    let scrubber = SupportExportScrubber::default();
    let array = SupportJsonValueV1::Array(vec![SupportJsonValueV1::Null; 257]);
    let output = scrubber
        .scrub_value(array, SupportEvidenceSourceV1::Package)
        .expect("wide array truncates");
    let SupportJsonValueV1::Array(values) = output.value else {
        panic!("array output")
    };
    assert_eq!(values.len(), 256);
    assert_eq!(output.accounting.truncations.len(), 1);
    assert_eq!(
        output.accounting.truncations[0].reason,
        SupportTruncationReasonV1::ContainerItems
    );
    assert_eq!(output.accounting.truncations[0].count, 1);

    let canary = "omitted-wide-object-canary";
    let entries = (0..257)
        .map(|index| {
            (
                format!("key-{index:03}"),
                if index == 256 {
                    SupportJsonValueV1::String(canary.to_owned())
                } else {
                    SupportJsonValueV1::Integer(index)
                },
            )
        })
        .collect();
    let output = scrubber
        .scrub_value(
            SupportJsonValueV1::Object(entries),
            SupportEvidenceSourceV1::Package,
        )
        .expect("wide object truncates");
    let SupportJsonValueV1::Object(entries) = &output.value else {
        panic!("object output")
    };
    assert_eq!(entries.len(), 256);
    assert_eq!(output.accounting.truncations[0].count, 1);
    assert!(!serde_json::to_string(&output)
        .expect("serialize")
        .contains(canary));
}

#[test]
fn oversized_object_selection_is_independent_of_input_entry_order() {
    let entries = (0..257)
        .map(|index| {
            (
                format!("key-{index:03}"),
                SupportJsonValueV1::Integer(index),
            )
        })
        .collect::<Vec<_>>();
    let mut reversed = entries.clone();
    reversed.reverse();
    let scrubber = SupportExportScrubber::default();
    let left = scrubber
        .scrub_value(
            SupportJsonValueV1::Object(entries),
            SupportEvidenceSourceV1::Package,
        )
        .expect("ordered object");
    let right = scrubber
        .scrub_value(
            SupportJsonValueV1::Object(reversed),
            SupportEvidenceSourceV1::Package,
        )
        .expect("reversed object");
    assert_eq!(left, right);
}

#[test]
fn unicode_strings_truncate_on_a_boundary_with_manifest_accounting() {
    let output = SupportExportScrubber::default()
        .scrub_text(
            "é".repeat(9_000),
            SupportEvidenceSourceV1::Renderer,
            SupportTextKind::Content,
        )
        .expect("truncate unicode");
    let retained = output.value.expect("retained content");
    assert!(retained.len() <= 16_384);
    assert!(retained.is_char_boundary(retained.len()));
    assert!(retained.ends_with("...[TRUNCATED]"));
    assert_eq!(output.accounting.truncations.len(), 1);
    assert_eq!(
        output.accounting.truncations[0].reason,
        SupportTruncationReasonV1::FieldBytes
    );
    assert_eq!(output.accounting.truncations[0].omitted_bytes, Some(1_630));
}

#[test]
fn oversized_identifiers_are_omitted_instead_of_truncated() {
    let output = SupportExportScrubber::default()
        .scrub_text(
            "i".repeat(129),
            SupportEvidenceSourceV1::Collector,
            SupportTextKind::Identifier,
        )
        .expect("omit oversized identifier");
    assert!(output.value.is_none());
    assert!(output.accounting.truncations.is_empty());
    assert_eq!(output.accounting.omissions[0].count, 1);
    assert_eq!(
        output.accounting.omissions[0].reason,
        SupportOmissionReasonV1::SourceCap
    );
    assert_eq!(output.accounting.omissions[0].known_bytes, Some(129));
}

#[test]
fn invalid_utf8_in_the_bounded_source_prefix_omits_only_that_unit() {
    let canary = b"invalid-utf8-canary";
    let mut bytes = b"prefix ".to_vec();
    bytes.push(0xff);
    bytes.extend_from_slice(canary);
    let output = SupportExportScrubber::default()
        .scrub_utf8(
            &bytes,
            SupportEvidenceSourceV1::DesktopWorker,
            SupportTextKind::Content,
        )
        .expect("invalid UTF-8 is an optional omission");
    assert!(output.value.is_none());
    assert_eq!(
        output.accounting.omissions[0].reason,
        SupportOmissionReasonV1::SourceInvalid
    );
    let visible = format!(
        "{output:?} {}",
        serde_json::to_string(&output.accounting).expect("serialize accounting")
    );
    assert!(!visible.contains("invalid-utf8-canary"));
}

#[test]
fn unscanned_multimegabyte_tail_is_never_allocated_into_output() {
    let mut bytes = vec![b'x'; 3_000_000];
    bytes[2_999_999] = 0xff;
    let output = SupportExportScrubber::default()
        .scrub_utf8(
            &bytes,
            SupportEvidenceSourceV1::Anyharness,
            SupportTextKind::Generic,
        )
        .expect("bounded prefix remains valid");
    let retained = output.value.expect("bounded retained prefix");
    assert!(retained.len() <= 4_096);
    assert_eq!(output.accounting.truncations.len(), 1);
}
