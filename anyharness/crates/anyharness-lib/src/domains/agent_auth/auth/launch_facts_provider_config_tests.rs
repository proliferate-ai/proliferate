//! Track D: `provider_config` credential-fact classification (review B2).
//!
//! The arm classifies each key of an already-resolved `env` map against the
//! registry's declared flag vocabulary: a `flag`-kind var becomes an `EnvFlag`
//! fact carrying its real value (the classifier's `envFlag` signal requires an
//! exact var+value match), everything else becomes a presence-only `Env` fact.
//!
//! Lives in its own file because `launch_facts.rs` sits at its max-lines
//! allowlist ceiling; wired in via `#[path]` like the route-transition tests.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyharness_credential_discovery::CredentialFact;

use super::{collect_launch_env_facts, registry_flag_vars};

fn temp_home() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "anyharness-provider-config-facts-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(path.join("agent-auth")).expect("create agent-auth dir");
    path
}

fn write_state(home: &Path, json: &str) {
    std::fs::write(home.join("agent-auth").join("state.json"), json).expect("write state");
}

/// THE B2 regression. `CLAUDE_CODE_USE_FOUNDRY` is declared `kind: flag` ONLY
/// under claude's `providerConfig[]` block — `auth.slots[].envVars` never repeats
/// it. A slots-only read of the flag vocabulary therefore classified it as a
/// secret and emitted a valueless `Env` fact, which the classifier's exact
/// var+value `envFlag` match can never satisfy: a claude×Foundry launch would
/// classify into the wrong auth context and resolve its model list off the wrong
/// `session.defaults` entry the moment a Foundry `authContext` lands.
#[test]
fn claude_provider_config_foundry_flag_classifies_as_an_env_flag_with_its_value() {
    let home = temp_home();
    write_state(
        &home,
        r#"{"version":2,"sequence":1,"harnesses":[
            {"harness_kind":"claude","sources":[
                {"kind":"provider_config","config_kind":"azure_openai","env":{
                    "CLAUDE_CODE_USE_FOUNDRY":"1",
                    "ANTHROPIC_FOUNDRY_RESOURCE":"my-resource",
                    "ANTHROPIC_FOUNDRY_API_KEY":"foundry-raw"}}]}]}"#,
    );

    let facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);

    assert!(
        facts.contains(&CredentialFact::EnvFlag {
            var: "CLAUDE_CODE_USE_FOUNDRY".to_string(),
            value: "1".to_string(),
        }),
        "the Foundry mode switch must carry its value as an EnvFlag; got: {facts:?}"
    );
    // The credential is a secret: presence only, and never as an EnvFlag (which
    // would put the raw value in a fact).
    assert!(
        facts.contains(&CredentialFact::Env {
            var: "ANTHROPIC_FOUNDRY_API_KEY".to_string(),
        }),
        "a provider_config secret must produce a presence-only Env fact; got: {facts:?}"
    );
    for fact in &facts {
        if let CredentialFact::EnvFlag { var, .. } = fact {
            assert_ne!(
                var, "ANTHROPIC_FOUNDRY_API_KEY",
                "a secret var must never produce an EnvFlag fact"
            );
            assert_ne!(var, "ANTHROPIC_FOUNDRY_RESOURCE");
        }
    }
    // No gateway source → no Route fact (the invariant the api_key arm shares).
    assert!(
        !facts
            .iter()
            .any(|fact| matches!(fact, CredentialFact::Route { .. })),
        "a provider_config-only selection must not emit a Route fact; got: {facts:?}"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// The Bedrock half of the same arm, whose flag IS declared on the anthropic
/// slot — so this passes both before and after the B2 fix and pins that reading
/// `providerConfig[]` did not regress the slot-declared path.
#[test]
fn claude_provider_config_bedrock_flag_classifies_as_an_env_flag_with_its_value() {
    let home = temp_home();
    write_state(
        &home,
        r#"{"version":2,"sequence":1,"harnesses":[
            {"harness_kind":"claude","sources":[
                {"kind":"provider_config","config_kind":"aws_bedrock","env":{
                    "CLAUDE_CODE_USE_BEDROCK":"1",
                    "AWS_BEARER_TOKEN_BEDROCK":"bedrock-raw",
                    "AWS_REGION":"us-east-1"}}]}]}"#,
    );

    let facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);

    assert!(
        facts.contains(&CredentialFact::EnvFlag {
            var: "CLAUDE_CODE_USE_BEDROCK".to_string(),
            value: "1".to_string(),
        }),
        "the Bedrock mode switch must carry its value as an EnvFlag; got: {facts:?}"
    );
    assert!(facts.contains(&CredentialFact::Env {
        var: "AWS_BEARER_TOKEN_BEDROCK".to_string(),
    }));
    assert!(facts.contains(&CredentialFact::Env {
        var: "AWS_REGION".to_string(),
    }));

    let _ = std::fs::remove_dir_all(&home);
}

/// The vocabulary itself, read straight off the bundled registry: both halves of
/// the document contribute, and non-flag entries never do. This is the assertion
/// that fails on a slots-only `registry_flag_vars`.
#[test]
fn registry_flag_vars_unions_slot_and_provider_config_declarations() {
    let claude_flags = registry_flag_vars("claude");

    // Declared on `auth.slots[].envVars`.
    assert!(
        claude_flags.contains("CLAUDE_CODE_USE_BEDROCK"),
        "slot-declared flag missing; got: {claude_flags:?}"
    );
    // Declared ONLY on `providerConfig[].envVars`.
    assert!(
        claude_flags.contains("CLAUDE_CODE_USE_FOUNDRY"),
        "providerConfig-declared flag missing; got: {claude_flags:?}"
    );
    // Secrets from either half stay out of the flag vocabulary.
    assert!(!claude_flags.contains("ANTHROPIC_API_KEY"));
    assert!(!claude_flags.contains("ANTHROPIC_FOUNDRY_API_KEY"));
    assert!(!claude_flags.contains("AWS_BEARER_TOKEN_BEDROCK"));

    // A harness whose registry entry declares no flags at all yields an empty
    // set rather than inheriting another harness's vocabulary.
    assert!(registry_flag_vars("grok").is_empty());
    // An unknown harness kind is empty, not a panic.
    assert!(registry_flag_vars("not-a-harness").is_empty());
}
