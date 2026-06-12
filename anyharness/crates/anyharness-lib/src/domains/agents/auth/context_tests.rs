//! Classifier + projection tests: per-signature matching incl. precedence
//! (catalog order = harness precedence), slot union, baseline fallback, and
//! equivalence of the CredentialState projection with the legacy
//! env + LocalAuthState path on the common cases.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use anyharness_credential_discovery::{collect_facts, CredentialFact};

use super::context::{classify, project_credential_state, BASELINE_CONTEXT_ID};
use super::credentials::detect_auth_slots_with_env;
use crate::domains::agents::catalog::schema::{AgentCatalogAuthContext, AgentCatalogAuthSignal};
use crate::domains::agents::model::{
    AgentDescriptor, AgentKind, AuthMaterializationSpec, AuthReadinessPolicy, AuthSlotSpec,
    AuthSpec, CommandSpec, CredentialDiscoveryKind, CredentialState, LoginSpec,
};
use crate::domains::agents::registry::built_in_registry;

// An env var name no real environment sets: keeps the legacy detector's
// ambient `std::env::var` fallback inert during equivalence tests.
const TEST_API_KEY_VAR: &str = "ANYHARNESS_CONTEXT_TEST_API_KEY";

fn descriptor_with_auth(auth: AuthSpec) -> AgentDescriptor {
    let mut descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("claude descriptor");
    descriptor.auth = auth;
    descriptor
}

fn login_spec() -> LoginSpec {
    LoginSpec {
        label: "Log in".to_string(),
        command: CommandSpec {
            program: "claude".to_string(),
            args: vec!["login".to_string()],
        },
        reuses_user_state: true,
        message: None,
    }
}

fn single_slot_auth(login: Option<LoginSpec>) -> AuthSpec {
    AuthSpec::test_single_required_slot(
        vec![TEST_API_KEY_VAR.to_string()],
        login,
        CredentialDiscoveryKind::Claude,
    )
}

fn context(
    id: &str,
    slot_id: &str,
    signals: Option<AgentCatalogAuthSignal>,
) -> AgentCatalogAuthContext {
    AgentCatalogAuthContext {
        id: id.to_string(),
        auth_slot_id: Some(slot_id.to_string()),
        description: None,
        signals,
    }
}

fn env(var: &str) -> AgentCatalogAuthSignal {
    AgentCatalogAuthSignal::Env(var.to_string())
}

fn discovery(kind: &str) -> AgentCatalogAuthSignal {
    AgentCatalogAuthSignal::Discovery(kind.to_string())
}

fn env_fact(var: &str) -> CredentialFact {
    CredentialFact::Env {
        var: var.to_string(),
    }
}

fn flag_fact(var: &str, value: &str) -> CredentialFact {
    CredentialFact::EnvFlag {
        var: var.to_string(),
        value: value.to_string(),
    }
}

fn discovery_fact(kind: &str) -> CredentialFact {
    CredentialFact::Discovery {
        kind: kind.to_string(),
    }
}

fn claude_style_contexts() -> Vec<AgentCatalogAuthContext> {
    vec![
        context("anthropic-api", "default", Some(env(TEST_API_KEY_VAR))),
        context(
            "anthropic-oauth",
            "default",
            Some(AgentCatalogAuthSignal::AnyOf(vec![
                env("CLAUDE_CODE_OAUTH_TOKEN"),
                discovery("claude-oauth-creds"),
            ])),
        ),
    ]
}

fn make_temp_home() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "anyharness-auth-context-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&path).expect("create temp home");
    path
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

#[test]
fn api_key_masks_oauth_when_both_facts_present() {
    // Mirrors the probe env-leak finding: contexts ordered [api, oauth]
    // because the harness lets an inherited API key mask an OAuth token.
    let descriptor = descriptor_with_auth(single_slot_auth(Some(login_spec())));
    let facts = vec![
        env_fact(TEST_API_KEY_VAR),
        discovery_fact("claude-oauth-creds"),
    ];

    let active = classify(&descriptor, &claude_style_contexts(), &facts);

    assert_eq!(active.ids(), ["anthropic-api"]);
    assert!(active.is_active("anthropic-api"));
    assert!(!active.is_active("anthropic-oauth"));
    assert!(!active.is_baseline());
}

#[test]
fn oauth_wins_when_api_key_absent() {
    let descriptor = descriptor_with_auth(single_slot_auth(Some(login_spec())));
    let facts = vec![discovery_fact("claude-oauth-creds")];

    let active = classify(&descriptor, &claude_style_contexts(), &facts);

    assert_eq!(active.ids(), ["anthropic-oauth"]);
}

