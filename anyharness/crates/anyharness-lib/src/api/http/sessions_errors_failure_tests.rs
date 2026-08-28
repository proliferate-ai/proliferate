use axum::http::StatusCode;
use axum::response::IntoResponse;

use super::{
    map_create_session_error, map_ensure_live_session_error, map_send_prompt_error, ApiError,
};
use crate::domains::sessions::mcp_bindings::workspace_attachment::{
    WorkspaceMcpAttachmentError, WORKSPACE_MCP_ATTACHMENT_CODE, WORKSPACE_MCP_ATTACHMENT_DETAIL,
};
use crate::domains::sessions::model::{AgentStartupExitError, RequestedModeApplyError};
use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, EnsureLiveSessionError, SendPromptError,
};
use crate::domains::workspaces::checkpoints::capture::CheckpointCaptureFailure;

fn workspace_attachment_error() -> WorkspaceMcpAttachmentError {
    WorkspaceMcpAttachmentError::summary_cleanup(anyhow::anyhow!(
        "private selector or token detail"
    ))
}

fn assert_workspace_attachment_problem(error: ApiError) {
    assert_eq!(error.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error.code(), Some(WORKSPACE_MCP_ATTACHMENT_CODE));
    assert_eq!(error.detail(), Some(WORKSPACE_MCP_ATTACHMENT_DETAIL));
    let instance = error.instance().expect("incident receipt");
    let incident_id = instance
        .strip_prefix("urn:proliferate:anyharness:incident:")
        .expect("AnyHarness incident URN");
    assert_eq!(
        uuid::Uuid::parse_str(incident_id)
            .expect("valid UUID receipt")
            .get_version_num(),
        4
    );
    assert!(!error
        .detail()
        .is_some_and(|detail| detail.contains("private selector or token detail")));
}

#[test]
fn workspace_attachment_failure_is_exact_across_create_resume_and_prompt() {
    assert_workspace_attachment_problem(map_create_session_error(
        CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(workspace_attachment_error()),
    ));
    assert_workspace_attachment_problem(map_ensure_live_session_error(
        EnsureLiveSessionError::WorkspaceMcpAttachmentFailed(workspace_attachment_error()),
    ));
    assert_workspace_attachment_problem(map_send_prompt_error(
        SendPromptError::WorkspaceMcpAttachmentFailed(workspace_attachment_error()),
    ));
}

#[test]
fn product_context_failure_is_an_exact_retryable_incident() {
    let incident_id = uuid::Uuid::new_v4().to_string();
    let mapped = map_send_prompt_error(SendPromptError::ProductContextUnavailable {
        incident_id: incident_id.clone(),
        error: crate::live::sessions::product_context::AgentProductContextResolutionError::new(
            anyhow::anyhow!("private store detail"),
        ),
    });

    assert_eq!(mapped.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        mapped.code(),
        Some(crate::domains::sessions::prompt::AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE)
    );
    assert_eq!(
        mapped.detail(),
        Some(crate::domains::sessions::prompt::AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL)
    );
    assert_eq!(
        mapped.instance(),
        Some(format!("urn:proliferate:anyharness:incident:{incident_id}").as_str())
    );
    assert!(!mapped
        .detail()
        .is_some_and(|detail| detail.contains("private store detail")));
}

#[test]
fn checkpoint_capture_failures_are_typed_without_raw_diagnostics() {
    let cases = [
        (
            CheckpointCaptureFailure::WorkspaceNotFound,
            "WORKSPACE_NOT_FOUND",
            "Workspace not found.",
        ),
        (
            CheckpointCaptureFailure::CheckoutMissing,
            "WORKSPACE_DIRECTORY_MISSING",
            "Workspace directory is missing.",
        ),
        (
            CheckpointCaptureFailure::GitLocked,
            "WORKSPACE_GIT_LOCKED",
            "Git is locked by index.lock.",
        ),
        (
            CheckpointCaptureFailure::GitOperationInProgress,
            "WORKSPACE_GIT_OPERATION_IN_PROGRESS",
            "A Git operation is in progress.",
        ),
        (
            CheckpointCaptureFailure::HollowCheckout,
            "WORKSPACE_HOLLOW_CHECKOUT",
            "The workspace directory is not the root of its Git repository.",
        ),
        (
            CheckpointCaptureFailure::UnbornHead,
            "WORKSPACE_UNBORN_HEAD",
            "The branch has no commits yet.",
        ),
        (
            CheckpointCaptureFailure::RefsVerifyFailed,
            "CHECKPOINT_CAPTURE_FAILED",
            "Could not capture a checkpoint before the turn.",
        ),
        (
            CheckpointCaptureFailure::Internal,
            "CHECKPOINT_CAPTURE_FAILED",
            "Could not capture a checkpoint before the turn.",
        ),
    ];
    for (failure, code, detail) in cases {
        let mapped = map_send_prompt_error(SendPromptError::CheckpointCaptureFailed { failure });
        assert_eq!(mapped.status(), StatusCode::CONFLICT);
        assert_eq!(mapped.code(), Some(code));
        assert_eq!(mapped.detail(), Some(detail));
        assert!(!mapped.detail().is_some_and(|value| {
            value.contains("/private/worktree") || value.contains("permission denied")
        }));
    }
}

