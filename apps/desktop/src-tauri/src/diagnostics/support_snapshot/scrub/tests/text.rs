use crate::diagnostics::support_snapshot::schema::enums::{
    SupportEvidenceSourceV1, SupportSecretClassV1,
};
use crate::diagnostics::support_snapshot::scrub::{SupportExportScrubber, SupportTextKind};

fn scrub(
    input: &str,
) -> crate::diagnostics::support_snapshot::scrub::SupportOptionalScrubbed<String> {
    SupportExportScrubber::default()
        .scrub_text(
            input.to_owned(),
            SupportEvidenceSourceV1::SessionLedger,
            SupportTextKind::Content,
        )
        .expect("scrub text")
}

#[test]
fn free_form_rules_cover_headers_labels_blocks_urls_and_opaque_credentials() {
    let cases = [
        (
            "Authorization: Bearer authorization-canary-91",
            "authorization-canary-91",
            SupportSecretClassV1::Authorization,
        ),
        (
            "proxy-authorization=Basic YmFzaWMtY2FuYXJ5LTkx",
            "YmFzaWMtY2FuYXJ5LTkx",
            SupportSecretClassV1::Authorization,
        ),
        (
            "Set-Cookie: session=cookie-canary-91; Secure",
            "cookie-canary-91",
            SupportSecretClassV1::Cookie,
        ),
        (
            "access_token=access-canary-91",
            "access-canary-91",
            SupportSecretClassV1::AccessToken,
        ),
        (
            "refresh-token=refresh-canary-91",
            "refresh-canary-91",
            SupportSecretClassV1::RefreshToken,
        ),
        (
            "id_token=identity-canary-91",
            "identity-canary-91",
            SupportSecretClassV1::IdentityToken,
        ),
        (
            "x-api-key=api-canary-91",
            "api-canary-91",
            SupportSecretClassV1::ApiKey,
        ),
        (
            "client_secret=client-canary-91",
            "client-canary-91",
            SupportSecretClassV1::ClientSecret,
        ),
        (
            "passphrase=password-canary-91",
            "password-canary-91",
            SupportSecretClassV1::Password,
        ),
        (
            "-----BEGIN PRIVATE KEY-----\nprivate-canary-91\n-----END PRIVATE KEY-----",
            "private-canary-91",
            SupportSecretClassV1::PrivateKey,
        ),
        (
            "SERVICE_API_TOKEN=environment-canary-91",
            "environment-canary-91",
            SupportSecretClassV1::EnvironmentSecret,
        ),
        (
            "service_client_secret=lowercase-environment-canary-91",
            "lowercase-environment-canary-91",
            SupportSecretClassV1::EnvironmentSecret,
        ),
        (
            "https://example.test/object?x-amz-signature=signed-canary-91&tab=files",
            "signed-canary-91",
            SupportSecretClassV1::SignedUrl,
        ),
        (
            "ghp_abcdefghijklmnopqrstuvwxyz123456",
            "ghp_abcdefghijklmnopqrstuvwxyz123456",
            SupportSecretClassV1::ProviderCredential,
        ),
        (
            "-Aa0_Bb1_Cc2_Dd3_Ee4_Ff5_Gg6_Hh7_Ii8_Jj9_Kk0_Ll1-",
            "-Aa0_Bb1_Cc2_Dd3_Ee4_Ff5_Gg6_Hh7_Ii8_Jj9_Kk0_Ll1-",
            SupportSecretClassV1::OpaqueCredential,
        ),
        (
            "https://userinfo-canary-91:password@example.test/path?tab=files",
            "userinfo-canary-91",
            SupportSecretClassV1::UrlUserinfo,
        ),
    ];

    for (input, canary, class) in cases {
        let output = scrub(input);
        let retained = output.value.expect("retained scrubbed text");
        assert!(!retained.contains(canary), "missed {class:?}");
        if class == SupportSecretClassV1::OpaqueCredential {
            assert_eq!(retained, "[REDACTED:opaque_credential]");
        }
        assert_eq!(output.accounting.scrubbed_by_class.get(class), 1);
        let all_output = format!(
            "{retained} {:?} {}",
            output.accounting,
            serde_json::to_string(&output.accounting).expect("serialize accounting")
        );
        assert!(!all_output.contains(canary), "accounting leaked {class:?}");
    }
}

#[test]
fn home_userinfo_and_signed_query_scrubbing_preserve_ordinary_detail() {
    let scrubber =
        SupportExportScrubber::new(Some("/Users/alice/".to_owned())).expect("configured scrubber");
    let input = "path=/Users/alice/work/project and /Users/alice-project stays; \
        url=https://user:password@example.test/a/path?tab=files&page=2&signature=secret-value";
    let output = scrubber
        .scrub_text(
            input.to_owned(),
            SupportEvidenceSourceV1::Renderer,
            SupportTextKind::Content,
        )
        .expect("scrub path and URL")
        .value
        .expect("retained text");
    assert!(output.contains("~/work/project"));
    assert!(output.contains("/Users/alice-project"));
    assert!(output.contains("https://example.test/a/path?tab=files&page=2"));
    assert!(output.contains("signature=[REDACTED:signed_url]"));
    assert!(!output.contains("user:password"));
    assert!(!output.contains("secret-value"));

    let output = scrub("https://example.test/path?access_token=query-canary&tab=files&page=2");
    let retained = output.value.expect("retained signed URL");
    assert!(retained.contains("access_token=[REDACTED:signed_url]&tab=files&page=2"));
    assert!(!retained.contains("query-canary"));
    assert_eq!(output.accounting.scrubbed_by_class.signed_url, 1);
    assert_eq!(output.accounting.scrubbed_by_class.access_token, 0);
}

