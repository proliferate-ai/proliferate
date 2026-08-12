use crate::diagnostics::support_snapshot::schema::enums::SupportEvidenceSourceV1;
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::scrub::{SupportExportScrubber, SupportTextKind};

fn scrub(input: &str) -> String {
    SupportExportScrubber::default()
        .scrub_text(
            input.to_owned(),
            SupportEvidenceSourceV1::SessionLedger,
            SupportTextKind::Content,
        )
        .expect("scrub text")
        .value
        .expect("retained text")
}

#[test]
fn generic_uri_userinfo_covers_database_ftp_and_hostless_forms() {
    for (input, retained) in [
        (
            "postgresql://db-user:db-pass@db.test/name?sslmode=require",
            "postgresql://db.test/name?sslmode=require",
        ),
        (
            "ftp://ftp-user:ftp-pass@files.test/path/file.txt",
            "ftp://files.test/path/file.txt",
        ),
        ("ftp://hostless-user:hostless-pass@/path", "ftp:///path"),
        (
            "postgresql://hostless-user:hostless-pass@?keep=1",
            "postgresql://?keep=1",
        ),
    ] {
        assert_eq!(scrub(input), retained);
    }
}

#[test]
fn x_goog_signed_parameters_redact_individually_and_preserve_fragment() {
    let input = "https://storage.test/object?keep=1&X-Goog-Credential=credential-canary\
        &X-Goog-Signature=signature-canary#section=ordinary";
    let output = SupportExportScrubber::default()
        .scrub_text(
            input.to_owned(),
            SupportEvidenceSourceV1::Renderer,
            SupportTextKind::Content,
        )
        .expect("scrub signed URL");
    let retained = output.value.expect("retained URL");
    assert!(retained.contains("?keep=1"));
    assert!(retained.contains("X-Goog-Credential=[REDACTED:signed_url]"));
    assert!(retained.contains("X-Goog-Signature=[REDACTED:signed_url]"));
    assert!(retained.contains("#section=ordinary"));
    assert!(!retained.contains("credential-canary"));
    assert!(!retained.contains("signature-canary"));
    assert_eq!(output.accounting.scrubbed_by_class.signed_url, 2);

    let retained =
        scrub("https://storage.test/object?keep=1#X-Goog-Signature=fragment-canary&view=ordinary");
    assert!(retained.contains("#X-Goog-Signature=[REDACTED:signed_url]"));
    assert!(retained.contains("&view=ordinary"));
    assert!(!retained.contains("fragment-canary"));
}

