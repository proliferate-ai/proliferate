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
}

#[test]
fn disposition_refuses_posture_controls_the_live_statement_does_not_offer() {
    // Posture controls decide what the agent is allowed to do; an unoffered
    // value must refuse the start rather than launch at the harness default.
    let startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![
            approval_policy_option(),
            collaboration_mode_option(),
            reasoning_effort_option(),
        ],
        current_model_id: Some("gpt-5.5".to_string()),
        available_models: session_model_options(&["gpt-5.5"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };

    assert_eq!(
        initial_control_disposition(&startup_state, "approval_policy", "never"),
        InitialControlDisposition::Refuse,
    );
    assert_eq!(
        initial_control_disposition(&startup_state, "collaboration_mode", "plan"),
        InitialControlDisposition::Refuse,
    );
    // Negative control for the carve-out scope: the quality knob in the very
    // same live statement is still eligible for the soft drop.
    assert_eq!(
        initial_control_disposition(&startup_state, "reasoning_effort", "max"),
        InitialControlDisposition::Drop,
    );
}

fn reasoning_effort_option() -> acp::schema::SessionConfigOption {
    acp::schema::SessionConfigOption::select(
        "reasoning_effort",
        "Reasoning effort",
        "xhigh",
        vec![
            acp::schema::SessionConfigSelectOption::new("low", "Low"),
            acp::schema::SessionConfigSelectOption::new("xhigh", "Xhigh"),
        ],
    )
}

fn approval_policy_option() -> acp::schema::SessionConfigOption {
    acp::schema::SessionConfigOption::select(
        "approval_policy",
        "Approval policy",
        "on-request",
        vec![
            acp::schema::SessionConfigSelectOption::new("on-request", "On request"),
            acp::schema::SessionConfigSelectOption::new("on-failure", "On failure"),
        ],
    )
}

fn collaboration_mode_option() -> acp::schema::SessionConfigOption {
    acp::schema::SessionConfigOption::select(
        "collaboration_mode",
        "Collaboration",
        "chat",
        vec![acp::schema::SessionConfigSelectOption::new("chat", "Chat")],
    )
}

fn seam_startup_state() -> SessionStartupState {
    SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![approval_policy_option(), reasoning_effort_option()],
        current_model_id: Some("gpt-5.5".to_string()),
        available_models: session_model_options(&["gpt-5.5"]),
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    }
}

fn seam_intent(config_id: &str, value: &str) -> ResolvedLaunchIntent {
    ResolvedLaunchIntent {
        model_id: None,
        control_values: [(config_id.to_string(), value.to_string())]
            .into_iter()
            .collect(),
        created_at: "2026-08-19T00:00:00Z".to_string(),
    }
}

/// Seam coverage for `apply_resolved_launch_intent` itself. Every case here is
/// decided by the pre-wire membership check, so the fake connection is never
/// asked to answer a request.
#[tokio::test(flavor = "current_thread")]
async fn launch_intent_seam_drops_only_quality_controls() {
    tokio::task::LocalSet::new()
        .run_until(async {
            let fake = super::config_direct_setter::fake_connection(
                serde_json::json!({ "ok": true }),
            )
            .await;

            // Harnesses narrow the control SET per model, not just a control's
            // value set: claude surfaces `fast` only under opus and drops
            // `effort` under haiku, while the create-time observation is
            // harness-level and carries the union. A QUALITY control the
            // applied model never surfaced therefore launches without it
            // rather than failing the start, exactly like an unoffered
            // quality VALUE below.
            let mut startup_state = seam_startup_state();
            apply_resolved_launch_intent(
                &fake.conn,
                "native-1",
                "session-1",
                "codex",
                &seam_intent("web_search", "on"),
                &mut startup_state,
            )
            .await
            .expect("a never-surfaced quality control must be dropped, not fatal");

            // A POSTURE control the live statement never surfaced still
            // refuses: launching at the harness default after the user
            // explicitly selected a collaboration mode is a silent behavior
            // change, which is worse than refusing the start.
            let mut startup_state = seam_startup_state();
            let error = apply_resolved_launch_intent(
                &fake.conn,
                "native-1",
                "session-1",
                "codex",
                &seam_intent("collaboration_mode", "chat"),
                &mut startup_state,
            )
            .await
            .expect_err("a never-surfaced posture control must refuse the start");
            assert!(
                error.to_string().contains("collaboration_mode"),
                "unexpected error: {error}"
            );

            // A posture control whose value the live statement does not offer
            // stays fatal rather than launching at the harness default.
            let mut startup_state = seam_startup_state();
            let error = apply_resolved_launch_intent(
                &fake.conn,
                "native-1",
                "session-1",
                "codex",
                &seam_intent("approval_policy", "never"),
                &mut startup_state,
            )
            .await
            .expect_err("an unoffered posture value must refuse the start");
            assert!(
                error.to_string().contains("approval_policy"),
                "unexpected error: {error}"
            );

            // Negative control for both branches above: the same seam, same
            // live statement, with a quality control whose requested value the
            // applied model no longer offers, starts cleanly on the default.
            let mut startup_state = seam_startup_state();
            apply_resolved_launch_intent(
                &fake.conn,
                "native-1",
                "session-1",
                "codex",
                &seam_intent("reasoning_effort", "max"),
                &mut startup_state,
            )
            .await
            .expect("an unoffered quality value must be dropped, not fatal");
        })
        .await;
}

/// Regression for the live claude symptom: the harness narrows its control SET
/// per model. Under `opus` the live statement carries `mode`, `effort` and
/// `fast`; under `sonnet` it carries only `mode` and `effort`, and under
/// `haiku` only `mode`. The launch observation is harness-level, so it carries
/// the union — including the harness default `fast: off` that a user who never
/// touched the control still launches with. Refusing the absent id failed the
/// start of every non-opus claude session with
/// `requested controls are absent from the live claude session: ["fast"]`.
#[tokio::test(flavor = "current_thread")]
async fn claude_model_narrowed_control_set_launches_without_the_absent_control() {
    tokio::task::LocalSet::new()
        .run_until(async {
            let fake = super::config_direct_setter::fake_connection(
                serde_json::json!({ "ok": true }),
            )
            .await;

            // The live statement a `sonnet` claude session publishes: no `fast`.
            let mut startup_state = SessionStartupState {
                current_mode_id: None,
                legacy_mode_state: None,
                config_options: vec![
                    acp::schema::SessionConfigOption::select(
                        "mode",
                        "Mode",
                        "default",
                        vec![acp::schema::SessionConfigSelectOption::new(
                            "default", "Default",
                        )],
                    ),
                    acp::schema::SessionConfigOption::select(
                        "effort",
                        "Effort",
                        "high",
                        vec![acp::schema::SessionConfigSelectOption::new("high", "High")],
                    ),
                ],
                current_model_id: Some("sonnet".to_string()),
                available_models: session_model_options(&["sonnet"]),
                prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
            };

            let intent = ResolvedLaunchIntent {
                model_id: None,
                control_values: [
                    ("mode".to_string(), "default".to_string()),
                    ("effort".to_string(), "high".to_string()),
                    ("fast".to_string(), "off".to_string()),
                ]
                .into_iter()
                .collect(),
                created_at: "2026-08-21T00:00:00Z".to_string(),
            };

            apply_resolved_launch_intent(
                &fake.conn,
                "native-1",
                "session-1",
                "claude",
                &intent,
                &mut startup_state,
            )
            .await
            .expect("a control the applied model does not surface must not fail the start");
        })
        .await;
}
