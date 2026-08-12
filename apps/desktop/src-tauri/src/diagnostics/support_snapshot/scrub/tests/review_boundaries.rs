use crate::diagnostics::support_snapshot::schema::enums::SupportEvidenceSourceV1;
use crate::diagnostics::support_snapshot::scrub::{SupportExportScrubber, SupportTextKind};

const TRUNCATION_MARKER: &str = "...[TRUNCATED]";

fn limit(kind: SupportTextKind) -> usize {
    match kind {
        SupportTextKind::Generic => 4_096,
        SupportTextKind::Content => 16_384,
        _ => panic!("free-form test kind"),
    }
}

#[test]
fn source_position_cutoff_prevents_home_shrink_from_promoting_provider_material() {
    let home = "/Users/source-position-alice";
    let scrubber = SupportExportScrubber::new(Some(home.to_owned())).expect("configured scrubber");
    for kind in [SupportTextKind::Generic, SupportTextKind::Content] {
        let retained_limit = limit(kind) - TRUNCATION_MARKER.len();
        let mut input = format!("{home}/repo ").repeat(1_000);
        input.truncate(retained_limit);
        while !input.is_char_boundary(input.len()) {
            input.pop();
        }
        input.push_str(" ordinary-cutoff ");
        let canary = "gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
        input.push_str(canary);
        input.push_str(&"Z".repeat(20_000));

        let output = scrubber
            .scrub_text(input, SupportEvidenceSourceV1::Package, kind)
            .expect("position-aware text scrub");
        let retained = output.value.expect("retained bounded text");
        assert!(retained.ends_with(TRUNCATION_MARKER));
        assert!(!retained.contains(canary));
        assert!(!retained.contains("ordinary-cutoff"));
        assert_eq!(output.accounting.scrubbed_by_class.provider_credential, 0);
    }
}

#[test]
fn source_position_cutoff_survives_regex_shrink_and_crossing_userinfo() {
    for kind in [SupportTextKind::Generic, SupportTextKind::Content] {
        let retained_limit = limit(kind) - TRUNCATION_MARKER.len();
        let mut input = format!("Authorization: Bearer {}\n", "a".repeat(1_000));
        input.push_str(&"x".repeat(retained_limit - input.len()));
        let canary = "gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
        input.push_str(canary);
        input.push_str(&"Z".repeat(9_000));
        let output = SupportExportScrubber::default()
            .scrub_text(input, SupportEvidenceSourceV1::Package, kind)
            .expect("position-aware regex scrub");
        let retained = output.value.expect("retained bounded text");
        assert!(!retained.contains(canary));
        assert_eq!(output.accounting.scrubbed_by_class.authorization, 1);
        assert_eq!(output.accounting.scrubbed_by_class.provider_credential, 0);

        let userinfo = "postgresql://crossing-user:crossing-password@";
        let mut input = "x".repeat(retained_limit - userinfo.len() + 3);
        input.push_str(userinfo);
        input.push_str("host-after-cutoff.example/path");
        let output = SupportExportScrubber::default()
            .scrub_text(input, SupportEvidenceSourceV1::Package, kind)
            .expect("crossing userinfo scrub");
        let retained = output.value.expect("retained bounded text");
        assert!(!retained.contains("crossing-password"));
        assert!(!retained.contains("host-after-cutoff"));
        assert_eq!(output.accounting.scrubbed_by_class.url_userinfo, 1);
    }
}

#[test]
fn text_and_utf8_adapters_fail_closed_on_open_unicode_userinfo_at_scan_end() {
    for kind in [SupportTextKind::Generic, SupportTextKind::Content] {
        let retained_limit = limit(kind) - TRUNCATION_MARKER.len();
        let mut prefix = "é".repeat(retained_limit / 2 - 24);
        prefix.push_str(" postgresql://userinfo-canary:");
        let input = format!("{prefix}{}@db.test/path", "p".repeat(9_000));

        let text = SupportExportScrubber::default()
            .scrub_text(input.clone(), SupportEvidenceSourceV1::SessionLedger, kind)
            .expect("text adapter");
        let bytes = SupportExportScrubber::default()
            .scrub_utf8(
                input.as_bytes(),
                SupportEvidenceSourceV1::SessionLedger,
                kind,
            )
            .expect("UTF-8 adapter");

        for output in [text, bytes] {
            let retained = output.value.expect("retained scrubbed value");
            assert!(!retained.contains("userinfo-canary"));
            assert!(retained.contains("[REDACTED:url_userinfo]"));
            assert!(retained.ends_with(TRUNCATION_MARKER));
            assert_eq!(output.accounting.scrubbed_by_class.url_userinfo, 1);
            assert_eq!(output.accounting.truncations[0].omitted_bytes, None);
        }
    }
}

