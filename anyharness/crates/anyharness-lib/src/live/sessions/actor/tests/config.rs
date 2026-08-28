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
fn direct_model_setter_engages_only_without_live_model_control() {
    // Harnesses that report no live model control (neither a model config
    // option nor available_models) route a switch through the legacy
    // `session/set_model` ext call; its response must still carry an exact
    // current-model readback before the actor accepts it.
    let no_model_control = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    assert!(should_apply_model_via_direct_setter(
        &no_model_control,
        "grok-4.3"
    ));

    // When a live model list IS present, membership is enforced upstream — the
    // direct setter must not override it.
    let with_model_control = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: Some("sonnet".to_string()),
        available_models: session_model_options(&["sonnet", "haiku"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    assert!(!should_apply_model_via_direct_setter(
        &with_model_control,
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
fn queue_accepts_live_snapshot_authorized_model_value_outside_raw_options() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: AgentKind::Claude.as_str().to_string(),
            native_session_id: Some("native-1".to_string()),
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

    // Same value and raw option list: only the current canonical live-snapshot
    // authorization differs. That exact-session statement can admit a value
    // while the raw ACP select list is stale.
    queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "claude-fable-5",
        true,
    )
    .expect("live-snapshot-authorized model value must queue");

    queue_pending_config_change(
        &store,
        "session-1",
        &startup_state,
        "model",
        "claude-fable-5",
        false,
    )
    .expect_err("the same value without live snapshot authorization stays rejected");

    let fable_snapshot = SessionLiveConfigSnapshot {
        models: vec![HarnessLaunchModel {
            id: "claude-fable-5".to_string(),
            observed_name: Some("Fable".to_string()),
            observed_description: None,
        }],
        controls: Vec::new(),
        current: SessionLiveConfigCurrent {
            model_id: Some("claude-fable-5".to_string()),
            control_values: Default::default(),
        },
        raw_config_options: Vec::new(),
        normalized_controls: NormalizedSessionControls::default(),
        prompt_capabilities: Default::default(),
        source_seq: 1,
        updated_at: "2026-03-25T00:00:01Z".to_string(),
    };
    store
        .upsert_live_config_snapshot(
            &snapshot_to_record("session-1", &fable_snapshot).expect("serialize snapshot"),
        )
        .expect("persist Fable live snapshot");
    assert!(
        pending_model_is_in_latest_live_snapshot(&store, "session-1", "claude-fable-5")
            .expect("read latest snapshot")
    );

    let sonnet_snapshot = SessionLiveConfigSnapshot {
        models: vec![HarnessLaunchModel {
            id: "sonnet".to_string(),
            observed_name: Some("Sonnet".to_string()),
            observed_description: None,
        }],
        current: SessionLiveConfigCurrent {
            model_id: Some("sonnet".to_string()),
            control_values: Default::default(),
        },
        source_seq: 2,
        updated_at: "2026-03-25T00:00:02Z".to_string(),
        ..fable_snapshot
    };
    store
        .upsert_live_config_snapshot(
            &snapshot_to_record("session-1", &sonnet_snapshot).expect("serialize snapshot"),
        )
        .expect("replace live snapshot without Fable");
    assert!(
        !pending_model_is_in_latest_live_snapshot(&store, "session-1", "claude-fable-5")
            .expect("read replacement snapshot")
    );
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

#[test]
fn final_whole_intent_rejects_a_later_setter_resetting_the_model() {
    let mut model = acp::schema::SessionConfigOption::select(
        "model",
        "Model",
        "m-old",
        vec![
            acp::schema::SessionConfigSelectOption::new("m-old", "Old"),
            acp::schema::SessionConfigSelectOption::new("m-new", "New"),
        ],
    );
    model.category = Some(acp::schema::SessionConfigOptionCategory::Model);
    let later_control = acp::schema::SessionConfigOption::select(
        "effort",
        "Effort",
        "high",
        vec![
            acp::schema::SessionConfigSelectOption::new("low", "Low"),
            acp::schema::SessionConfigSelectOption::new("high", "High"),
        ],
    );
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        // This is the adversarial full response after setting `effort`: the
        // later setter confirmed itself but reset the previously confirmed model.
        config_options: vec![model, later_control],
        current_model_id: Some("m-new".to_string()),
        available_models: session_model_options(&["m-old", "m-new"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    let intent = ResolvedLaunchIntent {
        model_id: Some("m-new".to_string()),
        control_values: [("effort".to_string(), "high".to_string())]
            .into_iter()
            .collect(),
        created_at: "2026-08-19T00:00:00Z".to_string(),
    };

    let error = ensure_resolved_launch_intent_confirmed(&startup_state, &intent)
        .expect_err("the final aggregate must notice the reset model");
    assert!(error.to_string().contains("final live model"));
}

#[test]
fn generic_setter_noop_response_is_not_authoritative() {
    let option = acp::schema::SessionConfigOption::select(
        "fast_mode",
        "Fast Mode",
        "off",
        vec![
            acp::schema::SessionConfigSelectOption::new("off", "Off"),
            acp::schema::SessionConfigSelectOption::new("on", "On"),
        ],
    );
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![option],
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    assert_eq!(
        select_setter_response_outcome(&startup_state, "fast_mode", "on"),
        ConfigApplyOutcome::NotApplied,
        "a valid full response that keeps the old current value is a refusal"
    );
}

#[test]
fn restore_rejects_a_saved_value_missing_from_the_live_statement() {
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    let saved = vec![(
        normalized_key_rank(NormalizedControlKind::Extra),
        "removed-control".to_string(),
        "saved-value".to_string(),
    )];

    let error = ensure_config_values_confirmed(&startup_state, &saved, "saved")
        .expect_err("a missing saved value must fail resume");
    assert!(error.to_string().contains("removed-control"));
}

#[test]
fn every_reported_live_contradiction_reaches_the_refresh_port() {
    struct RecordingInvalidator(std::sync::atomic::AtomicUsize);

    impl LaunchObservationInvalidator for RecordingInvalidator {
        fn queue_refresh(&self, _harness_kind: &str) -> bool {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            true
        }
    }

    let db = Db::open_in_memory().expect("open db");
    let store = SessionStore::new(db);
    let recorder = Arc::new(RecordingInvalidator(std::sync::atomic::AtomicUsize::new(0)));
    let mut caps = test_support::actor_capabilities_for_store(&store);
    caps.launch_observation_invalidator = Some(recorder.clone());

    queue_launch_observation_refresh(&caps, "codex", "session-1");
    queue_launch_observation_refresh(&caps, "codex", "session-2");

    assert_eq!(
        recorder.0.load(std::sync::atomic::Ordering::SeqCst),
        2,
        "the actor must not suppress any contradiction before the queue deduplicates it"
    );
}
