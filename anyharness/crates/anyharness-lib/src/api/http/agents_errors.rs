//! The one place HTTP learns agent failures: From<AgentRuntimeError> for
//! ApiError. Wire titles/codes/statuses preserved exactly from the retired
//! ProblemResponse mechanism.

use axum::http::StatusCode;

use super::error::ApiError;
use crate::domains::agents::auth::login::AgentLoginError;
use crate::domains::agents::installer::InstallError;
use crate::domains::agents::runtime::AgentRuntimeError;

impl From<AgentRuntimeError> for ApiError {
    fn from(error: AgentRuntimeError) -> Self {
        match error {
            AgentRuntimeError::NotFound(kind) => ApiError::new(
                StatusCode::NOT_FOUND,
                "Agent not found",
                Some(format!("No built-in agent with kind: {kind}")),
                Some("AGENT_NOT_FOUND"),
            ),
            AgentRuntimeError::Login(AgentLoginError::NotSupported(kind)) => ApiError::new(
                StatusCode::BAD_REQUEST,
                "Login not supported",
                Some(format!("Agent {kind} does not support native login")),
                Some("LOGIN_NOT_SUPPORTED"),
            ),
            AgentRuntimeError::Login(AgentLoginError::CommandNotFound(kind)) => ApiError::new(
                StatusCode::CONFLICT,
                "Login command not found",
                Some(format!(
                    "Agent {kind} supports login, but no managed or PATH login command was found."
                )),
                Some("LOGIN_COMMAND_NOT_FOUND"),
            ),
            AgentRuntimeError::LoginTerminalNotFound(error) => ApiError::new(
                StatusCode::NOT_FOUND,
                "Agent login terminal not found",
                Some(error),
                Some("AGENT_LOGIN_TERMINAL_NOT_FOUND"),
            ),
            AgentRuntimeError::LoginTerminalFailed(error) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Login terminal failed",
                Some(error),
                Some("LOGIN_TERMINAL_FAILED"),
            ),
            AgentRuntimeError::InstallTaskFailed(error) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Install failed",
                Some(format!("Agent install task failed: {error}")),
                Some("INSTALL_FAILED"),
            ),
            AgentRuntimeError::Install(error) => install_error_to_api(error),
        }
    }
}

fn install_error_to_api(error: InstallError) -> ApiError {
    let detail = error.to_string();
    let (status, title, code) = match &error {
        InstallError::NotInstallable => (
            StatusCode::BAD_REQUEST,
            "Agent is not installable",
            "AGENT_NOT_INSTALLABLE",
        ),
        InstallError::UnsupportedPlatform => (
            StatusCode::BAD_REQUEST,
            "Unsupported platform for managed install",
            "UNSUPPORTED_PLATFORM",
        ),
        InstallError::InvalidInstallSpec(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Agent install configuration is invalid",
            "AGENT_INSTALL_INVALID_SPEC",
        ),
        InstallError::CommandFailed { .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Agent install failed",
            "AGENT_INSTALL_FAILED",
        ),
        InstallError::MissingManagedArtifact(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Installed artifact missing after install",
            "AGENT_INSTALL_INCOMPLETE",
        ),
        InstallError::FetchFailed { .. } => (
            StatusCode::BAD_GATEWAY,
            "Failed to download agent artifact",
            "AGENT_DOWNLOAD_FAILED",
        ),
        InstallError::RegistryFailed(_) => (
            StatusCode::BAD_GATEWAY,
            "ACP registry lookup failed",
            "AGENT_REGISTRY_FAILED",
        ),
        InstallError::Io(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Agent install failed",
            "AGENT_INSTALL_IO_ERROR",
        ),
    };
    ApiError::new(status, title, Some(detail), Some(code))
}
