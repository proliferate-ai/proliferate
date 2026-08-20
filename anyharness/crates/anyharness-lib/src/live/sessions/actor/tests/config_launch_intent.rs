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
fn dropped_per_model_control_is_excluded_from_the_final_aggregate_check() {
    // The live codex statement after applying gpt-5.5 narrows reasoning_effort
    // and no longer offers 'max'; the start path drops that control and the
    // final aggregate must confirm the remaining intent instead of failing.
    let effort = acp::schema::SessionConfigOption::select(
        "reasoning_effort",
        "Reasoning effort",
        "xhigh",
        vec![
            acp::schema::SessionConfigSelectOption::new("low", "Low"),
            acp::schema::SessionConfigSelectOption::new("xhigh", "Xhigh"),
        ],
    );
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![effort],
        current_model_id: Some("gpt-5.5".to_string()),
        available_models: session_model_options(&["gpt-5.5"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    let intent = ResolvedLaunchIntent {
        model_id: Some("gpt-5.5".to_string()),
        control_values: [("reasoning_effort".to_string(), "max".to_string())]
            .into_iter()
            .collect(),
        created_at: "2026-08-19T00:00:00Z".to_string(),
    };

    // Negative control: the unfiltered intent still fails the aggregate.
    ensure_resolved_launch_intent_confirmed(&startup_state, &intent)
        .expect_err("the undropped value must keep failing the aggregate");

    let confirmed =
        intent_without_dropped_controls(&intent, &["reasoning_effort".to_string()]);
    assert!(confirmed.control_values.is_empty());
    assert_eq!(confirmed.model_id.as_deref(), Some("gpt-5.5"));
    ensure_resolved_launch_intent_confirmed(&startup_state, &confirmed)
        .expect("the filtered intent must confirm cleanly");
}

#[test]
fn intent_without_dropped_controls_keeps_undropped_values() {
    let intent = ResolvedLaunchIntent {
        model_id: None,
        control_values: [
            ("mode".to_string(), "agent".to_string()),
            ("reasoning_effort".to_string(), "max".to_string()),
        ]
        .into_iter()
        .collect(),
        created_at: "2026-08-19T00:00:00Z".to_string(),
    };
    let confirmed =
        intent_without_dropped_controls(&intent, &["reasoning_effort".to_string()]);
    assert_eq!(
        confirmed.control_values.get("mode").map(String::as_str),
        Some("agent")
    );
    assert!(!confirmed.control_values.contains_key("reasoning_effort"));
}

#[test]
fn disposition_drops_only_values_the_live_statement_does_not_offer() {
    let effort = acp::schema::SessionConfigOption::select(
        "reasoning_effort",
        "Reasoning effort",
        "xhigh",
        vec![
            acp::schema::SessionConfigSelectOption::new("low", "Low"),
            acp::schema::SessionConfigSelectOption::new("xhigh", "Xhigh"),
        ],
    );
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![effort],
        current_model_id: Some("gpt-5.5".to_string()),
        available_models: session_model_options(&["gpt-5.5"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    // Negative control: an OFFERED value must go through the setter path so a
    // read-back refusal stays fatal; it must never be silently dropped.
    assert_eq!(
        initial_control_disposition(&startup_state, "reasoning_effort", "low"),
        InitialControlDisposition::Apply,
    );
    // A value the live statement already states needs no round-trip.
    assert_eq!(
        initial_control_disposition(&startup_state, "reasoning_effort", "xhigh"),
        InitialControlDisposition::AlreadyLive,
    );
    // The per-model narrowing class: not offered under the applied model.
    assert_eq!(
        initial_control_disposition(&startup_state, "reasoning_effort", "max"),
        InitialControlDisposition::Drop,
    );
    // A control the live statement never surfaced at all.
    assert_eq!(
        initial_control_disposition(&startup_state, "fast-mode", "on"),
        InitialControlDisposition::Drop,
    );
}
