use crate::live::terminals::{
    AgentLoginTerminalRecord as LiveAgentLoginTerminalRecord, AgentLoginTerminalService,
    AgentLoginTerminalStatus as LiveAgentLoginTerminalStatus, StartAgentLoginTerminalOptions,
};

use crate::domains::agents::runtime::{AgentLoginStart, AgentRuntime, AgentRuntimeError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentLoginTerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AgentLoginTerminalRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: AgentLoginTerminalStatus,
    pub cwd: String,
    pub command_display: String,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct AgentLoginTerminalStart {
    pub kind: String,
    pub label: String,
    pub message: Option<String>,
    pub terminal: AgentLoginTerminalRecord,
}

pub async fn start_agent_login_terminal_session(
    agent_runtime: &AgentRuntime,
    kind: &str,
    terminal_service: &AgentLoginTerminalService,
) -> Result<AgentLoginTerminalStart, AgentRuntimeError> {
    let AgentLoginStart {
        kind,
        label,
        command,
        cwd,
        env,
        command_display,
        message,
        ..
    } = agent_runtime.start_login_terminal(kind).await?;
    let terminal = terminal_service
        .start_terminal(StartAgentLoginTerminalOptions {
            kind: kind.clone(),
            title: label.clone(),
            program: command.program,
            args: command.args,
            cwd,
            env,
            command_display,
            cols: 120,
            rows: 24,
        })
        .await
        .map_err(|error| AgentRuntimeError::LoginTerminalFailed(error.to_string()))?;

    Ok(AgentLoginTerminalStart {
        kind,
        label,
        message,
        terminal: agent_login_terminal_from_live(terminal),
    })
}

pub async fn get_agent_login_terminal(
    terminal_id: &str,
    terminal_service: &AgentLoginTerminalService,
) -> Result<AgentLoginTerminalRecord, AgentRuntimeError> {
    terminal_service
        .get_terminal(terminal_id)
        .await
        .map(agent_login_terminal_from_live)
        .ok_or_else(|| AgentRuntimeError::LoginTerminalNotFound(terminal_id.to_string()))
}

pub async fn close_agent_login_terminal(
    terminal_id: &str,
    terminal_service: &AgentLoginTerminalService,
) -> Result<(), AgentRuntimeError> {
    terminal_service
        .close_terminal(terminal_id)
        .await
        .map_err(|error| AgentRuntimeError::LoginTerminalNotFound(error.to_string()))
}

fn agent_login_terminal_from_live(
    record: LiveAgentLoginTerminalRecord,
) -> AgentLoginTerminalRecord {
    AgentLoginTerminalRecord {
        id: record.id,
        kind: record.kind,
        title: record.title,
        status: match record.status {
            LiveAgentLoginTerminalStatus::Starting => AgentLoginTerminalStatus::Starting,
            LiveAgentLoginTerminalStatus::Running => AgentLoginTerminalStatus::Running,
            LiveAgentLoginTerminalStatus::Exited => AgentLoginTerminalStatus::Exited,
            LiveAgentLoginTerminalStatus::Failed => AgentLoginTerminalStatus::Failed,
        },
        cwd: record.cwd,
        command_display: record.command_display,
        exit_code: record.exit_code,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}
