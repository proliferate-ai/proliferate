use super::error::ApiError;
use crate::sessions::mcp_bindings::crypto::SessionMcpBindingsError;
use crate::sessions::runtime::{
    CreateAndStartSessionError, EnsureLiveSessionError, ForkSessionError,
    PendingPromptMutationError, ResolveInteractionError, SendPromptError, SessionLifecycleError,
    SetSessionConfigOptionError,
};
use crate::sessions::service::{GetLiveConfigSnapshotError, UpdateSessionTitleError};

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
        ResolveInteractionError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) fn map_create_session_error(error: CreateAndStartSessionError) -> ApiError {
    match error {
        CreateAndStartSessionError::Invalid(detail) => {
            ApiError::bad_request(detail, "SESSION_CREATE_FAILED")
        }
        CreateAndStartSessionError::ModelUnsupported {
            agent_kind,
            model_id,
        } => ApiError::bad_request(
            format!("model '{model_id}' is not supported for agent '{agent_kind}'"),
            "SESSION_MODEL_UNSUPPORTED",
        ),
        CreateAndStartSessionError::ModeUnsupported {
            agent_kind,
            mode_id,
        } => ApiError::bad_request(
            format!("mode '{mode_id}' is not supported for agent '{agent_kind}'"),
            "SESSION_MODE_UNSUPPORTED",
        ),
        CreateAndStartSessionError::AgentAuthSelectionRequired(required) => {
            ApiError::agent_auth_selection_required(required)
        }
        CreateAndStartSessionError::WorkspaceNotFound => {
            ApiError::bad_request("workspace not found", "WORKSPACE_NOT_FOUND")
        }
        CreateAndStartSessionError::WorkspaceSingleSession { session_id } => ApiError::conflict(
            format!("workspace only allows a single session; existing session: {session_id}"),
            "WORKSPACE_SINGLE_SESSION",
        ),
        CreateAndStartSessionError::MissingDataKey => {
            ApiError::internal(SessionMcpBindingsError::missing_data_key_detail())
        }
        CreateAndStartSessionError::StartFailed(error) => {
            ApiError::internal(format!("ACP session start failed: {error}"))
        }
        CreateAndStartSessionError::Internal(error) => ApiError::internal(error.to_string()),
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
        EnsureLiveSessionError::AgentAuthSelectionRequired(required) => {
            ApiError::agent_auth_selection_required(required)
        }
        EnsureLiveSessionError::Invalid(detail) => {
            ApiError::bad_request(detail, "SESSION_RESUME_FAILED")
        }
        EnsureLiveSessionError::MissingDataKey => {
            ApiError::internal(SessionMcpBindingsError::missing_data_key_detail())
        }
        EnsureLiveSessionError::Internal(error) => {
            ApiError::internal(format!("resume failed: {error}"))
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
        SetSessionConfigOptionError::Internal(error) => ApiError::internal(error.to_string()),
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
        SendPromptError::InvalidPrompt(error) => ApiError::bad_request(error.detail, error.code),
        SendPromptError::Internal(error) => ApiError::internal(error.to_string()),
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
        ForkSessionError::MissingNativeSessionId => ApiError::conflict(
            "session must have a native agent session id before forking",
            "FORK_MISSING_NATIVE_SESSION",
        ),
        ForkSessionError::MissingDataKey => {
            ApiError::internal(SessionMcpBindingsError::missing_data_key_detail())
        }
        ForkSessionError::StartFailed { error, .. } => {
            ApiError::internal(format!("fork child start failed: {error}"))
        }
        ForkSessionError::Internal(error) => ApiError::internal(error.to_string()),
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
        PendingPromptMutationError::InvalidPrompt(error) => {
            ApiError::bad_request(error.detail, error.code)
        }
        PendingPromptMutationError::Internal(error) => ApiError::internal(error.to_string()),
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
