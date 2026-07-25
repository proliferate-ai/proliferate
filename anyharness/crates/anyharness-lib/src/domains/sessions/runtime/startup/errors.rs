//! Startup error translation boundaries.

use super::*;

pub(in crate::domains::sessions::runtime) fn map_start_session_error_to_anyhow(
    error: StartSessionError,
) -> anyhow::Error {
    match error {
        StartSessionError::WorkspaceNotFound => anyhow::anyhow!("workspace not found for session"),
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            anyhow::anyhow!("agent descriptor not found: {agent_kind}")
        }
        StartSessionError::Closed => anyhow::anyhow!("session is closed"),
        StartSessionError::MissingDataKey => {
            anyhow::anyhow!("{}", SessionMcpBindingsError::missing_data_key_detail())
        }
        StartSessionError::RestartRequired(detail) => anyhow::anyhow!(detail),
        StartSessionError::RouteAuth(error) => anyhow::Error::new(error),
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => error,
    }
}

pub(in crate::domains::sessions::runtime) fn map_encrypt_bindings_error_to_start(
    error: SessionMcpBindingsError,
) -> StartSessionError {
    match error {
        SessionMcpBindingsError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpBindingsError::Encrypt(error) | SessionMcpBindingsError::Decrypt(error) => {
            StartSessionError::Internal(error)
        }
    }
}

pub(in crate::domains::sessions::runtime) fn map_mcp_summary_error_to_start(
    error: SessionMcpSummaryError,
) -> StartSessionError {
    match error {
        SessionMcpSummaryError::Invalid(detail) => {
            StartSessionError::Internal(anyhow::anyhow!(detail))
        }
        SessionMcpSummaryError::Serialize(error) => StartSessionError::Internal(error),
    }
}

pub(in crate::domains::sessions::runtime) fn map_mcp_launch_assembly_error_to_start(
    error: SessionMcpLaunchAssemblyError,
) -> StartSessionError {
    match error {
        SessionMcpLaunchAssemblyError::MissingDataKey => StartSessionError::MissingDataKey,
        SessionMcpLaunchAssemblyError::RestartRequired(detail) => {
            StartSessionError::RestartRequired(detail)
        }
        SessionMcpLaunchAssemblyError::Internal(error) => StartSessionError::Internal(error),
    }
}

pub(in crate::domains::sessions::runtime) fn map_start_session_error_to_create(
    error: StartSessionError,
) -> CreateAndStartSessionError {
    match error {
        StartSessionError::WorkspaceNotFound => CreateAndStartSessionError::WorkspaceNotFound,
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
        StartSessionError::RouteAuth(error) => CreateAndStartSessionError::RouteAuth(error),
        StartSessionError::Internal(error) => CreateAndStartSessionError::Internal(error),
        StartSessionError::AcpStart(error) => CreateAndStartSessionError::StartFailed(error),
    }
}