#[test]
fn open_pem_home_and_provider_constructs_crossing_cutoffs_never_leave_fragments() {
    let home = "/Users/cutoff-home-canary";
    let scrubber = SupportExportScrubber::new(Some(home.to_owned())).expect("configured scrubber");
    for (opener, class_marker) in [
        (
            "-----BEGIN PRIVATE KEY-----private-body-canary",
            "[REDACTED:private_key]",
        ),
        (
            "gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
            "[REDACTED:provider_credential]",
        ),
    ] {
        let retained_limit = 4_096 - TRUNCATION_MARKER.len();
        let mut input = "x".repeat(retained_limit - 32);
        input.push_str(opener);
        input.push_str(&"A".repeat(20_000));
        let output = scrubber
            .scrub_text(
                input,
                SupportEvidenceSourceV1::Renderer,
                SupportTextKind::Generic,
            )
            .expect("open construct scrub");
        let retained = output.value.expect("retained scrubbed value");
        assert!(retained.contains(class_marker));
        assert!(!retained.contains("private-body-canary"));
        assert!(!retained.contains("gho_"));
    }

    let retained_limit = 4_096 - TRUNCATION_MARKER.len();
    let input = format!("{}{home}/repo/secret-tail", "x".repeat(retained_limit - 8));
    let output = scrubber
        .scrub_text(
            input,
            SupportEvidenceSourceV1::Renderer,
            SupportTextKind::Generic,
        )
        .expect("home crossing cutoff");
    let retained = output.value.expect("retained normalized path");
    assert!(!retained.contains(home));
    assert!(retained.contains('~'));
    assert!(retained.ends_with(TRUNCATION_MARKER));
}

#[test]
fn omitted_bytes_include_marker_reservation_and_unicode_boundary_retreat() {
    let input = "€".repeat(2_000);
    let original_bytes = input.len();
    let output = SupportExportScrubber::default()
        .scrub_text(
            input,
            SupportEvidenceSourceV1::Renderer,
            SupportTextKind::Generic,
        )
        .expect("truncate Unicode source");
    let retained = output.value.expect("retained Unicode prefix");
    assert_eq!(retained.len(), 4_094);
    assert!(retained.ends_with(TRUNCATION_MARKER));
    // 4,096 minus the 14-byte marker is 4,082; the preceding complete
    // three-byte character ends at byte 4,080.
    assert_eq!(
        output.accounting.truncations[0].omitted_bytes,
        Some((original_bytes - 4_080) as u64)
    );
}

#[test]
fn mapped_utf8_tail_reports_exact_original_bytes_without_redaction() {
    let input = "é".repeat(20_000);
    let output = SupportExportScrubber::default()
        .scrub_utf8(
            input.as_bytes(),
            SupportEvidenceSourceV1::Anyharness,
            SupportTextKind::Content,
        )
        .expect("bounded UTF-8 adapter");
    assert_eq!(
        output.accounting.truncations[0].omitted_bytes,
        Some((input.len() - (16_384 - TRUNCATION_MARKER.len())) as u64)
    );
}

#[test]
fn padded_query_credential_crossing_visible_end_is_redacted_without_promotion() {
    let credential = "Aa0Bb1Cc2Dd3Ee4/Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn3Oo4P==";
    for kind in [SupportTextKind::Generic, SupportTextKind::Content] {
        let retained_limit = limit(kind) - TRUNCATION_MARKER.len();
        let url_prefix = " https://example.test/download?blob=";
        let mut input = "x".repeat(retained_limit - url_prefix.len() - 40);
        input.push_str(url_prefix);
        input.push_str(credential);
        input.push_str("&view=ordinary");

        let output = SupportExportScrubber::default()
            .scrub_text(input, SupportEvidenceSourceV1::Package, kind)
            .expect("crossing padded query credential");
        let retained = output.value.expect("retained bounded text");
        assert!(retained.contains("blob=[REDACTED:opaque_credential]"));
        assert!(!retained.contains(credential));
        assert!(!retained.contains("view=ordinary"));
        assert!(retained.ends_with(TRUNCATION_MARKER));
        assert_eq!(output.accounting.scrubbed_by_class.opaque_credential, 1);
        assert_eq!(output.accounting.truncations[0].omitted_bytes, None);
    }
}
