use crate::domains::sessions::mcp_bindings::assembly::SessionMcpLaunchAssemblyError;
use crate::domains::sessions::mcp_bindings::crypto::SessionMcpBindingsError;
use crate::domains::sessions::mcp_bindings::summaries::SessionMcpSummaryError;

use super::{CreateAndStartSessionError, StartSessionError};

pub(super) fn map_start_session_error_to_anyhow(error: StartSessionError) -> anyhow::Error {
    match error {
        StartSessionError::WorkspaceNotFound => anyhow::anyhow!("workspace not found for session"),
        StartSessionError::WorkspaceDirectoryMissing { path } => {
            anyhow::anyhow!("workspace directory is missing: {path}")
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            anyhow::anyhow!("agent descriptor not found: {agent_kind}")
        }
        StartSessionError::Closed => anyhow::anyhow!("session is closed"),
        StartSessionError::MissingDataKey => {
            anyhow::anyhow!("{}", SessionMcpBindingsError::missing_data_key_detail())
        }
        StartSessionError::RestartRequired(detail) => anyhow::anyhow!(detail),
        StartSessionError::WorkspaceMcpAttachmentFailed(error) => anyhow::Error::new(error),
        StartSessionError::RouteAuth(error) => anyhow::Error::new(error),
        StartSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => match detail {
            Some(detail) => {
                anyhow::anyhow!("agent '{agent_kind}' is not ready (status: {status:?}): {detail}")
            }
            None => anyhow::anyhow!("agent '{agent_kind}' is not ready (status: {status:?})"),
        },
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => error,
    }
}

pub(super) fn map_encrypt_bindings_error_to_start(
    error: SessionMcpBindingsError,
) -> StartSessionError {
    match error {
        SessionMcpBindingsError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpBindingsError::Encrypt(error) | SessionMcpBindingsError::Decrypt(error) => {
            StartSessionError::Internal(error)
        }
    }
}

pub(super) fn map_mcp_summary_error_to_start(error: SessionMcpSummaryError) -> StartSessionError {
    match error {
        SessionMcpSummaryError::Invalid(detail) => {
            StartSessionError::Internal(anyhow::anyhow!(detail))
        }
        SessionMcpSummaryError::Serialize(error) => StartSessionError::Internal(error),
    }
}

pub(super) fn map_mcp_launch_assembly_error_to_start(
    error: SessionMcpLaunchAssemblyError,
) -> StartSessionError {
    match error {
        SessionMcpLaunchAssemblyError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpLaunchAssemblyError::RestartRequired(detail) => {
            StartSessionError::RestartRequired(detail)
        }
        SessionMcpLaunchAssemblyError::WorkspaceAttachment(error) => {
            StartSessionError::WorkspaceMcpAttachmentFailed(error)
        }
        SessionMcpLaunchAssemblyError::Internal(error) => StartSessionError::Internal(error),
    }
}

pub(super) fn map_start_session_error_to_create(
    error: StartSessionError,
) -> CreateAndStartSessionError {
    match error {
        StartSessionError::WorkspaceNotFound => CreateAndStartSessionError::WorkspaceNotFound,
        StartSessionError::WorkspaceDirectoryMissing { path } => {
            CreateAndStartSessionError::WorkspaceDirectoryMissing { path }
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!(
                "agent descriptor not found: {agent_kind}"
            ))
        }
        StartSessionError::Closed => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!("session is closed"))
        }
        StartSessionError::MissingDataKey => CreateAndStartSessionError::MissingDataKey,
        StartSessionError::RestartRequired(detail) => {
            CreateAndStartSessionError::Internal(anyhow::anyhow!(detail))
        }
        StartSessionError::WorkspaceMcpAttachmentFailed(error) => {
            CreateAndStartSessionError::WorkspaceMcpAttachmentFailed(error)
        }
        StartSessionError::RouteAuth(error) => CreateAndStartSessionError::RouteAuth(error),
        // create_session already gates readiness before this seam runs. Keep
        // this exhaustive arm aligned with that create-time Invalid refusal.
        StartSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => match detail {
            Some(detail) => CreateAndStartSessionError::Invalid(format!(
                "agent '{agent_kind}' is not ready (status: {status:?}): {detail}"
            )),
            None => CreateAndStartSessionError::Invalid(format!(
                "agent '{agent_kind}' is not ready (status: {status:?})"
            )),
        },
        StartSessionError::Internal(error) => CreateAndStartSessionError::Internal(error),
        StartSessionError::AcpStart(error) => CreateAndStartSessionError::StartFailed(error),
    }
}
