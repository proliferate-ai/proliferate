use super::*;
use crate::app::test_support;

#[test]
fn resolves_missing_params_to_unique_live_composed_value() {
    let mut option = model_option(&[
        ("kimi-k2.5[]", "Kimi K2.5"),
        ("composer-2.5[fast=true]", "Composer 2.5"),
    ]);
    set_current_value(&mut option, "kimi-k2.5[]");

    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5"),
        "composer-2.5[fast=true]"
    );
    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5[]"),
        "composer-2.5[fast=true]"
    );
    assert_eq!(
        resolve_model_variant_value(&option, "kimi-k2.5[]"),
        "kimi-k2.5[]"
    );
    assert_eq!(
        resolve_model_variant_value(&option, "unknown-model"),
        "unknown-model"
    );
}

#[test]
fn preserves_explicit_params_and_ambiguous_bases() {
    let option = model_option(&[
        ("composer-2.5[fast=true]", "Composer Fast"),
        ("composer-2.5[fast=false]", "Composer Standard"),
    ]);

    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5[fast=false]"),
        "composer-2.5[fast=false]"
    );
    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5"),
        "composer-2.5"
    );
}

#[test]
fn does_not_collapse_context_tags_or_non_model_controls() {
    let model_option = model_option(&[("sonnet[1m]", "Sonnet (1M context)")]);
    assert_eq!(
        resolve_model_variant_value(&model_option, "sonnet"),
        "sonnet"
    );

    let mut mode_option = acp::schema::SessionConfigOption::select(
        "mode",
        "Mode",
        "agent",
        vec![acp::schema::SessionConfigSelectOption::new(
            "agent[fast=true]",
            "Agent",
        )],
    );
    mode_option.category = Some(acp::schema::SessionConfigOptionCategory::Mode);
    assert_eq!(resolve_model_variant_value(&mode_option, "agent"), "agent");
}

#[test]
fn busy_queue_persists_resolved_live_model_variant() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db);
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: AgentKind::Cursor.as_str().to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "busy".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        })
        .expect("insert session");

    let mut option = model_option(&[
        ("kimi-k2.5[]", "Kimi K2.5"),
        ("composer-2.5[fast=true]", "Composer 2.5"),
    ]);
    set_current_value(&mut option, "kimi-k2.5[]");
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![option],
        current_model_id: Some("kimi-k2.5[]".to_string()),
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    let resolved = queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "composer-2.5",
        false,
    )
    .expect("queue live-advertised model variant");

    assert_eq!(resolved, "composer-2.5[fast=true]");
    let pending = store
        .list_pending_config_changes("session-1")
        .expect("list pending config");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].value, "composer-2.5[fast=true]");
}

fn model_option(values: &[(&str, &str)]) -> acp::schema::SessionConfigOption {
    let mut option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        values
            .first()
            .map_or_else(String::new, |(value, _)| (*value).to_string()),
        values
            .iter()
            .map(|(value, name)| {
                acp::schema::SessionConfigSelectOption::new(
                    (*value).to_string(),
                    (*name).to_string(),
                )
            })
            .collect::<Vec<_>>(),
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);
    option
}

fn set_current_value(option: &mut acp::schema::SessionConfigOption, value: &str) {
    let acp::schema::SessionConfigKind::Select(select) = &mut option.kind else {
        panic!("test model option must be select");
    };
    select.current_value = value.to_string().into();
}
