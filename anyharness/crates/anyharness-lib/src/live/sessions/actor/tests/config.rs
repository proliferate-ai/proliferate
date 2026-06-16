use super::*;
use crate::app::test_support;

fn session_model_options(ids: &[&str]) -> Vec<SessionModelOption> {
    ids.iter()
        .map(|id| SessionModelOption {
            id: (*id).to_string(),
            name: (*id).to_string(),
            description: None,
        })
        .collect()
}

#[test]
fn load_startup_restore_snapshot_captures_pre_restart_controls_before_overwrite() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: AgentKind::Claude.as_str().to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
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

    let persisted_snapshot = SessionLiveConfigSnapshot {
        raw_config_options: vec![],
        normalized_controls: NormalizedSessionControls {
            model: None,
            collaboration_mode: Some(NormalizedSessionControl {
                key: "collaboration_mode".into(),
                raw_config_id: "collaboration_mode".into(),
                label: "Collaboration Mode".into(),
                current_value: Some("plan".into()),
                settable: true,
                values: vec![
                    NormalizedSessionControlValue {
                        value: "chat".into(),
                        label: "Chat".into(),
                        description: None,
                    },
                    NormalizedSessionControlValue {
                        value: "plan".into(),
                        label: "Plan".into(),
                        description: None,
                    },
                ],
            }),
            mode: None,
            reasoning: None,
            effort: None,
            fast_mode: None,
            extras: vec![],
        },
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        source_seq: 1,
        updated_at: "2026-03-25T00:00:00Z".into(),
    };
    store
        .upsert_live_config_snapshot(
            &snapshot_to_record("session-1", &persisted_snapshot).expect("snapshot record"),
        )
        .expect("persist old snapshot");

    let captured =
        load_startup_restore_snapshot(&store, "session-1", AgentKind::Claude.as_str(), true)
            .expect("load startup snapshot")
            .expect("snapshot exists");

    let replacement_snapshot = SessionLiveConfigSnapshot {
        raw_config_options: vec![],
        normalized_controls: NormalizedSessionControls {
            model: None,
            collaboration_mode: Some(NormalizedSessionControl {
                key: "collaboration_mode".into(),
                raw_config_id: "collaboration_mode".into(),
                label: "Collaboration Mode".into(),
                current_value: Some("chat".into()),
                settable: true,
                values: vec![
                    NormalizedSessionControlValue {
                        value: "chat".into(),
                        label: "Chat".into(),
                        description: None,
                    },
                    NormalizedSessionControlValue {
                        value: "plan".into(),
                        label: "Plan".into(),
                        description: None,
                    },
                ],
            }),
            mode: None,
            reasoning: None,
            effort: None,
            fast_mode: None,
            extras: vec![],
        },
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        source_seq: 2,
        updated_at: "2026-03-25T00:01:00Z".into(),
    };
    store
        .upsert_live_config_snapshot(
            &snapshot_to_record("session-1", &replacement_snapshot)
                .expect("replacement snapshot record"),
        )
        .expect("persist replacement snapshot");

    assert_eq!(
        captured
            .normalized_controls
            .collaboration_mode
            .as_ref()
            .and_then(|control| control.current_value.as_deref()),
        Some("plan")
    );
}

#[test]
fn persisted_control_values_orders_standard_controls_before_extras() {
    let controls = NormalizedSessionControls {
        model: Some(NormalizedSessionControl {
            key: "model".into(),
            raw_config_id: "model".into(),
            label: "Model".into(),
            current_value: Some("default".into()),
            settable: true,
            values: vec![NormalizedSessionControlValue {
                value: "default".into(),
                label: "Default".into(),
                description: None,
            }],
        }),
        collaboration_mode: Some(NormalizedSessionControl {
            key: "collaboration_mode".into(),
            raw_config_id: "collaboration_mode".into(),
            label: "Mode".into(),
            current_value: Some("plan".into()),
            settable: true,
            values: vec![],
        }),
        mode: Some(NormalizedSessionControl {
            key: "mode".into(),
            raw_config_id: "mode".into(),
            label: "Mode".into(),
            current_value: Some("default".into()),
            settable: true,
            values: vec![],
        }),
        reasoning: Some(NormalizedSessionControl {
            key: "reasoning".into(),
            raw_config_id: "thinking".into(),
            label: "Thinking".into(),
            current_value: Some("off".into()),
            settable: true,
            values: vec![],
        }),
        effort: Some(NormalizedSessionControl {
            key: "effort".into(),
            raw_config_id: "effort".into(),
            label: "Effort".into(),
            current_value: Some("max".into()),
            settable: true,
            values: vec![],
        }),
        fast_mode: Some(NormalizedSessionControl {
            key: "fast_mode".into(),
            raw_config_id: "fast_mode".into(),
            label: "Fast Mode".into(),
            current_value: Some("on".into()),
            settable: true,
            values: vec![],
        }),
        extras: vec![NormalizedSessionControl {
            key: "extra:foo".into(),
            raw_config_id: "foo".into(),
            label: "Foo".into(),
            current_value: Some("bar".into()),
            settable: true,
            values: vec![],
        }],
    };

    let values = persisted_control_values(&controls);
    let ids = values
        .into_iter()
        .map(|(_, config_id, value)| format!("{config_id}={value}"))
        .collect::<Vec<_>>();

    assert_eq!(
        ids,
        vec![
            "model=default",
            "collaboration_mode=plan",
            "thinking=off",
            "effort=max",
            "fast_mode=on",
            "mode=default",
            "foo=bar",
        ]
    );
}

