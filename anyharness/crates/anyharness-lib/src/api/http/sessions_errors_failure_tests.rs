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
