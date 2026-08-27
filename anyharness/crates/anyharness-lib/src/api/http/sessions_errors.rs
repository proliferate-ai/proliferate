use super::access::map_access_error;
use super::error::ApiError;
use crate::domains::agents::route_auth::{LaunchRefusal, RouteAuthError};
use crate::domains::sessions::mcp_bindings::crypto::SessionMcpBindingsError;
use crate::domains::sessions::mcp_bindings::workspace_attachment::{
    WORKSPACE_MCP_ATTACHMENT_CODE, WORKSPACE_MCP_ATTACHMENT_DETAIL,
};
use crate::domains::sessions::model::{AgentStartupExitError, RequestedModeApplyError};
use crate::domains::sessions::prompt::{
    AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE, AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL,
};
use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, EnsureLiveSessionError, ForkSessionError,
    PendingPromptMutationError, PendingPromptQueueError, ResolveInteractionError, SendPromptError,
    SessionLifecycleError, SetSessionConfigOptionError,
};
use crate::domains::sessions::service::{GetLiveConfigSnapshotError, UpdateSessionTitleError};

fn map_internal_anyhow_error(
    error: anyhow::Error,
    telemetry_safe_detail: String,
    caller_prefix: &str,
) -> ApiError {
    let startup_error = error.downcast_ref::<AgentStartupExitError>();
    let caller_detail = startup_error
        .map(|error| format!("{caller_prefix}{}", error.caller_detail()))
        .unwrap_or_else(|| telemetry_safe_detail.clone());

    ApiError::internal_with_safe_log_and_code(
        caller_detail,
        telemetry_safe_detail,
        startup_error.map(|_| AgentStartupExitError::CODE),
    )
}

pub(super) fn map_acp_session_start_error(error: anyhow::Error) -> ApiError {
    if let Some(mode_error) = error.downcast_ref::<RequestedModeApplyError>() {
        return ApiError::bad_request(mode_error.to_string(), RequestedModeApplyError::CODE);
    }

    let telemetry_safe_detail = format!("ACP session start failed: {error}");
    map_internal_anyhow_error(error, telemetry_safe_detail, "ACP session start failed: ")
}

