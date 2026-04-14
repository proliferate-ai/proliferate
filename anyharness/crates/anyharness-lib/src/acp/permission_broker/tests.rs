use super::*;
use crate::acp::mcp_elicitation::{
    normalize_codex_mcp_elicitation, CodexMcpElicitationExtParams, CodexMcpElicitationExtRequest,
};
use anyharness_contract::v1::{UserInputQuestionOption, UserInputSubmittedAnswer};
use serde_json::json;

fn option(id: &str, kind: acp::PermissionOptionKind) -> acp::PermissionOption {
    acp::PermissionOption::new(id.to_string(), id.to_string(), kind)
}

fn question(id: &str, is_other: bool, labels: &[&str]) -> UserInputQuestion {
    UserInputQuestion {
        question_id: id.to_string(),
        header: "Header".to_string(),
        question: "Question?".to_string(),
        is_other,
        is_secret: false,
        options: labels
            .iter()
            .map(|label| UserInputQuestionOption {
                label: (*label).to_string(),
                description: String::new(),
            })
            .collect(),
    }
}

fn answer(
    question_id: &str,
    selected_option_label: Option<&str>,
    text: Option<&str>,
) -> UserInputSubmittedAnswer {
    UserInputSubmittedAnswer {
        question_id: question_id.to_string(),
        selected_option_label: selected_option_label.map(str::to_string),
        text: text.map(str::to_string),
    }
}

fn mcp_elicitation() -> StoredMcpElicitation {
    normalize_codex_mcp_elicitation(CodexMcpElicitationExtParams {
        server_name: "google".to_string(),
        request: CodexMcpElicitationExtRequest::Form {
            meta: None,
            message: "Pick account".to_string(),
            requested_schema: json!({
                "type": "object",
                "properties": {
                    "account": {
                        "type": "string",
                        "title": "Account",
                        "enum": ["acct_123"],
                        "enumNames": ["Work"]
                    }
                },
                "required": ["account"],
                "additionalProperties": false
            }),
        },
    })
    .expect("schema should normalize")
    .pending
}

#[tokio::test]
async fn registered_permission_can_be_resolved_before_wait_starts() {
    let broker = InteractionBroker::new();
    let session_id = "session-1";
    let request_id = "req-0";
    let options = vec![option("allow-once", acp::PermissionOptionKind::AllowOnce)];

    let wait = broker
        .register_permission(session_id, request_id, &options)
        .await;

    assert_eq!(
        broker
            .resolve_with_option_id(session_id, request_id, "allow-once")
            .await
            .expect("resolve"),
        PermissionOutcome::Selected {
            option_id: "allow-once".to_string(),
        }
    );
    assert_eq!(
        wait.wait().await,
        PermissionOutcome::Selected {
            option_id: "allow-once".to_string(),
        }
    );
}

#[tokio::test]
async fn decision_resolution_preserves_existing_option_preference() {
    let broker = InteractionBroker::new();
    broker
        .insert_pending_for_test(
            "session-1",
            "req-1",
            vec![
                option("allow-always", acp::PermissionOptionKind::AllowAlways),
                option("allow-once", acp::PermissionOptionKind::AllowOnce),
            ],
        )
        .await;

    assert_eq!(
        broker
            .resolve_with_decision("session-1", "req-1", PermissionDecision::Allow)
            .await
            .expect("resolve"),
        PermissionOutcome::Selected {
            option_id: "allow-once".to_string(),
        }
    );
}

#[tokio::test]
async fn pending_requests_are_scoped_by_session() {
    let broker = InteractionBroker::new();
    let request_id = "req-shared";
    let options = vec![option("allow-once", acp::PermissionOptionKind::AllowOnce)];

    let wait_a = broker
        .register_permission("session-a", request_id, &options)
        .await;
    let wait_b = broker
        .register_permission("session-b", request_id, &options)
        .await;

    assert_eq!(
        broker
            .cancel("session-b", request_id, InteractionCancelOutcome::Cancelled)
            .await
            .expect("cancel"),
        InteractionBrokerOutcome::Permission(PermissionOutcome::Cancelled)
    );
    assert_eq!(wait_b.wait().await, PermissionOutcome::Cancelled);

    assert_eq!(
        broker
            .resolve_with_option_id("session-a", request_id, "allow-once")
            .await
            .expect("resolve"),
        PermissionOutcome::Selected {
            option_id: "allow-once".to_string(),
        }
    );
    assert_eq!(
        wait_a.wait().await,
        PermissionOutcome::Selected {
            option_id: "allow-once".to_string(),
        }
    );
}

