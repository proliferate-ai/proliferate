//! Debug-redaction proofs for the secret-bearing profile types (split out of
//! `profile_tests.rs` for the line-count ceiling; `#[path]`-included so
//! `super::*` still reaches the module under test).
//!
//! The profile types carry live credentials, so their `Debug` impls are
//! hand-written to redact by construction (repo law: never print a secret;
//! length-only telemetry). Each test plants a distinctive canary secret and
//! proves `{:?}` cannot reproduce it while non-secret fields stay readable.
//! The composed-profile proof lives with the resolution tests
//! (`profile_tests.rs::composed_profile_debug_redacts_every_source_kind`).

use super::*;

/// A canary no real fixture shares; 17 bytes, so the length-only marker is
/// pinned exactly.
const CANARY: &str = "sk-canary-fixture";

#[test]
fn api_key_profile_debug_redacts_the_value() {
    let debug = format!(
        "{:?}",
        ApiKeyProfile {
            env_var_name: "ANTHROPIC_API_KEY".into(),
            value: CANARY.into(),
        }
    );
    assert!(!debug.contains(CANARY), "Debug output leaked the api key");
    assert!(debug.contains("<redacted 17 bytes>"), "got {debug}");
    assert!(debug.contains("ANTHROPIC_API_KEY"), "got {debug}");
}

#[test]
fn gateway_profile_debug_redacts_the_key() {
    let debug = format!(
        "{:?}",
        GatewayProfile {
            base_url: "https://gw.example".into(),
            key: CANARY.into(),
        }
    );
    assert!(
        !debug.contains(CANARY),
        "Debug output leaked the virtual key"
    );
    assert!(debug.contains("<redacted 17 bytes>"), "got {debug}");
    assert!(debug.contains("https://gw.example"), "got {debug}");
}

#[test]
fn provider_config_profile_debug_redacts_env_values_but_names_keys() {
    let debug = format!(
        "{:?}",
        ProviderConfigProfile {
            config_kind: "aws_bedrock".into(),
            env: [("AWS_BEARER_TOKEN_BEDROCK".to_string(), CANARY.to_string())]
                .into_iter()
                .collect(),
        }
    );
    assert!(
        !debug.contains(CANARY),
        "Debug output leaked the provider credential"
    );
    assert!(debug.contains("<redacted 17 bytes>"), "got {debug}");
    // Key NAMES are not secrets and stay readable for debugging.
    assert!(debug.contains("AWS_BEARER_TOKEN_BEDROCK"), "got {debug}");
    assert!(debug.contains("aws_bedrock"), "got {debug}");
}

#[test]
fn seat_profile_debug_redacts_env_values_but_names_keys() {
    let debug = format!(
        "{:?}",
        SeatProfile {
            seat_id: "seat-uuid-1".into(),
            env: [("CLAUDE_CODE_OAUTH_TOKEN".to_string(), CANARY.to_string())]
                .into_iter()
                .collect(),
        }
    );
    assert!(
        !debug.contains(CANARY),
        "Debug output leaked the seat token"
    );
    assert!(debug.contains("<redacted 17 bytes>"), "got {debug}");
    assert!(debug.contains("CLAUDE_CODE_OAUTH_TOKEN"), "got {debug}");
    assert!(debug.contains("seat-uuid-1"), "got {debug}");
}
