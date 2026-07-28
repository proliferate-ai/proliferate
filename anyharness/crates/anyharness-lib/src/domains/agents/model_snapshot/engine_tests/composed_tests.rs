//! Proof B2 and B3: the composed observation's document shape.
//!
//! - **B2** Any probe writes one schemaVersion-2 document — a single observation,
//!   no `entries` map, no fingerprint — with `stateRevision` equal to the state
//!   file's and `installIdentity` equal to the manifest's.
//! - **B3** A multi-source harness is observed composed: opencode with a gateway
//!   PLUS an api_key source yields ONE observation whose model list carries every
//!   provider's models with verbatim `provider` fields.

use super::*;

/// **Proof B2.** The persisted document is the v2 wire shape: single observation,
/// provenance fields recorded from the same state/manifest read the probe used,
/// and none of the per-context vocabulary anywhere in the serialized bytes.
#[tokio::test]
async fn a_probe_writes_one_schema_version_2_document_with_provenance() {
    let home = TempRuntimeHome::new("b2-document");
    home.write_state_json(&gateway_state(41, &[("opencode", "sk-vk")]));
    home.write_manifest("opencode", Some("1.18.3"), Some("sha-abc"), "pinned_archive");
    let (service, _runner, _plan) = engine(&home, "opencode", test_config());

    let document = service.refresh_now("opencode").await.expect("probe");

    assert_eq!(document.schema_version, 2);
    assert_eq!(document.agent, "opencode");
    assert_eq!(
        document.state_revision, 41,
        "stateRevision must equal the state file's revision"
    );
    let identity = document
        .install_identity
        .as_ref()
        .expect("installIdentity recorded");
    assert_eq!(identity.version.as_deref(), Some("1.18.3"));
    assert_eq!(identity.sha256.as_deref(), Some("sha-abc"));
    assert_eq!(identity.role, "agent_process");

    // The wire bytes: no entries map, no fingerprint, no context key, no
    // mechanism field. Asserted on the serialized file rather than the type,
    // because the leak this guards against would be a serde-attribute change.
    let raw = std::fs::read_to_string(super::super::document::snapshot_path(
        home.path(),
        "opencode",
    ))
    .expect("document on disk");
    for banned in [
        "entries",
        "authFingerprint",
        "auth_fingerprint",
        "authContextId",
        "auth_context_id",
        "mechanism",
    ] {
        assert!(
            !raw.contains(banned),
            "the v2 document must not carry '{banned}': {raw}"
        );
    }
    assert!(raw.contains("\"schemaVersion\": 2"));
    // And it round-trips through the reader.
    let read_back = read_document(home.path(), "opencode").expect("readable");
    assert_eq!(read_back, document);
}

/// **Proof B3.** Opencode with the gateway PLUS an api_key source is spawned with
/// all of them and observed as ONE union menu, each model carrying the harness's
/// own `provider` namespace verbatim — no per-context split, no inferred origin.
#[tokio::test]
async fn a_multi_source_harness_yields_one_composed_observation_with_verbatim_providers() {
    let home = TempRuntimeHome::new("b3-composed");
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "revision": 8,
        "harnesses": [{
            "harness_kind": "opencode",
            "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "sk-vk" },
                { "kind": "api_key", "env_var_name": "ANTHROPIC_API_KEY", "value": "sk-ant" },
            ],
        }],
    }));
    home.write_manifest("opencode", Some("1.0.0"), Some("sha-1"), "pinned_archive");
    let (service, runner, _plan) = engine(&home, "opencode", test_config());
    // What a composed opencode session genuinely advertises: one list spanning
    // the gateway's namespace, the raw-key provider's, and the native login's.
    *runner.models.lock().expect("models") = vec![
        "proliferate/claude-fable-5".to_string(),
        "anthropic/claude-fable-5".to_string(),
        "openai/gpt-5.5".to_string(),
    ];

    let document = service.refresh_now("opencode").await.expect("probe");

    let providers: Vec<Option<&str>> = document
        .models
        .iter()
        .map(|model| model.provider.as_deref())
        .collect();
    assert_eq!(
        providers,
        vec![Some("proliferate"), Some("anthropic"), Some("openai")],
        "each model's provider namespace is carried verbatim"
    );
    // One observation covering every source: the document IS the union menu.
    let ids: Vec<&str> = document.models.iter().map(|model| model.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "proliferate/claude-fable-5",
            "anthropic/claude-fable-5",
            "openai/gpt-5.5"
        ]
    );
    // And there is exactly one document for the harness — nothing keyed further.
    assert_eq!(read_document(home.path(), "opencode").expect("document"), document);
}
