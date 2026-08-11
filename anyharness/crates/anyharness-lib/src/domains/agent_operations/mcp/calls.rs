use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::context::WorkspaceMcpContext;
use crate::domains::agent_operations::model::{
    AgentCreationKind, AgentIdentity, AgentPresentationStatus, ConfigureAgentInput,
    CreateAgentInput, CreateWorkspaceInput, ListAgentsInput, ListWorkspacesInput, SendMessageInput,
    WorkspaceIdentity,
};
use crate::domains::agent_operations::runtime::{AgentOperations, AgentOperationsError};
use crate::domains::sessions::task_output::{
    TaskOutputPage, TaskOutputRole, TaskOutputSender, DEFAULT_TASK_OUTPUT_LIMIT,
};
use crate::integrations::mcp::tools::{McpToolCallError, McpToolOutput};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmptyArgs {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetArgs {
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceArgs {
    workspace_id: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PaginatedArgs {
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateWorkspaceArgs {
    repository_id: String,
    creation_mode: String,
    branch: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateAgentArgs {
    workspace_id: String,
    kind: AgentCreationKind,
    task: Option<String>,
    agent_kind: Option<String>,
    model_id: Option<String>,
    mode_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfigureAgentArgs {
    agent_id: String,
    config_id: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendMessageArgs {
    agent_id: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskOutputArgs {
    agent_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListAgentsArgs {
    workspace_id: Option<String>,
    status: Option<AgentPresentationStatus>,
    cursor: Option<String>,
    limit: Option<usize>,
}

pub async fn call_tool(
    operations: &AgentOperations,
    ctx: &WorkspaceMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match name {
        "whoami" => {
            parse::<EmptyArgs>(arguments)?;
            serialize(operations.whoami(&ctx.caller).await)
        }
        "list_workspaces" => {
            let args = parse::<PaginatedArgs>(arguments)?;
            serialize(
                operations
                    .list_workspaces(
                        &ctx.caller,
                        ListWorkspacesInput {
                            cursor: args.cursor,
                            limit: args.limit.unwrap_or(
                                crate::domains::agent_operations::model::DEFAULT_WORKSPACE_PAGE_SIZE,
                            ),
                        },
                    )
                    .await,
            )
        }
        "list_workspace_options" => {
            parse::<EmptyArgs>(arguments)?;
            serialize(operations.list_workspace_options(&ctx.caller).await)
        }
        "list_agents" => {
            let args = parse::<ListAgentsArgs>(arguments)?;
            serialize(
                operations
                    .list_agents(
                        &ctx.caller,
                        ListAgentsInput {
                            workspace_id: args.workspace_id,
                            status: args.status,
                            cursor: args.cursor,
                            limit: args.limit.unwrap_or(
                                crate::domains::agent_operations::model::DEFAULT_AGENT_PAGE_SIZE,
                            ),
                        },
                    )
                    .await,
            )
        }
        "get_agent" => {
            let args = parse::<TargetArgs>(arguments)?;
            let target = AgentIdentity::new(operations.runtime_identity().clone(), args.agent_id);
            serialize(operations.get_agent(&ctx.caller, &target).await)
        }
        "list_subagents" => {
            parse::<EmptyArgs>(arguments)?;
            serialize(operations.list_subagents(&ctx.caller).await)
        }
        "list_agent_launch_options" => {
            let args = parse::<WorkspaceArgs>(arguments)?;
            let workspace = WorkspaceIdentity {
                runtime_id: operations.runtime_identity().clone(),
                workspace_id: args.workspace_id,
            };
            serialize(
                operations
                    .list_agent_launch_options(&ctx.caller, &workspace)
                    .await,
            )
        }
        "list_agent_config_options" => {
            let args = parse::<TargetArgs>(arguments)?;
            let target = AgentIdentity::new(operations.runtime_identity().clone(), args.agent_id);
            serialize(
                operations
                    .list_agent_config_options(&ctx.caller, &target)
                    .await,
            )
        }
        "create_workspace" => {
            let args = parse::<CreateWorkspaceArgs>(arguments)?;
            serialize(
                operations
                    .create_workspace(
                        &ctx.caller,
                        CreateWorkspaceInput {
                            repository_id: args.repository_id,
                            creation_mode: args.creation_mode,
                            branch: args.branch,
                            display_name: args.display_name,
                        },
                    )
                    .await,
            )
        }
        "create_agent" => {
            let args = parse::<CreateAgentArgs>(arguments)?;
            serialize(
                operations
                    .create_agent(
                        &ctx.caller,
                        CreateAgentInput {
                            workspace: WorkspaceIdentity {
                                runtime_id: operations.runtime_identity().clone(),
                                workspace_id: args.workspace_id,
                            },
                            kind: args.kind,
                            task: args.task,
                            agent_kind: args.agent_kind,
                            model_id: args.model_id,
                            mode_id: args.mode_id,
                        },
                    )
                    .await,
            )
        }
        "configure_agent" => {
            let args = parse::<ConfigureAgentArgs>(arguments)?;
            serialize(
                operations
                    .configure_agent(
                        &ctx.caller,
                        ConfigureAgentInput {
                            target: AgentIdentity::new(
                                operations.runtime_identity().clone(),
                                args.agent_id,
                            ),
                            config_id: args.config_id,
                            value: args.value,
                        },
                    )
                    .await,
            )
        }
        "resume_agent" => {
            let args = parse::<TargetArgs>(arguments)?;
            let target = AgentIdentity::new(operations.runtime_identity().clone(), args.agent_id);
            serialize(operations.resume_agent(&ctx.caller, &target).await)
        }
        "send_message" => {
            let args = parse::<SendMessageArgs>(arguments)?;
            serialize(
                operations
                    .send_message(
                        &ctx.caller,
                        SendMessageInput {
                            target: AgentIdentity::new(
                                operations.runtime_identity().clone(),
                                args.agent_id,
                            ),
                            message: args.message,
                        },
                    )
                    .await,
            )
        }
        "interrupt_agent" => {
            let args = parse::<TargetArgs>(arguments)?;
            let target = AgentIdentity::new(operations.runtime_identity().clone(), args.agent_id);
            serialize(operations.interrupt_agent(&ctx.caller, &target).await)
        }
        "get_task_output" => {
            let args = parse::<TaskOutputArgs>(arguments)?;
            let target = AgentIdentity::new(operations.runtime_identity().clone(), args.agent_id);
            serialize(operations.get_task_output(
                &ctx.caller,
                &target,
                args.cursor.as_deref(),
                args.limit.unwrap_or(DEFAULT_TASK_OUTPUT_LIMIT),
            ))
        }
        declared if super::tools::TOOL_NAMES.contains(&declared) => {
            Err(anyhow::Error::new(McpToolCallError::new(
                "WORKSPACE_MCP_OPERATION_NOT_IMPLEMENTED",
                "This Workspace operation is declared for a later implementation slice.",
            )))
        }
        _ => Err(anyhow::Error::new(McpToolCallError::new(
            "WORKSPACE_MCP_TOOL_NOT_FOUND",
            "Unknown Workspace tool.",
        ))),
    }
}

pub async fn call_tool_output(
    operations: &AgentOperations,
    ctx: &WorkspaceMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<McpToolOutput> {
    if name != "get_task_output" {
        return call_tool(operations, ctx, name, arguments)
            .await
            .map(McpToolOutput::Structured);
    }
    let args = parse::<TaskOutputArgs>(arguments)?;
    let target = AgentIdentity::new(operations.runtime_identity().clone(), args.agent_id);
    let page = operations
        .get_task_output(
            &ctx.caller,
            &target,
            args.cursor.as_deref(),
            args.limit.unwrap_or(DEFAULT_TASK_OUTPUT_LIMIT),
        )
        .map_err(tool_error)?;
    let text = task_output_text(&page);
    let structured_content = serde_json::to_value(page)?;
    Ok(McpToolOutput::Represented {
        structured_content,
        text,
        max_response_bytes: 65_536,
    })
}

fn parse<T: DeserializeOwned>(arguments: Option<Value>) -> anyhow::Result<T> {
    serde_json::from_value(arguments.unwrap_or_else(|| json!({}))).map_err(|_| {
        anyhow::Error::new(McpToolCallError::new(
            "WORKSPACE_MCP_ARGUMENTS_INVALID",
            "Workspace tool arguments are invalid.",
        ))
    })
}

fn serialize<T: serde::Serialize>(
    result: Result<T, AgentOperationsError>,
) -> anyhow::Result<Value> {
    match result {
        Ok(value) => serde_json::to_value(value).map_err(Into::into),
        Err(error) => Err(anyhow::Error::new(McpToolCallError::new(
            error.code(),
            error.public_message(),
        ))),
    }
}

fn tool_error(error: AgentOperationsError) -> anyhow::Error {
    anyhow::Error::new(McpToolCallError::new(error.code(), error.public_message()))
}

fn task_output_text(page: &TaskOutputPage) -> String {
    const MAX_TEXT_BYTES: usize = 1_536;
    let mut text = String::from("Recent visible task output:\n");
    for message in &page.messages {
        let role = match message.role {
            TaskOutputRole::User => "user",
            TaskOutputRole::Assistant => "assistant",
        };
        let sender = match &message.sender {
            TaskOutputSender::User { label }
            | TaskOutputSender::Agent { label, .. }
            | TaskOutputSender::Review { label } => label,
        };
        let visible = message
            .text
            .chars()
            .map(|character| {
                if character.is_control() {
                    ' '
                } else {
                    character
                }
            })
            .collect::<String>();
        text.push_str(&format!("- {role} ({sender}): {visible}\n"));
        if text.len() >= MAX_TEXT_BYTES {
            break;
        }
    }
    if text.len() > MAX_TEXT_BYTES {
        let mut boundary = MAX_TEXT_BYTES;
        while !text.is_char_boundary(boundary) {
            boundary -= 1;
        }
        text.truncate(boundary);
        text.push_str("\n[Text view truncated; use structuredContent.]\n");
    }
    text
}
