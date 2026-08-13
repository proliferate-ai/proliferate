use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::context::WorkspaceMcpContext;
use crate::domains::agent_operations::model::{
    AgentIdentity, AgentPresentationStatus, CreateWorkspaceInput, ListAgentsInput,
    ListWorkspacesInput, WorkspaceIdentity,
};
use crate::domains::agent_operations::runtime::{AgentOperations, AgentOperationsError};
use crate::integrations::mcp::tools::McpToolCallError;

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