#[test]
fn pending_config_rank_keeps_collaboration_mode_in_standard_order() {
    let mut collaboration_mode = acp::schema::SessionConfigOption::select(
        "collaboration_mode",
        "Mode",
        "plan",
        vec![
            acp::schema::SessionConfigSelectOption::new("default", "Default"),
            acp::schema::SessionConfigSelectOption::new("plan", "Plan"),
        ],
    );
    collaboration_mode.category = Some(acp::schema::SessionConfigOptionCategory::Other(
        "collaboration_mode".into(),
    ));

    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![collaboration_mode],
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    assert_eq!(
        pending_config_rank(&startup_state, "collaboration_mode"),
        normalized_key_rank(NormalizedControlKind::CollaborationMode)
    );
}

#[test]
fn pending_config_rank_treats_synthetic_acp_model_control_as_model() {
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: Some("sonnet".to_string()),
        available_models: session_model_options(&["sonnet", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    assert_eq!(
        pending_config_rank(&startup_state, "model"),
        normalized_key_rank(NormalizedControlKind::Model)
    );
}

#[test]
fn direct_model_setter_is_permanently_disabled() {
    // set_session_model was removed from ACP in 0.14; the setter stub always
    // returns NotApplied. should_apply_model_via_direct_setter must always return
    // false so callers reject model requests rather than silently accepting them.
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    assert!(!should_apply_model_via_direct_setter(
        &startup_state,
        "sonnet"
    ));
    assert!(!should_apply_model_via_direct_setter(
        &startup_state,
        "opus"
    ));
}

#[test]
fn model_config_request_without_raw_option_rejects_values_outside_acp_models() {
    let db = Db::open_in_memory().expect("open db");
    let store = SessionStore::new(db);
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: Some("sonnet".to_string()),
        available_models: session_model_options(&["sonnet", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    let error = queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "opus[1m]",
        false,
    )
    .expect_err("unlisted model values should be rejected");

    assert!(matches!(
        error,
        crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(detail)
            if detail == "Value 'opus[1m]' is not valid for config option 'model'."
    ));
}

#[test]
fn queue_accepts_catalog_authorized_model_value_outside_live_options() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: AgentKind::Claude.as_str().to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
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
    let mut option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "sonnet",
        vec![
            acp::schema::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::schema::SessionConfigSelectOption::new("haiku", "Haiku"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![option],
        current_model_id: Some("sonnet".to_string()),
        available_models: session_model_options(&["sonnet", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    // Same value, same option list — the only difference is the catalog
    // authorization computed at the runtime seam (decision 10: the catalog
    // is the switch authority; the harness-advertised list is not a cage).
    queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "claude-fable-5",
        true,
    )
    .expect("catalog-authorized model value must queue");

    queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "claude-fable-5",
        false,
    )
    .expect_err("the same value without catalog authorization stays rejected");
}

#[test]
fn generic_model_request_can_resolve_model_option_by_purpose() {
    let mut option = acp::schema::SessionConfigOption::select(
        "provider_model",
        "Model",
        "sonnet",
        vec![
            acp::schema::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::schema::SessionConfigSelectOption::new("haiku", "Haiku"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);

    let options = [option];
    let resolved = find_select_option_for_request(&options, "model");

    assert!(resolved.is_some());
    assert!(is_model_config_request("model", resolved));
}

#[test]
fn select_option_values_flattens_grouped_options() {
    let option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "sonnet",
        vec![acp::schema::SessionConfigSelectGroup::new(
            "claude",
            "Claude",
            vec![
                acp::schema::SessionConfigSelectOption::new("sonnet", "Sonnet"),
                acp::schema::SessionConfigSelectOption::new("opus[1m]", "Opus"),
            ],
        )],
    );

    assert_eq!(select_option_values(&option), vec!["sonnet", "opus[1m]"]);
}

#[test]
fn resolve_model_variant_value_maps_base_id_to_advertised_composed_value() {
    let mut option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "kimi-k2.5[]",
        vec![
            acp::schema::SessionConfigSelectOption::new("kimi-k2.5[]", "kimi-k2.5"),
            acp::schema::SessionConfigSelectOption::new("composer-2.5[fast=true]", "composer-2.5"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);

    // A bare base id resolves to the single advertised composed value.
    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5"),
        "composer-2.5[fast=true]"
    );
    // An empty-bracket form resolves by the same base.
    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5[]"),
        "composer-2.5[fast=true]"
    );
    // An exact advertised value is returned unchanged.
    assert_eq!(
        resolve_model_variant_value(&option, "kimi-k2.5[]"),
        "kimi-k2.5[]"
    );
    // An unknown base is left as-is so the harness still decides.
    assert_eq!(resolve_model_variant_value(&option, "gpt-5.5"), "gpt-5.5");
}

#[test]
fn resolve_model_variant_value_never_overrides_explicit_params() {
    let mut option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "composer-2.5[fast=true]",
        vec![acp::schema::SessionConfigSelectOption::new(
            "composer-2.5[fast=true]",
            "composer-2.5",
        )],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);

    // A request that already names its params is left as-is, even though the
    // base matches the single advertised variant.
    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5[fast=false]"),
        "composer-2.5[fast=false]"
    );
    // An empty `[]` carries no choice, so it still resolves to the variant.
    assert_eq!(
        resolve_model_variant_value(&option, "composer-2.5[]"),
        "composer-2.5[fast=true]"
    );
}

#[test]
fn resolve_model_variant_value_does_not_collapse_context_tag_variants() {
    // A `[1m]` context tag is a distinct model id, not a bracket-params
    // variant — a bare base must never silently resolve into it.
    let mut option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "sonnet[1m]",
        vec![acp::schema::SessionConfigSelectOption::new(
            "sonnet[1m]",
            "Sonnet (1M context)",
        )],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);
    assert_eq!(resolve_model_variant_value(&option, "sonnet"), "sonnet");
}

#[test]
fn resolve_model_variant_value_is_noop_for_non_model_options() {
    let mut option = acp::schema::SessionConfigOption::select(
        "mode",
        "Mode",
        "default",
        vec![
            acp::schema::SessionConfigSelectOption::new("default", "Default"),
            acp::schema::SessionConfigSelectOption::new("plan", "Plan"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Mode);
    assert_eq!(resolve_model_variant_value(&option, "agent"), "agent");
}

#[test]
fn model_config_request_rejects_values_outside_live_select_options() {
    let db = Db::open_in_memory().expect("open db");
    let store = SessionStore::new(db);
    let mut option = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "sonnet",
        vec![
            acp::schema::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::schema::SessionConfigSelectOption::new("haiku", "Haiku"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![option],
        current_model_id: Some("sonnet".to_string()),
        available_models: session_model_options(&["sonnet", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    let error = queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "opus[1m]",
        false,
    )
    .expect_err("unlisted model values should be rejected");

    assert!(matches!(
        error,
        crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(detail)
            if detail == "Value 'opus[1m]' is not valid for config option 'model'."
    ));
}

#[test]
fn select_option_current_value_must_match_requested_value() {
    let mut option = acp::schema::SessionConfigOption::select(
        "provider_model",
        "Model",
        "sonnet[1m]",
        vec![
            acp::schema::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::schema::SessionConfigSelectOption::new("sonnet[1m]", "Sonnet 1M"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Model);

    assert!(select_option_current_value_matches(
        &[option.clone()],
        "model",
        "sonnet[1m]",
    ));
    assert!(!select_option_current_value_matches(
        &[option],
        "model",
        "opus[1m]",
    ));
}

#[test]
fn generic_mode_request_can_resolve_mode_option_by_purpose() {
    let mut option = acp::schema::SessionConfigOption::select(
        "approval_mode",
        "Mode",
        "ask",
        vec![
            acp::schema::SessionConfigSelectOption::new("ask", "Ask"),
            acp::schema::SessionConfigSelectOption::new("code", "Code"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Mode);

    let options = [option];
    let resolved = find_select_option_for_request(&options, "mode");

    assert!(resolved.is_some());
    assert!(is_mode_config_request("mode", resolved));
}

#[test]
fn fast_mode_option_is_not_treated_as_mode_request() {
    let mut option = acp::schema::SessionConfigOption::select(
        "fast_mode",
        "Fast Mode",
        "off",
        vec![
            acp::schema::SessionConfigSelectOption::new("off", "Off"),
            acp::schema::SessionConfigSelectOption::new("on", "On"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Other(
        "fast_mode".into(),
    ));

    let options = [option];
    let resolved = find_select_option_for_request(&options, "fast_mode");

    assert!(resolved.is_some());
    assert!(!is_mode_config_request("fast_mode", resolved));
    assert_eq!(tracked_config_purpose("fast_mode", resolved), None);
    assert!(find_select_option_for_request(&options, "mode").is_none());
}

#[test]
fn collaboration_mode_option_is_not_treated_as_mode_request() {
    let mut option = acp::schema::SessionConfigOption::select(
        "collaboration_mode",
        "Collaboration Mode",
        "plan",
        vec![
            acp::schema::SessionConfigSelectOption::new("default", "Default"),
            acp::schema::SessionConfigSelectOption::new("plan", "Plan"),
        ],
    );
    option.category = Some(acp::schema::SessionConfigOptionCategory::Other(
        "collaboration_mode".into(),
    ));

    let options = [option];
    let resolved = find_select_option_for_request(&options, "collaboration_mode");

    assert!(resolved.is_some());
    assert!(!is_mode_config_request("collaboration_mode", resolved));
    assert_eq!(tracked_config_purpose("collaboration_mode", resolved), None);
    assert!(find_select_option_for_request(&options, "mode").is_none());
}
