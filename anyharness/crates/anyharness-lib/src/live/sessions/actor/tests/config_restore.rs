use super::*;
use crate::app::test_support;

#[test]
fn load_startup_restore_snapshot_captures_controls_for_resume_replay_agents() {
    for agent_kind in [AgentKind::Claude, AgentKind::Codex] {
        assert_startup_restore_snapshot_captures_pre_restart_controls(agent_kind);
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

    let captured = load_startup_restore_snapshot(&store, "session-1", agent_kind.as_str(), true)
        .expect("load startup snapshot")
        .expect("snapshot exists");

    let replacement_snapshot = SessionLiveConfigSnapshot {
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

    let controls = &captured.normalized_controls;
    assert_eq!(
        (
            normalized_control_value(&controls.collaboration_mode),
            normalized_control_value(&controls.effort),
            normalized_control_value(&controls.fast_mode),
        ),
        (Some("plan"), Some("xhigh"), Some("on")),
        "{} resume must retain the pre-overwrite snapshot",
        agent_kind.as_str()
    );
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

fn normalized_control_value(control: &Option<NormalizedSessionControl>) -> Option<&str> {
    control
        .as_ref()
        .and_then(|control| control.current_value.as_deref())
}
