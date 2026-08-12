use crate::diagnostics::support_snapshot::schema::enums::{
    SupportEvidenceSourceV1, SupportSecretClassV1,
};
use crate::diagnostics::support_snapshot::schema::model::common::SupportJsonValueV1;
use crate::diagnostics::support_snapshot::scrub::SupportExportScrubber;

fn object(entries: Vec<(&str, SupportJsonValueV1)>) -> SupportJsonValueV1 {
    SupportJsonValueV1::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn string(value: &str) -> SupportJsonValueV1 {
    SupportJsonValueV1::String(value.to_owned())
}

#[test]
fn normalized_exact_structural_keys_cover_every_field_and_container_class() {
    let canary = "never-serialize-structural-canary";
    let value = object(vec![
        ("AUTHORIZATION_HEADER", string(canary)),
        ("Set-Cookie", string(canary)),
        ("Access Token", string(canary)),
        ("refresh_token", string(canary)),
        ("Identity-Token", string(canary)),
        ("X_API_KEY", string(canary)),
        ("client-secret", string(canary)),
        ("PassPhrase", string(canary)),
        ("signing_key", string(canary)),
        (
            "Credential-Store",
            object(vec![
                ("password", string(canary)),
                ("nested", string(canary)),
            ]),
        ),
        (
            "RAW_ENVIRONMENT",
            object(vec![("SAFE_NAME", string(canary))]),
        ),
        ("AWS-Access-Key-Id", string(canary)),
        ("Pre-Signed_URL", string(canary)),
        ("secret_value", string(canary)),
        ("URL_UserInfo", string(canary)),
    ]);
    let output = SupportExportScrubber::default()
        .scrub_value(value, SupportEvidenceSourceV1::SessionLedger)
        .expect("scrub structural fixture");
    let serialized = serde_json::to_string(&output).expect("serialize scrub output");

    assert!(!serialized.contains(canary));
    for marker in [
        "[REDACTED:authorization]",
        "[REDACTED:cookie]",
        "[REDACTED:access_token]",
        "[REDACTED:refresh_token]",
        "[REDACTED:identity_token]",
        "[REDACTED:api_key]",
        "[REDACTED:client_secret]",
        "[REDACTED:password]",
        "[REDACTED:private_key]",
        "[REDACTED:credential_container]",
        "[REDACTED:environment_secret]",
        "[REDACTED:signed_url]",
        "[REDACTED:provider_credential]",
        "[REDACTED:opaque_credential]",
        "[REDACTED:url_userinfo]",
    ] {
        assert!(serialized.contains(marker), "missing {marker}");
    }
    let counts = &output.accounting.scrubbed_by_class;
    for class in [
        SupportSecretClassV1::Authorization,
        SupportSecretClassV1::Cookie,
        SupportSecretClassV1::AccessToken,
        SupportSecretClassV1::RefreshToken,
        SupportSecretClassV1::IdentityToken,
        SupportSecretClassV1::ApiKey,
        SupportSecretClassV1::ClientSecret,
        SupportSecretClassV1::Password,
        SupportSecretClassV1::PrivateKey,
        SupportSecretClassV1::CredentialContainer,
        SupportSecretClassV1::EnvironmentSecret,
        SupportSecretClassV1::SignedUrl,
        SupportSecretClassV1::ProviderCredential,
        SupportSecretClassV1::OpaqueCredential,
        SupportSecretClassV1::UrlUserinfo,
    ] {
        assert_eq!(counts.get(class), 1, "{class:?}");
    }
    // The credential container is replaced as one unit. Its nested password
    // never runs through a second classifier.
    assert_eq!(counts.password, 1);
}

#[test]
fn exact_key_matching_avoids_substring_false_positives() {
    let value = object(vec![
        ("access_token_count", SupportJsonValueV1::Integer(3)),
        ("api_key_count", SupportJsonValueV1::Integer(2)),
        ("credentialed", string("true")),
        ("monkey", string("ordinary")),
        ("passwordless", string("enabled")),
        ("provider", string("github")),
        ("token_count", SupportJsonValueV1::Integer(4)),
    ]);
    let output = SupportExportScrubber::default()
        .scrub_value(value.clone(), SupportEvidenceSourceV1::SessionLedger)
        .expect("scrub false-positive fixture");
    assert_eq!(output.value, value);
    assert_eq!(output.accounting.scrubbed_by_class, Default::default());
}

#[test]
fn normalized_secret_keys_are_classified_at_nested_unknown_object_depths() {
    let canary = "nested-normalization-canary";
    let value = object(vec![(
        "payload",
        object(vec![
            ("Auth Header", string(canary)),
            ("COOKIE_HEADER", string(canary)),
            ("bearer-token", string(canary)),
            ("Refresh Token", string(canary)),
            ("ID-TOKEN", string(canary)),
            ("api.key", string(canary)),
            ("Client Secret", string(canary)),
            ("PASSWORD", string(canary)),
            ("Private Key", string(canary)),
            ("key-chain", object(vec![("value", string(canary))])),
            ("env_vars", object(vec![("SAFE", string(canary))])),
            ("github_token", string(canary)),
            ("presigned-url", string(canary)),
            ("credential", string(canary)),
            ("url.userinfo", string(canary)),
        ]),
    )]);
    let output = SupportExportScrubber::default()
        .scrub_value(value, SupportEvidenceSourceV1::SessionLedger)
        .expect("nested structural scrub");
    let serialized = serde_json::to_string(&output).expect("serialize nested output");
    assert!(!serialized.contains(canary));
    assert_eq!(output.accounting.scrubbed_by_class.authorization, 1);
    assert_eq!(output.accounting.scrubbed_by_class.cookie, 1);
    assert_eq!(output.accounting.scrubbed_by_class.access_token, 1);
    assert_eq!(output.accounting.scrubbed_by_class.refresh_token, 1);
    assert_eq!(output.accounting.scrubbed_by_class.identity_token, 1);
    assert_eq!(output.accounting.scrubbed_by_class.api_key, 1);
    assert_eq!(output.accounting.scrubbed_by_class.client_secret, 1);
    assert_eq!(output.accounting.scrubbed_by_class.password, 1);
    assert_eq!(output.accounting.scrubbed_by_class.private_key, 1);
    assert_eq!(output.accounting.scrubbed_by_class.credential_container, 1);
    assert_eq!(output.accounting.scrubbed_by_class.environment_secret, 1);
    assert_eq!(output.accounting.scrubbed_by_class.signed_url, 1);
    assert_eq!(output.accounting.scrubbed_by_class.provider_credential, 1);
    assert_eq!(output.accounting.scrubbed_by_class.opaque_credential, 1);
    assert_eq!(output.accounting.scrubbed_by_class.url_userinfo, 1);
}

#[test]
fn secret_field_classification_wins_before_semantic_hash_or_id_exemptions() {
    let canary = "0123456789abcdef0123456789abcdef0123456789abcdef";
    let value = object(vec![
        ("api-key", string(canary)),
        ("credential", string("123e4567-e89b-12d3-a456-426614174000")),
        ("environment", object(vec![("commit", string(canary))])),
        ("sha256", string(canary)),
        ("operationId", string("operation-safe-1")),
    ]);
    let output = SupportExportScrubber::default()
        .scrub_value(value, SupportEvidenceSourceV1::SessionLedger)
        .expect("scrub precedence fixture");
    let serialized = serde_json::to_string(&output.value).expect("serialize");
    assert!(serialized.contains("\"sha256\":\"0123456789abcdef"));
    assert!(serialized.contains("operation-safe-1"));
    assert!(!serialized.contains("123e4567-e89b-12d3-a456-426614174000"));
    assert_eq!(output.accounting.scrubbed_by_class.api_key, 1);
    assert_eq!(output.accounting.scrubbed_by_class.opaque_credential, 1);
    assert_eq!(output.accounting.scrubbed_by_class.environment_secret, 1);
}

#[test]
fn exact_secret_derived_length_prefix_suffix_and_hash_fields_never_survive() {
    let canary = "secret-derived-canary";
    let value = object(vec![
        ("access_token_length", SupportJsonValueV1::Integer(37)),
        ("refresh_token_prefix", string(canary)),
        ("api_key_suffix", string(canary)),
        ("client_secret_hash", string(canary)),
        ("passwordless", string("enabled")),
        ("token_count", SupportJsonValueV1::Integer(37)),
    ]);
    let output = SupportExportScrubber::default()
        .scrub_value(value, SupportEvidenceSourceV1::SessionLedger)
        .expect("scrub secret-derived metadata");
    let serialized = serde_json::to_string(&output.value).expect("serialize output");
    assert!(!serialized.contains(canary));
    assert!(serialized.contains("\"access_token_length\":\"[REDACTED:access_token]\""));
    assert!(serialized.contains("\"passwordless\":\"enabled\""));
    assert!(serialized.contains("\"token_count\":37"));
    assert_eq!(output.accounting.scrubbed_by_class.access_token, 1);
    assert_eq!(output.accounting.scrubbed_by_class.refresh_token, 1);
    assert_eq!(output.accounting.scrubbed_by_class.api_key, 1);
    assert_eq!(output.accounting.scrubbed_by_class.client_secret, 1);
}

#[test]
fn accounting_serializes_all_fixed_counters_in_enum_order() {
    let serialized = serde_json::to_string(
        &SupportExportScrubber::default()
            .scrub_value(SupportJsonValueV1::Null, SupportEvidenceSourceV1::Package)
            .expect("empty accounting")
            .accounting,
    )
    .expect("serialize accounting");
    let mut prior = 0;
    for field in [
        "authorization",
        "cookie",
        "access_token",
        "refresh_token",
        "identity_token",
        "api_key",
        "client_secret",
        "password",
        "private_key",
        "credential_container",
        "environment_secret",
        "signed_url",
        "provider_credential",
        "opaque_credential",
        "url_userinfo",
    ] {
        let position = serialized.find(field).expect("fixed counter present");
        assert!(position >= prior, "counter order for {field}");
        prior = position;
    }
}