#[test]
fn bedrock_all_of_requires_flag_and_chain() {
    let descriptor = descriptor_with_auth(single_slot_auth(Some(login_spec())));
    let bedrock = context(
        "anthropic-bedrock",
        "default",
        Some(AgentCatalogAuthSignal::AllOf(vec![
            AgentCatalogAuthSignal::EnvFlag("CLAUDE_CODE_USE_BEDROCK=1".to_string()),
            discovery("aws-credential-chain"),
        ])),
    );
    let mut contexts = vec![bedrock];
    contexts.extend(claude_style_contexts());

    // Flag + chain + an API key fact: bedrock is first in catalog order.
    let active = classify(
        &descriptor,
        &contexts,
        &[
            flag_fact("CLAUDE_CODE_USE_BEDROCK", "1"),
            discovery_fact("aws-credential-chain"),
            env_fact(TEST_API_KEY_VAR),
        ],
    );
    assert_eq!(active.ids(), ["anthropic-bedrock"]);

    // Flag without the chain: allOf fails, api wins instead.
    let active = classify(
        &descriptor,
        &contexts,
        &[
            flag_fact("CLAUDE_CODE_USE_BEDROCK", "1"),
            env_fact(TEST_API_KEY_VAR),
        ],
    );
    assert_eq!(active.ids(), ["anthropic-api"]);

    // Flag value mismatch never matches the envFlag leaf.
    let active = classify(
        &descriptor,
        &contexts,
        &[
            flag_fact("CLAUDE_CODE_USE_BEDROCK", "0"),
            discovery_fact("aws-credential-chain"),
        ],
    );
    assert_eq!(active.ids(), [BASELINE_CONTEXT_ID]);
}

#[test]
fn env_signal_is_satisfied_by_flag_fact_presence() {
    let descriptor = descriptor_with_auth(single_slot_auth(None));
    let contexts = vec![context(
        "flag-presence",
        "default",
        Some(env("CLAUDE_CODE_USE_BEDROCK")),
    )];

    let active = classify(
        &descriptor,
        &contexts,
        &[flag_fact("CLAUDE_CODE_USE_BEDROCK", "1")],
    );

    assert_eq!(active.ids(), ["flag-presence"]);
}

#[test]
fn union_across_slots_for_multi_provider_descriptor() {
    // OpenCode-style: independent provider slots, one winner each.
    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::ProviderManaged,
        slots: vec![
            AuthSlotSpec {
                id: "anthropic".to_string(),
                label: "Anthropic".to_string(),
                credential_provider_ids: vec!["anthropic".to_string()],
                required_for_readiness: false,
                env_vars: vec!["ANTHROPIC_API_KEY".to_string()],
                login: None,
                discovery: CredentialDiscoveryKind::OpenCode,
                materialization: AuthMaterializationSpec::default(),
            },
            AuthSlotSpec {
                id: "openai".to_string(),
                label: "OpenAI".to_string(),
                credential_provider_ids: vec!["openai".to_string()],
                required_for_readiness: false,
                env_vars: vec!["OPENAI_API_KEY".to_string()],
                login: None,
                discovery: CredentialDiscoveryKind::OpenCode,
                materialization: AuthMaterializationSpec::default(),
            },
        ],
    };
    let descriptor = descriptor_with_auth(auth);
    let contexts = vec![
        context(
            "opencode-anthropic",
            "anthropic",
            Some(discovery("opencode-auth-json/anthropic")),
        ),
        context(
            "opencode-anthropic-env",
            "anthropic",
            Some(env("ANTHROPIC_API_KEY")),
        ),
        context("opencode-openai", "openai", Some(env("OPENAI_API_KEY"))),
    ];

    let active = classify(
        &descriptor,
        &contexts,
        &[
            discovery_fact("opencode-auth-json/anthropic"),
            env_fact("ANTHROPIC_API_KEY"),
            env_fact("OPENAI_API_KEY"),
        ],
    );

    // One winner per slot (first match), union across slots, catalog order.
    assert_eq!(active.ids(), ["opencode-anthropic", "opencode-openai"]);
}

#[test]
fn baseline_active_iff_nothing_matched() {
    let descriptor = descriptor_with_auth(single_slot_auth(Some(login_spec())));

    let active = classify(&descriptor, &claude_style_contexts(), &[]);

    assert_eq!(active.ids(), [BASELINE_CONTEXT_ID]);
    assert!(active.is_baseline());
    assert!(active.is_active(BASELINE_CONTEXT_ID));
}

#[test]
fn signal_less_context_never_matches() {
    let descriptor = descriptor_with_auth(single_slot_auth(None));
    let contexts = vec![context("anthropic-probe-only", "default", None)];

    let active = classify(
        &descriptor,
        &contexts,
        &[
            env_fact(TEST_API_KEY_VAR),
            discovery_fact("claude-oauth-creds"),
        ],
    );

    assert_eq!(active.ids(), [BASELINE_CONTEXT_ID]);
}