#[test]
fn exact_labels_and_high_confidence_rules_avoid_ordinary_false_positives() {
    let ordinary = "passwordless=true credentialed=true api_key_count=2 token_count=128 \
        MONKEY=value provider=github openai-compatible \
        https://example.test/path?cookie=chocolate&tab=files \
        thisisaverylonglowercasewordthatcontainsnosecretandmustremainreadable \
        ordinary prose remains useful to support";
    let output = scrub(ordinary);
    assert_eq!(output.value.as_deref(), Some(ordinary));
    assert_eq!(output.accounting.scrubbed_by_class, Default::default());
}

#[test]
fn every_known_provider_prefix_is_removed_without_copying_a_fragment() {
    for secret in [
        "ghp_abcdefghijklmnopqrstuvwxyz123456",
        "github_pat_abcdefghijklmnopqrstuvwxyz_123456",
        "eyJabcdefgh.ijklmnop.qrstuvwxyz",
        "sk-abcdefghijklmnopqrstuvwxyz",
        // Assembled with `concat!` so no literal Slack-shaped token sits in the
        // source; a literal one trips GitHub push protection on every push.
        concat!("xox", "b-1234567890-abcdefghijklmnopqrstuvwxyz"),
        // Stripe separates its live and test prefixes with `_`, so the
        // hyphenated OpenAI shape above never reached them. Assembled with
        // `concat!` for the same push-protection reason as the line above.
        concat!("sk", "_live_", "abcdefghijklmnopqrstuvwxyz012345"),
        concat!("sk", "_test_", "abcdefghijklmnopqrstuvwxyz012345"),
        concat!("rk", "_live_", "abcdefghijklmnopqrstuvwxyz012345"),
        "AKIAABCDEFGHIJKLMNOP",
        "ASIAABCDEFGHIJKLMNOP",
    ] {
        let output = scrub(&format!("before {secret} after"));
        let visible = format!(
            "{:?} {}",
            output,
            serde_json::to_string(&output.accounting).expect("serialize accounting")
        );
        assert!(!visible.contains(secret));
        assert!(output
            .value
            .as_deref()
            .expect("retained text")
            .contains("before [REDACTED:provider_credential] after"));
        assert_eq!(output.accounting.scrubbed_by_class.provider_credential, 1);
    }
}

#[test]
fn generic_and_content_cutoffs_prescan_crossing_secrets_with_bounded_output() {
    for (kind, limit) in [
        (SupportTextKind::Generic, 4_096_usize),
        (SupportTextKind::Content, 16_384_usize),
    ] {
        let label = " Authorization: Bearer ";
        let canary = "boundary-canary-47";
        let input = format!(
            "{}{}{}{}",
            "x".repeat(limit.saturating_sub(label.len() + 4)),
            label,
            canary,
            "Z".repeat(2_000_000)
        );
        let output = SupportExportScrubber::default()
            .scrub_text(input, SupportEvidenceSourceV1::Package, kind)
            .expect("bounded prescan");
        // Borrowed, not moved: the canary assertion below renders the whole output.
        let retained = output.value.as_ref().expect("retained bounded text");
        assert!(retained.len() <= limit);
        assert!(!retained.contains(canary));
        assert!(!format!("{output:?}").contains(canary));
        assert_eq!(output.accounting.scrubbed_by_class.authorization, 1);
        assert_eq!(output.accounting.truncations.len(), 1);
        assert_eq!(output.accounting.truncations[0].count, 1);
        assert_eq!(output.accounting.truncations[0].omitted_bytes, None);
    }
}

#[test]
fn generic_and_content_prescan_cutoffs_remove_open_credentials_and_userinfo() {
    for (kind, limit) in [
        (SupportTextKind::Generic, 4_096_usize),
        (SupportTextKind::Content, 16_384_usize),
    ] {
        let token = format!("ghp_{}", "A".repeat(8_300));
        // The padding is separated from the token, as in the sibling test above:
        // the provider-credential pattern is anchored on a leading `\b`, so a
        // prefix glued straight onto word-character padding (`xxxxghp_...`) is
        // deliberately not a credential and would make the assertion vacuous.
        let token_input = format!("{} {token} tail", "x".repeat(limit - 20));
        let output = SupportExportScrubber::default()
            .scrub_text(token_input, SupportEvidenceSourceV1::Package, kind)
            .expect("provider token crossing prescan");
        let visible = format!("{output:?}");
        assert!(!visible.contains("ghp_"));
        assert_eq!(output.accounting.scrubbed_by_class.provider_credential, 1);

        let userinfo = format!(
            "{}https://{}@example.test/path",
            "x".repeat(limit - 64),
            "userinfo-prescan-canary".repeat(500)
        );
        let output = SupportExportScrubber::default()
            .scrub_text(userinfo, SupportEvidenceSourceV1::Package, kind)
            .expect("URL userinfo crossing prescan");
        let retained = output.value.expect("retained scrubbed text");
        assert!(!retained.contains("userinfo-prescan-canary"));
        assert!(retained.contains("[REDACTED:url_userinfo]"));
        assert_eq!(output.accounting.scrubbed_by_class.url_userinfo, 1);
    }
}