#[tokio::test]
async fn user_input_submit_validates_all_question_ids_and_options() {
    let broker = InteractionBroker::new();
    let wait = broker
        .register_user_input(
            "session-1",
            "req-1",
            &[
                question("q1", false, &["Yes", "No"]),
                question("q2", true, &[]),
            ],
        )
        .await;

    let outcome = broker
        .submit_user_input(
            "session-1",
            "req-1",
            vec![
                answer("q1", Some("Yes"), None),
                answer("q2", Some(USER_INPUT_OTHER_OPTION_LABEL), Some("custom")),
            ],
        )
        .await
        .expect("submit");

    assert_eq!(
        outcome,
        UserInputOutcome::Submitted {
            answered_question_ids: vec!["q1".to_string(), "q2".to_string()],
            answers: vec![
                answer("q1", Some("Yes"), None),
                answer("q2", Some(USER_INPUT_OTHER_OPTION_LABEL), Some("custom")),
            ],
        }
    );
    assert_eq!(wait.wait().await, outcome);
}

#[tokio::test]
async fn user_input_submit_rejects_missing_duplicate_unknown_and_invalid_options() {
    let broker = InteractionBroker::new();
    broker
        .register_user_input(
            "session-1",
            "missing",
            &[question("q1", false, &["Yes"]), question("q2", false, &[])],
        )
        .await;
    assert_eq!(
        broker
            .submit_user_input("session-1", "missing", vec![answer("q1", None, None)])
            .await,
        Err(ResolveInteractionError::MissingQuestionAnswer)
    );

    broker
        .register_user_input("session-1", "duplicate", &[question("q1", false, &[])])
        .await;
    assert_eq!(
        broker
            .submit_user_input(
                "session-1",
                "duplicate",
                vec![answer("q1", None, None), answer("q1", None, None)],
            )
            .await,
        Err(ResolveInteractionError::DuplicateQuestionAnswer)
    );

    broker
        .register_user_input("session-1", "unknown", &[question("q1", false, &[])])
        .await;
    assert_eq!(
        broker
            .submit_user_input("session-1", "unknown", vec![answer("q2", None, None)])
            .await,
        Err(ResolveInteractionError::InvalidQuestionId)
    );

    broker
        .register_user_input(
            "session-1",
            "invalid-option",
            &[question("q1", false, &["A"])],
        )
        .await;
    assert_eq!(
        broker
            .submit_user_input(
                "session-1",
                "invalid-option",
                vec![answer("q1", Some("B"), None)],
            )
            .await,
        Err(ResolveInteractionError::InvalidSelectedOptionLabel)
    );
}

#[tokio::test]
async fn cancel_session_cancels_all_interaction_kinds() {
    let broker = InteractionBroker::new();
    let options = vec![option("allow-once", acp::PermissionOptionKind::AllowOnce)];
    let permission_wait = broker
        .register_permission("session-1", "perm", &options)
        .await;
    let user_input_wait = broker
        .register_user_input("session-1", "input", &[question("q1", false, &[])])
        .await;
    let mcp_wait = broker
        .register_mcp_elicitation("session-1", "mcp", mcp_elicitation())
        .await;

    let mut cancelled = broker
        .cancel_session("session-1", InteractionCancelOutcome::Dismissed)
        .await;
    cancelled.sort_by(|a, b| a.request_id.cmp(&b.request_id));

    assert_eq!(
        cancelled,
        vec![
            CancelledInteraction {
                request_id: "input".to_string(),
                outcome: InteractionBrokerOutcome::UserInput(UserInputOutcome::Dismissed),
            },
            CancelledInteraction {
                request_id: "mcp".to_string(),
                outcome: InteractionBrokerOutcome::McpElicitation(McpElicitationOutcome::Dismissed),
            },
            CancelledInteraction {
                request_id: "perm".to_string(),
                outcome: InteractionBrokerOutcome::Permission(PermissionOutcome::Dismissed),
            },
        ]
    );
    assert_eq!(permission_wait.wait().await, PermissionOutcome::Dismissed);
    assert_eq!(user_input_wait.wait().await, UserInputOutcome::Dismissed);
    assert_eq!(mcp_wait.wait().await, McpElicitationOutcome::Dismissed);
}

#[test]
fn user_input_outcome_debug_redacts_answer_values() {
    let outcome = UserInputOutcome::Submitted {
        answered_question_ids: vec!["secret".to_string()],
        answers: vec![answer(
            "secret",
            Some("do-not-log-option"),
            Some("do-not-log-text"),
        )],
    };

    let formatted = format!("{outcome:?}");
    assert!(!formatted.contains("do-not-log-option"));
    assert!(!formatted.contains("do-not-log-text"));
    assert!(formatted.contains("answer_count"));
}