pub(super) fn map_resolve_interaction_error(error: ResolveInteractionError) -> ApiError {
    match error {
        ResolveInteractionError::SessionNotLive(session_id) => {
            ApiError::not_found(format!("No live session: {session_id}"), "SESSION_NOT_LIVE")
        }
        ResolveInteractionError::InteractionNotFound(request_id) => ApiError::not_found(
            format!("No pending interaction request: {request_id}"),
            "INTERACTION_NOT_FOUND",
        ),
        ResolveInteractionError::PlanLinkedInteraction(request_id) => ApiError::conflict(
            format!("Interaction request is linked to a proposed plan: {request_id}"),
            "PLAN_LINKED_INTERACTION",
        ),
        ResolveInteractionError::InteractionKindMismatch(request_id) => ApiError::bad_request(
            format!("Resolution outcome does not match interaction kind: {request_id}"),
            "INTERACTION_KIND_MISMATCH",
        ),
        ResolveInteractionError::InvalidOptionId(request_id) => ApiError::bad_request(
            format!("Invalid option for interaction request: {request_id}"),
            "INTERACTION_OPTION_NOT_FOUND",
        ),
        ResolveInteractionError::InvalidQuestionId(request_id) => ApiError::bad_request(
            format!("Invalid question for interaction request: {request_id}"),
            "INTERACTION_QUESTION_NOT_FOUND",
        ),
        ResolveInteractionError::DuplicateQuestionAnswer(request_id) => ApiError::bad_request(
            format!("Duplicate question answer for interaction request: {request_id}"),
            "INTERACTION_DUPLICATE_QUESTION_ANSWER",
        ),
        ResolveInteractionError::MissingQuestionAnswer(request_id) => ApiError::bad_request(
            format!("Missing question answer for interaction request: {request_id}"),
            "INTERACTION_MISSING_QUESTION_ANSWER",
        ),
        ResolveInteractionError::InvalidSelectedOptionLabel(request_id) => ApiError::bad_request(
            format!("Invalid selected option label for interaction request: {request_id}"),
            "INTERACTION_OPTION_LABEL_NOT_FOUND",
        ),
        ResolveInteractionError::InvalidMcpFieldId(request_id) => ApiError::bad_request(
            format!("Invalid MCP field for interaction request: {request_id}"),
            "INTERACTION_MCP_FIELD_NOT_FOUND",
        ),
        ResolveInteractionError::DuplicateMcpField(request_id) => ApiError::bad_request(
            format!("Duplicate MCP field for interaction request: {request_id}"),
            "INTERACTION_DUPLICATE_MCP_FIELD",
        ),
        ResolveInteractionError::MissingMcpField(request_id) => ApiError::bad_request(
            format!("Missing MCP field for interaction request: {request_id}"),
            "INTERACTION_MISSING_MCP_FIELD",
        ),
        ResolveInteractionError::InvalidMcpFieldValue(request_id) => ApiError::bad_request(
            format!("Invalid MCP field value for interaction request: {request_id}"),
            "INTERACTION_INVALID_MCP_FIELD_VALUE",
        ),
        ResolveInteractionError::NotMcpUrlElicitation(request_id) => ApiError::bad_request(
            format!("Interaction request is not an MCP URL elicitation: {request_id}"),
            "INTERACTION_NOT_MCP_URL_ELICITATION",
        ),
        ResolveInteractionError::Access(error) => map_access_error(error),
        ResolveInteractionError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_create_session_error(error: CreateAndStartSessionError) -> ApiError {
    match error {
        CreateAndStartSessionError::Invalid(detail) => {
            ApiError::bad_request(detail, "SESSION_CREATE_FAILED")
        }
        CreateAndStartSessionError::LaunchOptionsUnavailable {
            agent_kind,
            state,
        } => ApiError::conflict(
            format!("launch options are not available for agent '{agent_kind}' (state: {state:?})"),
            "SESSION_LAUNCH_OPTIONS_UNAVAILABLE",
        ),
        CreateAndStartSessionError::LaunchValueUnsupported {
            agent_kind,
            key,
            value,
            state,
        } => ApiError::bad_request(
            format!("launch value '{value}' for '{key}' is not supported for agent '{agent_kind}' (state: {state:?})"),
            "SESSION_LAUNCH_VALUE_UNSUPPORTED",
        ),
        CreateAndStartSessionError::AgentEnvOverrideUnsupported {
            agent_kind,
            env_var_name,
        } => ApiError::bad_request(
            format!(
                "workspace/session environment cannot override agent-owned key '{env_var_name}' for '{agent_kind}'"
            ),
            "SESSION_AGENT_ENV_OVERRIDE_UNSUPPORTED",
        ),
        CreateAndStartSessionError::WorkspaceNotFound => {
            ApiError::bad_request("workspace not found", "WORKSPACE_NOT_FOUND")
        }
        CreateAndStartSessionError::WorkspaceDirectoryMissing { path } => ApiError::conflict(
            format!("workspace directory is missing: {path}"),
            "WORKSPACE_DIRECTORY_MISSING",
        ),
        CreateAndStartSessionError::WorkspaceSingleSession { session_id } => ApiError::conflict(
            format!("workspace only allows a single session; existing session: {session_id}"),
            "WORKSPACE_SINGLE_SESSION",
        ),
        CreateAndStartSessionError::SessionIdConflict { session_id } => ApiError::conflict(
            format!("session id is already owned by a different create request: {session_id}"),
            "SESSION_ID_CONFLICT",
        ),
        CreateAndStartSessionError::MissingDataKey => {
            ApiError::internal(SessionMcpBindingsError::missing_data_key_detail())
        }
        CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(_) => {
            ApiError::internal_runtime_incident(
                WORKSPACE_MCP_ATTACHMENT_DETAIL,
                WORKSPACE_MCP_ATTACHMENT_CODE,
            )
        }
        CreateAndStartSessionError::RouteAuth(error) => map_route_auth_error(&error),
        CreateAndStartSessionError::StartFailed(error) => map_acp_session_start_error(error),
        CreateAndStartSessionError::Internal(error) => {
            let telemetry_safe_detail = error.to_string();
            map_internal_anyhow_error(error, telemetry_safe_detail, "")
        }
    }
}

/// Typed agent-auth launch refusals, keyed by the stable `AGENT_ROUTE_*` code
/// (see `RouteAuthError::code`). Fail-closed / route-shape problems are 409s
/// (the session request was fine; the launch precondition is not satisfied
/// until a selection changes — or, for the cooling pair, until a seat's
/// usage-limit reset passes); state-file corruption and materialization IO
/// are 500s. EXHAUSTIVE on purpose: a new refusal variant must break compile
/// here rather than fall into a default arm.
///
/// The refusal family — the variants a HUMAN reads — renders through the
/// [`LaunchRefusal`] vocabulary (agent_auth spec §4): detail = `copy()`,
/// code = `code()`, never a bare error string. The single launch-surface
/// seam every HTTP mapper (sessions, cowork, agent-auth state) converges on.
pub(super) fn map_route_auth_error(error: &RouteAuthError) -> ApiError {
    match error {
        RouteAuthError::SelectionMissing { .. }
        | RouteAuthError::SeatCooling { .. }
        | RouteAuthError::AllSeatsCooling { .. } => {
            let refusal = LaunchRefusal::from_route_auth_error(error)
                .expect("refusal-family variants map onto the LaunchRefusal vocabulary");
            ApiError::conflict(refusal.copy(), refusal.code())
        }
        RouteAuthError::SelectionIncomplete { .. }
        | RouteAuthError::UnsupportedRoute { .. }
        | RouteAuthError::UnknownHarness { .. }
        | RouteAuthError::StaleStateSequence { .. } => {
            ApiError::conflict(error.to_string(), error.code())
        }
        RouteAuthError::MalformedStateFile { .. } | RouteAuthError::Materialize { .. } => {
            ApiError::internal(error.to_string())
        }
    }
}

pub(super) fn map_ensure_live_session_error(error: EnsureLiveSessionError) -> ApiError {
    match error {
        EnsureLiveSessionError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        EnsureLiveSessionError::SessionClosed => {
            ApiError::conflict("session is closed", "SESSION_CLOSED")
        }
        EnsureLiveSessionError::RestartRequired(detail) => {
            ApiError::conflict(detail, "SESSION_RESTART_REQUIRED")
        }
        EnsureLiveSessionError::Invalid(detail) => {
            ApiError::bad_request(detail, "SESSION_RESUME_FAILED")
        }
        EnsureLiveSessionError::WorkspaceDirectoryMissing { path } => ApiError::conflict(
            format!("workspace directory is missing: {path}"),
            "WORKSPACE_DIRECTORY_MISSING",
        ),
        EnsureLiveSessionError::MissingDataKey => {
            ApiError::internal(SessionMcpBindingsError::missing_data_key_detail())
        }
        EnsureLiveSessionError::WorkspaceMcpAttachmentFailed(_) => {
            ApiError::internal_runtime_incident(
                WORKSPACE_MCP_ATTACHMENT_DETAIL,
                WORKSPACE_MCP_ATTACHMENT_CODE,
            )
        }
        EnsureLiveSessionError::RouteAuth(error) => map_route_auth_error(&error),
        // A9 Scope C: the live-start readiness gate now runs on resume too
        // (previously only create_session checked it). 409, same family as
        // the AGENT_ROUTE_* codes (RouteAuthError::code, route_auth/mod.rs)
        // — the request is fine, the launch precondition is not satisfied
        // until the agent's readiness changes.
        EnsureLiveSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => ApiError::conflict(
            match detail {
                Some(detail) => {
                    format!("agent '{agent_kind}' is not ready (status: {status:?}): {detail}")
                }
                None => format!("agent '{agent_kind}' is not ready (status: {status:?})"),
            },
            "AGENT_NOT_READY",
        ),
        EnsureLiveSessionError::Internal(error) => {
            let telemetry_safe_detail = format!("resume failed: {error}");
            map_internal_anyhow_error(error, telemetry_safe_detail, "resume failed: ")
        }
    }
}

pub(super) fn map_set_session_config_option_error(error: SetSessionConfigOptionError) -> ApiError {
    match error {
        SetSessionConfigOptionError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        SetSessionConfigOptionError::Rejected(detail) => {
            ApiError::bad_request(detail, "SESSION_CONFIG_REJECTED")
        }
        SetSessionConfigOptionError::WorkspaceDirectoryMissing { path } => ApiError::conflict(
            format!("workspace directory is missing: {path}"),
            "WORKSPACE_DIRECTORY_MISSING",
        ),
        SetSessionConfigOptionError::Internal(error) => {
            let telemetry_safe_detail = error.to_string();
            map_internal_anyhow_error(error, telemetry_safe_detail, "")
        }
    }
}

pub(super) fn map_send_prompt_error(error: SendPromptError) -> ApiError {
    match error {
        SendPromptError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        SendPromptError::SessionClosed => ApiError::conflict("session is closed", "SESSION_CLOSED"),
        SendPromptError::EmptyPrompt => ApiError::bad_request("empty prompt", "EMPTY_PROMPT"),
        SendPromptError::WorkspaceDirectoryMissing { path } => ApiError::conflict(
            format!("workspace directory is missing: {path}"),
            "WORKSPACE_DIRECTORY_MISSING",
        ),
        SendPromptError::InvalidPrompt(error) => ApiError::bad_request(error.detail, error.code),
        SendPromptError::WorkspaceMcpAttachmentFailed(_) => ApiError::internal_runtime_incident(
            WORKSPACE_MCP_ATTACHMENT_DETAIL,
            WORKSPACE_MCP_ATTACHMENT_CODE,
        ),
        SendPromptError::ProductContextUnavailable { incident_id, .. } => {
            ApiError::service_unavailable_runtime_incident(
                AGENT_PRODUCT_CONTEXT_UNAVAILABLE_DETAIL,
                AGENT_PRODUCT_CONTEXT_UNAVAILABLE_CODE,
                &incident_id,
            )
        }
        // Checkpoints (Lane H): a turn-start capture failed under the abort
        // policy, so the turn never started. 409, retryable.
        SendPromptError::CheckpointCaptureFailed { failure } => {
            ApiError::conflict(failure.detail(), failure.code())
        }
        // {error:#} keeps the anyhow cause chain; to_string() would drop it.
        SendPromptError::Internal(error) => {
            let telemetry_safe_detail = format!("{error:#}");
            map_internal_anyhow_error(error, telemetry_safe_detail, "")
        }
    }
}

pub(super) fn map_fork_session_error(error: ForkSessionError) -> ApiError {
    match error {
        ForkSessionError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        ForkSessionError::Unsupported(detail) => ApiError::conflict(detail, "FORK_UNSUPPORTED"),
        ForkSessionError::Busy => {
            ApiError::conflict("session must be idle before forking", "SESSION_BUSY")
        }
        ForkSessionError::Invalid(detail) => ApiError::bad_request(detail, "FORK_INVALID_SESSION"),
        ForkSessionError::InvalidForkTarget(detail) => {
            ApiError::bad_request(detail, "INVALID_FORK_TARGET")
        }
        ForkSessionError::TargetNotFound => ApiError::not_found(
            "fork target message not found in this session",
            "TARGET_NOT_FOUND",
        ),
        ForkSessionError::BoundaryNotCommitted => ApiError::conflict(
            "fork target boundary is not committed yet",
            "BOUNDARY_NOT_COMMITTED",
        ),
        ForkSessionError::IdempotencyConflict => ApiError::conflict(
            "fork idempotency key already used with a different request payload",
            "IDEMPOTENCY_CONFLICT",
        ),
        ForkSessionError::NativeOutcomeUnknown => ApiError::conflict(
            "a prior fork on this key has an unresolved native outcome and cannot be redispatched",
            "FORK_NATIVE_OUTCOME_UNKNOWN",
        ),
        ForkSessionError::WorkspaceDirectoryMissing { path } => ApiError::conflict(
            format!("workspace directory is missing: {path}"),
            "WORKSPACE_DIRECTORY_MISSING",
        ),
        ForkSessionError::MissingNativeSessionId => ApiError::conflict(
            "session must have a native agent session id before forking",
            "FORK_MISSING_NATIVE_SESSION",
        ),
        ForkSessionError::MissingDataKey => {
            ApiError::internal(SessionMcpBindingsError::missing_data_key_detail())
        }
        // A9 Scope C: same readiness gate now backs the fork child's start.
        ForkSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => ApiError::conflict(
            match detail {
                Some(detail) => {
                    format!("agent '{agent_kind}' is not ready (status: {status:?}): {detail}")
                }
                None => format!("agent '{agent_kind}' is not ready (status: {status:?})"),
            },
            "AGENT_NOT_READY",
        ),
        ForkSessionError::StartFailed { error, .. } => {
            let telemetry_safe_detail = format!("fork child start failed: {error}");
            map_internal_anyhow_error(error, telemetry_safe_detail, "fork child start failed: ")
        }
        ForkSessionError::Internal(error) => {
            let telemetry_safe_detail = error.to_string();
            map_internal_anyhow_error(error, telemetry_safe_detail, "")
        }
    }
}

pub(super) fn map_pending_prompt_mutation_error(error: PendingPromptMutationError) -> ApiError {
    match error {
        PendingPromptMutationError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        PendingPromptMutationError::NotFound => {
            ApiError::not_found("Pending prompt not found", "PENDING_PROMPT_NOT_FOUND")
        }
        PendingPromptMutationError::Protected => ApiError::conflict(
            "Canonical completion wake prompts cannot be edited or deleted",
            "PENDING_PROMPT_PROTECTED",
        ),
        PendingPromptMutationError::InvalidPrompt(error) => {
            ApiError::bad_request(error.detail, error.code)
        }
        PendingPromptMutationError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_pending_prompt_queue_error(error: PendingPromptQueueError) -> ApiError {
    match error {
        PendingPromptQueueError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        PendingPromptQueueError::NotFound => {
            ApiError::not_found("Pending prompt not found", "PENDING_PROMPT_NOT_FOUND")
        }
        PendingPromptQueueError::InvalidReorder(detail) => {
            ApiError::bad_request(detail, "INVALID_PENDING_PROMPT_ORDER")
        }
        PendingPromptQueueError::StaleOrder { current_seqs } => ApiError::conflict(
            format!(
                "Pending prompt order changed; current ordered sequence numbers are {current_seqs:?}"
            ),
            "PENDING_PROMPT_ORDER_STALE",
        ),
        PendingPromptQueueError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_get_live_config_snapshot_error(error: GetLiveConfigSnapshotError) -> ApiError {
    match error {
        GetLiveConfigSnapshotError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        GetLiveConfigSnapshotError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_update_session_title_error(error: UpdateSessionTitleError) -> ApiError {
    match error {
        UpdateSessionTitleError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        UpdateSessionTitleError::EmptyTitle => {
            ApiError::bad_request("session title cannot be empty", "SESSION_TITLE_EMPTY")
        }
        UpdateSessionTitleError::TitleTooLong(limit) => ApiError::bad_request(
            format!("session title cannot exceed {limit} characters"),
            "SESSION_TITLE_TOO_LONG",
        ),
        UpdateSessionTitleError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_session_lifecycle_error(error: SessionLifecycleError) -> ApiError {
    match error {
        SessionLifecycleError::SessionNotFound(session_id) => ApiError::not_found(
            format!("Session not found: {session_id}"),
            "SESSION_NOT_FOUND",
        ),
        SessionLifecycleError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

#[cfg(test)]
#[path = "sessions_errors_failure_tests.rs"]
mod failure_tests;

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    use crate::domains::sessions::runtime::{CreateAndStartSessionError, ResolveInteractionError};
    use crate::domains::workspaces::access_gate::WorkspaceAccessError;

    #[test]
    fn pending_prompt_reorder_validation_maps_to_bad_request() {
        use crate::domains::sessions::runtime::PendingPromptQueueError;
        let response = super::map_pending_prompt_queue_error(
            PendingPromptQueueError::InvalidReorder("duplicate sequence".to_string()),
        )
        .into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn stale_pending_prompt_reorder_maps_to_typed_conflict() {
        use crate::domains::sessions::runtime::PendingPromptQueueError;
        let response = super::map_pending_prompt_queue_error(PendingPromptQueueError::StaleOrder {
            current_seqs: vec![2, 1],
        })
        .into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn protected_completion_prompt_maps_to_stable_conflict() {
        use crate::domains::sessions::runtime::PendingPromptMutationError;

        let error = super::map_pending_prompt_mutation_error(PendingPromptMutationError::Protected);
        assert_eq!(error.status(), StatusCode::CONFLICT);
        assert_eq!(error.code(), Some("PENDING_PROMPT_PROTECTED"));
    }

    /// Exact unsupported launch values use the stable typed refusal.
    #[test]
    fn unsupported_model_maps_to_the_exact_launch_value_refusal() {
        let mapped =
            super::map_create_session_error(CreateAndStartSessionError::LaunchValueUnsupported {
                agent_kind: "claude".to_string(),
                key: "model".to_string(),
                value: "opus".to_string(),
                state: crate::domains::agents::launch_options::HarnessLaunchOptionsState::Observed,
            });

        assert_eq!(mapped.status(), StatusCode::BAD_REQUEST);
        assert_eq!(mapped.code(), Some("SESSION_LAUNCH_VALUE_UNSUPPORTED"));
        assert_eq!(mapped.into_response().status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn missing_workspace_directory_maps_to_conflict() {
        let response = super::map_create_session_error(
            CreateAndStartSessionError::WorkspaceDirectoryMissing {
                path: "/tmp/gone".to_string(),
            },
        )
        .into_response();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn resume_missing_workspace_directory_maps_to_conflict_with_code() {
        use crate::domains::sessions::runtime::EnsureLiveSessionError;
        let error = super::map_ensure_live_session_error(
            EnsureLiveSessionError::WorkspaceDirectoryMissing {
                path: "/tmp/gone".to_string(),
            },
        );
        assert_eq!(error.code(), Some("WORKSPACE_DIRECTORY_MISSING"));
        assert_eq!(error.into_response().status(), StatusCode::CONFLICT);
    }

    #[test]
    fn prompt_missing_workspace_directory_maps_to_conflict_with_code() {
        use crate::domains::sessions::runtime::SendPromptError;
        let error = super::map_send_prompt_error(SendPromptError::WorkspaceDirectoryMissing {
            path: "/tmp/gone".to_string(),
        });
        assert_eq!(error.code(), Some("WORKSPACE_DIRECTORY_MISSING"));
        assert_eq!(error.into_response().status(), StatusCode::CONFLICT);
    }

    #[test]
    fn config_missing_workspace_directory_maps_to_conflict_with_code() {
        use crate::domains::sessions::runtime::SetSessionConfigOptionError;
        let error = super::map_set_session_config_option_error(
            SetSessionConfigOptionError::WorkspaceDirectoryMissing {
                path: "/tmp/gone".to_string(),
            },
        );
        assert_eq!(error.code(), Some("WORKSPACE_DIRECTORY_MISSING"));
        assert_eq!(error.into_response().status(), StatusCode::CONFLICT);
    }

    #[test]
    fn fork_missing_workspace_directory_maps_to_conflict_with_code() {
        use crate::domains::sessions::runtime::ForkSessionError;
        let error = super::map_fork_session_error(ForkSessionError::WorkspaceDirectoryMissing {
            path: "/tmp/gone".to_string(),
        });
        assert_eq!(error.code(), Some("WORKSPACE_DIRECTORY_MISSING"));
        assert_eq!(error.into_response().status(), StatusCode::CONFLICT);
    }

    #[test]
    fn interaction_access_store_failures_map_to_internal_error() {
        let response = super::map_resolve_interaction_error(ResolveInteractionError::Access(
            WorkspaceAccessError::Unexpected(anyhow::anyhow!("database unavailable")),
        ))
        .into_response();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