#[test]
fn context_for_unknown_slot_is_skipped() {
    let descriptor = descriptor_with_auth(single_slot_auth(None));
    let contexts = vec![context(
        "anthropic-vertex",
        "no-such-slot",
        Some(env(TEST_API_KEY_VAR)),
    )];

    let active = classify(&descriptor, &contexts, &[env_fact(TEST_API_KEY_VAR)]);

    assert_eq!(active.ids(), [BASELINE_CONTEXT_ID]);
}

#[test]
fn sync_summary_carries_context_ids_only() {
    let descriptor = descriptor_with_auth(single_slot_auth(None));
    let active = classify(
        &descriptor,
        &claude_style_contexts(),
        &[env_fact(TEST_API_KEY_VAR)],
    );

    let summary = active.sync_summary(descriptor.kind.as_str());

    assert_eq!(
        serde_json::to_value(&summary).expect("serialize summary"),
        serde_json::json!({
            "agentKind": "claude",
            "activeContextIds": ["anthropic-api"],
        })
    );
}

// ---------------------------------------------------------------------------
// CredentialState projection: equivalence with the legacy path
// ---------------------------------------------------------------------------

#[test]
fn projection_env_var_present_is_ready_like_legacy() {
    let home = make_temp_home();
    let auth = single_slot_auth(Some(login_spec()));
    let descriptor = descriptor_with_auth(auth.clone());

    let env_keys: BTreeSet<String> = [TEST_API_KEY_VAR.to_string()].into_iter().collect();
    let facts = collect_facts(&home, &env_keys, &BTreeMap::new());
    let active = classify(&descriptor, &claude_style_contexts(), &facts);
    let projected = project_credential_state(&auth, &active, &facts);

    let additional_env: BTreeMap<String, String> =
        [(TEST_API_KEY_VAR.to_string(), "sk-test".to_string())]
            .into_iter()
            .collect();
    let (_, slots) = detect_auth_slots_with_env(&auth, &home, &additional_env);

    assert_eq!(active.ids(), ["anthropic-api"]);
    assert_eq!(projected, CredentialState::Ready);
    assert_eq!(slots[0].credential_state, projected);

    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn projection_local_oauth_file_is_ready_via_local_auth_like_legacy() {
    let home = make_temp_home();
    std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    std::fs::write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"token"}}"#,
    )
    .expect("write oauth creds");

    let auth = single_slot_auth(Some(login_spec()));
    let descriptor = descriptor_with_auth(auth.clone());

    let facts = collect_facts(&home, &BTreeSet::new(), &BTreeMap::new());
    let active = classify(&descriptor, &claude_style_contexts(), &facts);
    let projected = project_credential_state(&auth, &active, &facts);

    let (_, slots) = detect_auth_slots_with_env(&auth, &home, &BTreeMap::new());

    assert_eq!(active.ids(), ["anthropic-oauth"]);
    assert_eq!(projected, CredentialState::ReadyViaLocalAuth);
    assert_eq!(slots[0].credential_state, projected);

    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn projection_nothing_with_login_is_login_required_like_legacy() {
    let home = make_temp_home();
    let auth = single_slot_auth(Some(login_spec()));
    let descriptor = descriptor_with_auth(auth.clone());

    let facts = collect_facts(&home, &BTreeSet::new(), &BTreeMap::new());
    let active = classify(&descriptor, &claude_style_contexts(), &facts);
    let projected = project_credential_state(&auth, &active, &facts);

    let (_, slots) = detect_auth_slots_with_env(&auth, &home, &BTreeMap::new());

    assert!(active.is_baseline());
    assert_eq!(projected, CredentialState::LoginRequired);
    assert_eq!(slots[0].credential_state, projected);

    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn projection_nothing_without_login_is_missing_env_like_legacy() {
    let home = make_temp_home();
    let auth = single_slot_auth(None);
    let descriptor = descriptor_with_auth(auth.clone());

    let facts = collect_facts(&home, &BTreeSet::new(), &BTreeMap::new());
    let active = classify(&descriptor, &claude_style_contexts(), &facts);
    let projected = project_credential_state(&auth, &active, &facts);

    let (_, slots) = detect_auth_slots_with_env(&auth, &home, &BTreeMap::new());

    assert_eq!(projected, CredentialState::MissingEnv);
    assert_eq!(slots[0].credential_state, projected);

    let _ = std::fs::remove_dir_all(home);
}

// --- Shipped-documents detection net -----------------------------------
//
// The scenarios above use synthetic contexts; these run the classifier
// against the REAL bundled catalog + the REAL registry descriptors. They are
// the tripwire for the failure mode where the shipped documents drift from
// the classifier's expectations (missing signals, unknown slot ids) and
// every agent silently classifies to baseline — menus would lie wholesale.

fn bundled_contexts(kind: &str) -> Vec<AgentCatalogAuthContext> {
    crate::domains::agents::catalog::bundled::bundled_agent_catalog_document()
        .agents
        .iter()
        .find(|agent| agent.kind == kind)
        .unwrap_or_else(|| panic!("bundled catalog must carry agent '{kind}'"))
        .auth_contexts
        .clone()
}

fn bundled_descriptor(kind: &str) -> AgentDescriptor {
    crate::domains::agents::registry::descriptor(kind)
        .unwrap_or_else(|| panic!("registry must carry agent '{kind}'"))
}

fn classify_bundled(kind: &str, facts: &[CredentialFact]) -> Vec<String> {
    classify(&bundled_descriptor(kind), &bundled_contexts(kind), facts)
        .ids()
        .to_vec()
}

#[test]
fn bundled_docs_every_signaled_context_is_classifiable() {
    // Every context with signals must reference a slot its descriptor
    // declares — otherwise the classifier skips it and the context can
    // never activate no matter what facts exist.
    let catalog = crate::domains::agents::catalog::bundled::bundled_agent_catalog_document();
    for agent in &catalog.agents {
        let descriptor = bundled_descriptor(&agent.kind);
        for context in &agent.auth_contexts {
            if context.id == BASELINE_CONTEXT_ID || context.signals.is_none() {
                continue;
            }
            let slot_id = context
                .auth_slot_id
                .as_deref()
                .unwrap_or_else(|| panic!("{}/{} has no slot", agent.kind, context.id));
            assert!(
                descriptor.auth.slot(slot_id).is_some(),
                "{}/{} references slot '{slot_id}' unknown to the descriptor — \
                 the classifier would silently skip it",
                agent.kind,
                context.id
            );
        }
    }
}

#[test]
fn bundled_docs_classify_api_key_contexts() {
    assert_eq!(
        classify_bundled("claude", &[env_fact("ANTHROPIC_API_KEY")]),
        vec!["anthropic-api"]
    );
    assert_eq!(
        classify_bundled("codex", &[env_fact("OPENAI_API_KEY")]),
        vec!["openai-api"]
    );
    assert_eq!(
        classify_bundled("gemini", &[env_fact("GEMINI_API_KEY")]),
        vec!["gemini-api"]
    );
}

#[test]
fn bundled_docs_classify_oauth_discovery_contexts() {
    assert_eq!(
        classify_bundled("claude", &[discovery_fact("claude-oauth-creds")]),
        vec!["anthropic-oauth"]
    );
    assert_eq!(
        classify_bundled("codex", &[discovery_fact("codex-auth-json-oauth")]),
        vec!["openai-oauth"]
    );
    assert_eq!(
        classify_bundled("gemini", &[discovery_fact("gemini-oauth-creds")]),
        vec!["google-oauth"]
    );
    assert_eq!(
        classify_bundled("cursor", &[discovery_fact("cursor-keychain")]),
        vec!["cursor-login"]
    );
}

#[test]
fn bundled_docs_bedrock_flag_beats_api_key_for_claude() {
    // The flag deliberately forces the bedrock route in the harness, so when
    // set (with aws creds present) it must win the slot even if an API key
    // is also in the composed env.
    let facts = [
        flag_fact("CLAUDE_CODE_USE_BEDROCK", "1"),
        discovery_fact("aws-credential-chain"),
        env_fact("ANTHROPIC_API_KEY"),
    ];
    assert_eq!(classify_bundled("claude", &facts), vec!["bedrock"]);

    // Flag without aws credentials is not a bedrock context.
    let flag_only = [flag_fact("CLAUDE_CODE_USE_BEDROCK", "1")];
    assert_eq!(classify_bundled("claude", &flag_only), vec!["baseline"]);
}

#[test]
fn bundled_docs_codex_oauth_beats_api_key() {
    // ChatGPT login is the codex harness default when auth.json exists,
    // even with an API key in the env — document order encodes that.
    let facts = [
        env_fact("OPENAI_API_KEY"),
        discovery_fact("codex-auth-json-oauth"),
    ];
    assert_eq!(classify_bundled("codex", &facts), vec!["openai-oauth"]);
}

#[test]
fn bundled_docs_opencode_unions_across_slots() {
    let facts = [
        env_fact("OPENAI_API_KEY"),
        discovery_fact("opencode-auth-json/anthropic"),
        discovery_fact("opencode-auth-json/opencode"),
    ];
    assert_eq!(
        classify_bundled("opencode", &facts),
        vec!["anthropic-api", "openai-api", "opencode-zen"]
    );
}

#[test]
fn bundled_docs_no_facts_is_baseline() {
    for kind in ["claude", "codex", "gemini", "cursor", "opencode"] {
        assert_eq!(classify_bundled(kind, &[]), vec![BASELINE_CONTEXT_ID]);
    }
}
