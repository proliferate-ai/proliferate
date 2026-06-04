use super::*;

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
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: AgentKind::Claude.as_str().to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_scope: None,
            required_agent_auth_revision: None,
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
    let mut collaboration_mode = acp::SessionConfigOption::select(
        "collaboration_mode",
        "Mode",
        "plan",
        vec![
            acp::SessionConfigSelectOption::new("default", "Default"),
            acp::SessionConfigSelectOption::new("plan", "Plan"),
        ],
    );
    collaboration_mode.category = Some(acp::SessionConfigOptionCategory::Other(
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
fn direct_model_setter_only_applies_exact_live_ids_or_legacy_empty_lists() {
    let mut startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: None,
        available_models: session_model_options(&["default", "sonnet", "sonnet[1m]", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    assert!(should_apply_model_via_direct_setter(
        &startup_state,
        "sonnet"
    ));
    assert!(!should_apply_model_via_direct_setter(
        &startup_state,
        "opus"
    ));
    assert!(!should_apply_model_via_direct_setter(
        &startup_state,
        "claude-opus-4-6"
    ));

    startup_state.available_models.clear();
    assert!(should_apply_model_via_direct_setter(
        &startup_state,
        "legacy-agent-model"
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

    let error =
        queue_pending_config_change(&store, "session-1", &startup_state, "model", "opus[1m]")
            .expect_err("unlisted model values should be rejected");

    assert!(matches!(
        error,
        crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(detail)
            if detail == "Value 'opus[1m]' is not valid for config option 'model'."
    ));
}

#[test]
fn generic_model_request_can_resolve_model_option_by_purpose() {
    let mut option = acp::SessionConfigOption::select(
        "provider_model",
        "Model",
        "sonnet",
        vec![
            acp::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::SessionConfigSelectOption::new("haiku", "Haiku"),
        ],
    );
    option.category = Some(acp::SessionConfigOptionCategory::Model);

    let options = [option];
    let resolved = find_select_option_for_request(&options, "model");

    assert!(resolved.is_some());
    assert!(is_model_config_request("model", resolved));
}

#[test]
fn select_option_values_flattens_grouped_options() {
    let option = acp::SessionConfigOption::select(
        "model",
        "Model",
        "sonnet",
        vec![acp::SessionConfigSelectGroup::new(
            "claude",
            "Claude",
            vec![
                acp::SessionConfigSelectOption::new("sonnet", "Sonnet"),
                acp::SessionConfigSelectOption::new("opus[1m]", "Opus"),
            ],
        )],
    );

    assert_eq!(select_option_values(&option), vec!["sonnet", "opus[1m]"]);
}

#[test]
fn model_config_request_rejects_values_outside_live_select_options() {
    let db = Db::open_in_memory().expect("open db");
    let store = SessionStore::new(db);
    let mut option = acp::SessionConfigOption::select(
        "model",
        "Model",
        "sonnet",
        vec![
            acp::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::SessionConfigSelectOption::new("haiku", "Haiku"),
        ],
    );
    option.category = Some(acp::SessionConfigOptionCategory::Model);
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![option],
        current_model_id: Some("sonnet".to_string()),
        available_models: session_model_options(&["sonnet", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    let error =
        queue_pending_config_change(&store, "session-1", &startup_state, "model", "opus[1m]")
            .expect_err("unlisted model values should be rejected");

    assert!(matches!(
        error,
        crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(detail)
            if detail == "Value 'opus[1m]' is not valid for config option 'model'."
    ));
}

#[test]
fn select_option_current_value_must_match_requested_value() {
    let mut option = acp::SessionConfigOption::select(
        "provider_model",
        "Model",
        "sonnet[1m]",
        vec![
            acp::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            acp::SessionConfigSelectOption::new("sonnet[1m]", "Sonnet 1M"),
        ],
    );
    option.category = Some(acp::SessionConfigOptionCategory::Model);

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
    let mut option = acp::SessionConfigOption::select(
        "approval_mode",
        "Mode",
        "ask",
        vec![
            acp::SessionConfigSelectOption::new("ask", "Ask"),
            acp::SessionConfigSelectOption::new("code", "Code"),
        ],
    );
    option.category = Some(acp::SessionConfigOptionCategory::Mode);

    let options = [option];
    let resolved = find_select_option_for_request(&options, "mode");

    assert!(resolved.is_some());
    assert!(is_mode_config_request("mode", resolved));
}

#[test]
fn fast_mode_option_is_not_treated_as_mode_request() {
    let mut option = acp::SessionConfigOption::select(
        "fast_mode",
        "Fast Mode",
        "off",
        vec![
            acp::SessionConfigSelectOption::new("off", "Off"),
            acp::SessionConfigSelectOption::new("on", "On"),
        ],
    );
    option.category = Some(acp::SessionConfigOptionCategory::Other("fast_mode".into()));

    let options = [option];
    let resolved = find_select_option_for_request(&options, "fast_mode");

    assert!(resolved.is_some());
    assert!(!is_mode_config_request("fast_mode", resolved));
    assert_eq!(tracked_config_purpose("fast_mode", resolved), None);
    assert!(find_select_option_for_request(&options, "mode").is_none());
}

#[test]
fn collaboration_mode_option_is_not_treated_as_mode_request() {
    let mut option = acp::SessionConfigOption::select(
        "collaboration_mode",
        "Collaboration Mode",
        "plan",
        vec![
            acp::SessionConfigSelectOption::new("default", "Default"),
            acp::SessionConfigSelectOption::new("plan", "Plan"),
        ],
    );
    option.category = Some(acp::SessionConfigOptionCategory::Other(
        "collaboration_mode".into(),
    ));

    let options = [option];
    let resolved = find_select_option_for_request(&options, "collaboration_mode");

    assert!(resolved.is_some());
    assert!(!is_mode_config_request("collaboration_mode", resolved));
    assert_eq!(tracked_config_purpose("collaboration_mode", resolved), None);
    assert!(find_select_option_for_request(&options, "mode").is_none());
}
