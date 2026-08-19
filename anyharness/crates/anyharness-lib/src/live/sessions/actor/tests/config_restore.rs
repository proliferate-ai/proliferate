use super::*;
use crate::app::test_support;

#[test]
fn canonical_restore_uses_current_values_and_saved_harness_order() {
    let snapshot = SessionLiveConfigSnapshot {
        models: vec![launch_model("m-old"), launch_model("m-saved")],
        controls: vec![
            launch_control("control-b", &["b-old", "b-saved"]),
            launch_control("control-a", &["a-old", "a-saved"]),
        ],
        current: SessionLiveConfigCurrent {
            model_id: Some("m-saved".into()),
            // BTreeMap order deliberately differs from the saved harness order.
            control_values: [
                ("control-a".to_string(), "a-saved".to_string()),
                ("control-b".to_string(), "b-saved".to_string()),
            ]
            .into_iter()
            .collect(),
        },
        raw_config_options: vec![],
        // A conflicting compatibility projection must never drive restore.
        normalized_controls: NormalizedSessionControls {
            effort: Some(normalized_select_control(
                "effort",
                "control-a",
                "Control A",
                "a-old",
                &[("a-old", "Old"), ("a-saved", "Saved")],
            )),
            ..Default::default()
        },
        prompt_capabilities: Default::default(),
        source_seq: 7,
        updated_at: "2026-08-19T00:00:00Z".into(),
    };

    let desired = canonical_restore_values(&snapshot).expect("canonical restore values");
    assert_eq!(
        desired
            .into_iter()
            .map(|(_, config_id, value)| format!("{config_id}={value}"))
            .collect::<Vec<_>>(),
        vec![
            "model=m-saved".to_string(),
            "control-b=b-saved".to_string(),
            "control-a=a-saved".to_string(),
        ]
    );
}

#[test]
fn canonical_restore_rejects_incomplete_or_nonmember_current_values() {
    let mut snapshot = SessionLiveConfigSnapshot {
        models: vec![launch_model("m-saved")],
        controls: vec![launch_control("effort", &["low", "high"])],
        current: SessionLiveConfigCurrent {
            model_id: Some("m-saved".into()),
            control_values: Default::default(),
        },
        raw_config_options: vec![],
        normalized_controls: Default::default(),
        prompt_capabilities: Default::default(),
        source_seq: 7,
        updated_at: "2026-08-19T00:00:00Z".into(),
    };

    let missing = canonical_restore_values(&snapshot)
        .expect_err("every saved control must have a current value");
    assert!(missing.to_string().contains("has no current value"));

    snapshot
        .current
        .control_values
        .insert("effort".into(), "removed".into());
    let nonmember = canonical_restore_values(&snapshot)
        .expect_err("saved current values must remain members of saved options");
    assert!(nonmember
        .to_string()
        .contains("absent from saved live control"));

    snapshot
        .current
        .control_values
        .insert("effort".into(), "high".into());
    snapshot.current.model_id = Some("removed-model".into());
    let missing_model = canonical_restore_values(&snapshot)
        .expect_err("a reported saved current model must remain a saved member");
    assert!(missing_model
        .to_string()
        .contains("absent from the saved live model options"));
}

#[test]
fn load_startup_restore_snapshot_captures_full_authority_for_every_resume() {
    for agent_kind in AgentKind::all() {
        assert_startup_restore_snapshot_captures_pre_restart_controls(agent_kind.clone());
    }
}