#[test]
fn unconfirmed_requested_mode_maps_to_typed_bad_request() {
    let mapped = map_create_session_error(CreateAndStartSessionError::StartFailed(
        anyhow::Error::new(RequestedModeApplyError::new("claude", "bypassPermissions")),
    ));

    assert_eq!(mapped.code(), Some("SESSION_MODE_UNSUPPORTED"));
    assert_eq!(
        mapped.detail(),
        Some("mode 'bypassPermissions' is not supported by the active session for agent 'claude'")
    );
    assert_eq!(mapped.into_response().status(), StatusCode::BAD_REQUEST);
}

#[test]
fn startup_stderr_detail_reaches_caller_through_safe_typed_error() {
    let error = AgentStartupExitError::new(
        "agent process exited during ACP startup (exit status: 1)".to_string(),
        "agent process exited during ACP startup (exit status: 1). Agent stderr:\nmissing binary"
            .to_string(),
    );

    let mapped = map_create_session_error(CreateAndStartSessionError::StartFailed(
        anyhow::Error::new(error),
    ));

    assert_eq!(
        mapped.detail(),
        Some(
            "ACP session start failed: agent process exited during ACP startup (exit status: 1). Agent stderr:\nmissing binary"
        )
    );
    assert_eq!(mapped.code(), Some("AGENT_STARTUP_FAILED"));
}

#[test]
fn resume_startup_stderr_detail_reaches_caller_through_safe_typed_error() {
    let error = AgentStartupExitError::new(
        "agent process exited during ACP startup (exit status: 1)".to_string(),
        "agent process exited during ACP startup (exit status: 1). Agent stderr:\nmissing binary"
            .to_string(),
    );

    let mapped =
        map_ensure_live_session_error(EnsureLiveSessionError::Internal(anyhow::Error::new(error)));

    assert_eq!(
        mapped.detail(),
        Some(
            "resume failed: agent process exited during ACP startup (exit status: 1). Agent stderr:\nmissing binary"
        )
    );
    assert_eq!(mapped.code(), Some("AGENT_STARTUP_FAILED"));
}

/// An unsatisfiable agent-auth selection must reach the client as a typed
/// **409 naming the auth failure**, not the generic 400 "session create
/// failed" the readiness gate would produce. The distinction is the whole
/// point: 400 SESSION_CREATE_FAILED reads as "fix your request", while this
/// says "the route you selected is dead" — and only that lets the UI send the
/// user to the auth pane instead of to an install button.
#[test]
fn an_unsatisfiable_selection_maps_to_a_typed_conflict() {
    use crate::domains::agents::route_auth::RouteAuthError;

    let mapped = map_create_session_error(CreateAndStartSessionError::RouteAuth(
        RouteAuthError::SelectionMissing {
            harness_kind: "claude".to_string(),
            sequence: 42,
            reason: None,
        },
    ));

    assert_eq!(mapped.status(), StatusCode::CONFLICT);
    assert_eq!(mapped.code(), Some("AGENT_ROUTE_SELECTION_MISSING"));
    assert_eq!(mapped.into_response().status(), StatusCode::CONFLICT);
}

/// The refusal family reaches the wire as the `LaunchRefusal` vocabulary:
/// the ProblemDetails detail IS `copy()` and the code IS `code()` — the
/// words a human sees are produced once, never re-derived per mapper.
#[test]
fn refusal_family_renders_the_launch_refusal_vocabulary() {
    use crate::domains::agents::route_auth::{LaunchRefusal, RouteAuthError};

    let reset = chrono::Utc::now().timestamp() + 3_600;
    let errors = [
        RouteAuthError::SelectionMissing {
            harness_kind: "claude".to_string(),
            sequence: 42,
            reason: Some("the credits behind it ran out".to_string()),
        },
        RouteAuthError::SeatCooling {
            harness_kind: "claude".to_string(),
            seat_id: "seat-a".to_string(),
            reset_at_epoch_s: reset,
        },
        RouteAuthError::AllSeatsCooling {
            harness_kind: "claude".to_string(),
            earliest_reset_epoch_s: reset,
        },
    ];
    for error in &errors {
        let refusal = LaunchRefusal::from_route_auth_error(error).expect("refusal family");
        let mapped = super::map_route_auth_error(error);
        assert_eq!(mapped.status(), StatusCode::CONFLICT, "{error:?}");
        assert_eq!(mapped.detail(), Some(refusal.copy().as_str()), "{error:?}");
        assert_eq!(mapped.code(), Some(refusal.code()), "{error:?}");
    }
    // No bare variant name or code leaks into the human sentence.
    let mapped = super::map_route_auth_error(&errors[0]);
    let detail = mapped.detail().expect("detail");
    assert!(!detail.contains("AGENT_ROUTE"), "{detail}");
    assert!(!detail.contains("SelectionMissing"), "{detail}");
}