#[test]
fn all_normal_github_token_prefixes_and_bare_secret_env_names_are_closed() {
    for prefix in ["ghp", "gho", "ghu", "ghs", "ghr"] {
        let canary = format!("{prefix}_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
        let retained = scrub(&canary);
        assert_eq!(retained, "[REDACTED:provider_credential]");
        assert!(!retained.contains(&canary));
    }

    let output = SupportExportScrubber::default()
        .scrub_text(
            "TOKEN=token-canary\nKEY=key-canary\nSECRET=secret-canary\nCREDENTIAL=credential-canary"
                .to_owned(),
            SupportEvidenceSourceV1::DesktopWorker,
            SupportTextKind::Content,
        )
        .expect("scrub bare environment assignments");
    let retained = output.value.expect("retained labels");
    for canary in [
        "token-canary",
        "key-canary",
        "secret-canary",
        "credential-canary",
    ] {
        assert!(!retained.contains(canary));
    }
    assert_eq!(output.accounting.scrubbed_by_class.environment_secret, 4);
}

#[test]
fn structural_and_free_form_derived_suffixes_peel_until_the_secret_base() {
    let canary = "derived-secret-canary";
    let value = SupportJsonValueV1::Object(vec![
        (
            "access_token_hash_prefix_length".to_owned(),
            SupportJsonValueV1::String(canary.to_owned()),
        ),
        (
            "secret_key_suffix_digest_fingerprint".to_owned(),
            SupportJsonValueV1::String(canary.to_owned()),
        ),
        (
            "session_token_sha256_checksum".to_owned(),
            SupportJsonValueV1::String(canary.to_owned()),
        ),
        (
            "security-token-prefix-hash".to_owned(),
            SupportJsonValueV1::String(canary.to_owned()),
        ),
    ]);
    let output = SupportExportScrubber::default()
        .scrub_value(value, SupportEvidenceSourceV1::SessionLedger)
        .expect("scrub chained structural suffixes");
    let serialized = serde_json::to_string(&output.value).expect("serialize output");
    assert!(!serialized.contains(canary));
    assert_eq!(output.accounting.scrubbed_by_class.access_token, 3);
    assert_eq!(output.accounting.scrubbed_by_class.api_key, 1);

    let output = SupportExportScrubber::default()
        .scrub_text(
            "access_token_hash_prefix_length=access-canary\n\
             secret_key_suffix_digest_fingerprint=key-canary\n\
             SECRET_hash_prefix=env-canary"
                .to_owned(),
            SupportEvidenceSourceV1::SessionLedger,
            SupportTextKind::Content,
        )
        .expect("scrub chained free-form suffixes");
    let retained = output.value.expect("retained labels");
    assert!(!retained.contains("access-canary"));
    assert!(!retained.contains("key-canary"));
    assert!(!retained.contains("env-canary"));
    assert_eq!(output.accounting.scrubbed_by_class.access_token, 1);
    assert_eq!(output.accounting.scrubbed_by_class.api_key, 1);
    assert_eq!(output.accounting.scrubbed_by_class.environment_secret, 1);
}

#[test]
fn structural_session_security_and_secret_keys_are_exactly_closed() {
    let value = SupportJsonValueV1::Object(vec![
        (
            "secret-key".to_owned(),
            SupportJsonValueV1::String("key-canary".to_owned()),
        ),
        (
            "session_token".to_owned(),
            SupportJsonValueV1::String("session-canary".to_owned()),
        ),
        (
            "Security Token".to_owned(),
            SupportJsonValueV1::String("security-canary".to_owned()),
        ),
        (
            "session_token_count".to_owned(),
            SupportJsonValueV1::Integer(4),
        ),
    ]);
    let output = SupportExportScrubber::default()
        .scrub_value(value, SupportEvidenceSourceV1::Package)
        .expect("scrub exact structural keys");
    let serialized = serde_json::to_string(&output.value).expect("serialize output");
    assert!(!serialized.contains("key-canary"));
    assert!(!serialized.contains("session-canary"));
    assert!(!serialized.contains("security-canary"));
    assert!(serialized.contains("\"session_token_count\":4"));
    assert_eq!(output.accounting.scrubbed_by_class.api_key, 1);
    assert_eq!(output.accounting.scrubbed_by_class.access_token, 2);
}

#[test]
fn long_paths_urls_queries_and_monkey_survive_but_real_opaque_tokens_do_not() {
    let path = "/Users/alice/Workspace-2026/Project_A1-B2-C3/source/module/file-name.rs";
    let url = "https://example.test/Aa0_Bb1-Cc2_Dd3-Ee4_Ff5-Gg6_Hh7-Ii8?view=Aa0_Bb1-Cc2_Dd3-Ee4_Ff5-Gg6_Hh7-Ii8&MONKEY=ordinary";
    let relative = "workspace-2026/project_A1-B2/source_C3-D4/generated_E5-F6/output.txt";
    let ordinary =
        format!("path={path}\nurl={url}\nrelative={relative}\nQUERY=ordinary-query\nMONKEY=banana");
    assert_eq!(scrub(&ordinary), ordinary);

    let opaque = "Aa0_Bb1_Cc2_Dd3_Ee4_Ff5_Gg6_Hh7_Ii8_Jj9_Kk0_Ll1_Mm2";
    assert!(opaque.len() >= 48);
    assert_eq!(scrub(opaque), "[REDACTED:opaque_credential]");

    let url = format!("https://example.test/download?blob={opaque}&view=ordinary");
    let retained = scrub(&url);
    assert_eq!(
        retained,
        "https://example.test/download?blob=[REDACTED:opaque_credential]&view=ordinary"
    );

    let path = format!("path=/tmp/{opaque}/support-report.json");
    let retained = scrub(&path);
    assert_eq!(
        retained,
        "path=/tmp/[REDACTED:opaque_credential]/support-report.json"
    );

    let padded = "Aa0Bb1Cc2Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn3Oo4P==";
    assert_eq!(padded.len(), 48);
    assert_eq!(scrub(padded), "[REDACTED:opaque_credential]");
    let url = format!("https://example.test/download?blob={padded}&view=ordinary");
    assert_eq!(
        scrub(&url),
        "https://example.test/download?blob=[REDACTED:opaque_credential]&view=ordinary"
    );
    let path = format!("path=/tmp/prefix&{padded}");
    assert_eq!(
        scrub(&path),
        "path=/tmp/prefix&[REDACTED:opaque_credential]"
    );

    let url = format!("https://example.test/download?blob=prefix.{padded}&view=ordinary");
    assert_eq!(
        scrub(&url),
        "https://example.test/download?blob=prefix.[REDACTED:opaque_credential]&view=ordinary"
    );

    let internal_slash = "Aa0Bb1Cc2Dd3Ee4/Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn3Oo4P==";
    assert!(internal_slash.len() >= 48);
    let url = format!("https://example.test/download?blob={internal_slash}&view=ordinary");
    assert_eq!(
        scrub(&url),
        "https://example.test/download?blob=[REDACTED:opaque_credential]&view=ordinary"
    );
}

#[test]
fn multibyte_whitespace_bounds_contextual_path_and_query_candidates() {
    let padded = "Aa0Bb1Cc2Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn3Oo4P==";
    let path = format!("prefix\u{2003}path=/tmp/{padded}/support-report.json");
    assert_eq!(
        scrub(&path),
        "prefix\u{2003}path=/tmp/[REDACTED:opaque_credential]/support-report.json"
    );

    let query = format!("prefix\u{2003}https://example.test/download?blob={padded}&view=ordinary");
    assert_eq!(
        scrub(&query),
        "prefix\u{2003}https://example.test/download?blob=[REDACTED:opaque_credential]&view=ordinary"
    );
}