fn assert_startup_restore_snapshot_captures_pre_restart_controls(agent_kind: AgentKind) {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: agent_kind.as_str().to_string(),
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

    let persisted_snapshot = SessionLiveConfigSnapshot {
        models: vec![launch_model("model-saved")],
        controls: vec![
            launch_control("collaboration_mode", &["chat", "plan"]),
            launch_control("reasoning_effort", &["medium", "xhigh"]),
            launch_control("fast_mode", &["off", "on"]),
        ],
        current: SessionLiveConfigCurrent {
            model_id: Some("model-saved".into()),
            control_values: [
                ("collaboration_mode".to_string(), "plan".to_string()),
                ("reasoning_effort".to_string(), "xhigh".to_string()),
                ("fast_mode".to_string(), "on".to_string()),
            ]
            .into_iter()
            .collect(),
        },
        raw_config_options: vec![],
        normalized_controls: NormalizedSessionControls {
            model: None,
            collaboration_mode: Some(normalized_select_control(
                "collaboration_mode",
                "collaboration_mode",
                "Collaboration Mode",
                "plan",
                &[("chat", "Chat"), ("plan", "Plan")],
            )),
            mode: None,
            reasoning: None,
            effort: Some(normalized_select_control(
                "effort",
                "reasoning_effort",
                "Reasoning Effort",
                "xhigh",
                &[("medium", "Medium"), ("xhigh", "Extra High")],
            )),
            fast_mode: Some(normalized_select_control(
                "fast_mode",
                "fast_mode",
                "Fast Mode",
                "on",
                &[("off", "Off"), ("on", "On")],
            )),
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

    let captured = load_startup_restore_snapshot(&store, "session-1", true)
        .expect("load startup snapshot")
        .expect("snapshot exists");

    let replacement_snapshot = SessionLiveConfigSnapshot {
        models: vec![launch_model("model-replacement")],
        controls: vec![
            launch_control("collaboration_mode", &["chat", "plan"]),
            launch_control("reasoning_effort", &["medium", "xhigh"]),
            launch_control("fast_mode", &["off", "on"]),
        ],
        current: SessionLiveConfigCurrent {
            model_id: Some("model-replacement".into()),
            control_values: [
                ("collaboration_mode".to_string(), "chat".to_string()),
                ("reasoning_effort".to_string(), "medium".to_string()),
                ("fast_mode".to_string(), "off".to_string()),
            ]
            .into_iter()
            .collect(),
        },
        raw_config_options: vec![],
        normalized_controls: NormalizedSessionControls {
            model: None,
            collaboration_mode: Some(normalized_select_control(
                "collaboration_mode",
                "collaboration_mode",
                "Collaboration Mode",
                "chat",
                &[("chat", "Chat"), ("plan", "Plan")],
            )),
            mode: None,
            reasoning: None,
            effort: Some(normalized_select_control(
                "effort",
                "reasoning_effort",
                "Reasoning Effort",
                "medium",
                &[("medium", "Medium"), ("xhigh", "Extra High")],
            )),
            fast_mode: Some(normalized_select_control(
                "fast_mode",
                "fast_mode",
                "Fast Mode",
                "off",
                &[("off", "Off"), ("on", "On")],
            )),
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
        (
            captured.current.model_id.as_deref(),
            captured
                .current
                .control_values
                .get("collaboration_mode")
                .map(String::as_str),
            captured
                .current
                .control_values
                .get("reasoning_effort")
                .map(String::as_str),
            captured
                .current
                .control_values
                .get("fast_mode")
                .map(String::as_str),
        ),
        (Some("model-saved"), Some("plan"), Some("xhigh"), Some("on")),
        "{} resume must retain the pre-overwrite snapshot",
        agent_kind.as_str()
    );
}

fn launch_model(id: &str) -> HarnessLaunchModel {
    HarnessLaunchModel {
        id: id.into(),
        observed_name: Some(id.into()),
        observed_description: None,
    }
}

fn launch_control(id: &str, values: &[&str]) -> HarnessLaunchControl {
    HarnessLaunchControl {
        id: id.into(),
        observed_label: Some(id.into()),
        observed_description: None,
        values: values
            .iter()
            .map(|value| HarnessLaunchControlValue {
                value: (*value).into(),
                observed_label: Some((*value).into()),
                observed_description: None,
            })
            .collect(),
    }
}

fn normalized_select_control(
    key: &str,
    raw_config_id: &str,
    label: &str,
    current_value: &str,
    values: &[(&str, &str)],
) -> NormalizedSessionControl {
    NormalizedSessionControl {
        key: key.into(),
        raw_config_id: raw_config_id.into(),
        label: label.into(),
        current_value: Some(current_value.into()),
        settable: true,
        values: values
            .iter()
            .map(|(value, label)| NormalizedSessionControlValue {
                value: (*value).into(),
                label: (*label).into(),
                description: None,
            })
            .collect(),
    }
}

#[tokio::test]
async fn full_live_snapshot_store_failure_is_returned_before_readiness() {
    let db = Db::open_in_memory().expect("open db");
    db.with_conn(|conn| {
        conn.execute_batch("DROP TABLE session_live_config_snapshots")?;
        Ok(())
    })
    .expect("install snapshot-store failure");
    let store = SessionStore::new(db);
    let (event_tx, _) = broadcast::channel(8);
    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        "session-1".to_string(),
        "codex".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx,
        Arc::new(store.clone()),
    )));
    let mut persisted_config_state = PersistedSessionConfigState {
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
    };
    let mut startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: Vec::new(),
        current_model_id: None,
        available_models: Vec::new(),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    let error = emit_live_config_update(
        "codex",
        "session-1",
        &store,
        &event_sink,
        &mut persisted_config_state,
        &mut startup_state,
        "2026-08-19T00:00:00Z".to_string(),
    )
    .await
    .expect_err("startup must observe a full-snapshot persistence failure");

    assert!(error.to_string().contains("session_live_config_snapshots"));
}
