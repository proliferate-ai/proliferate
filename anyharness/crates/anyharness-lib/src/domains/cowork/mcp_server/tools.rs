use serde_json::{json, Value};

use super::protocol::{
    self, CodingSessionArgs, CodingWorkspaceArgs, CreateArtifactArgs, CreateCodingSessionArgs,
    CreateCodingWorkspaceArgs, DeleteArtifactArgs, GetArtifactArgs, ReadCodingEventsArgs,
    SendCodingMessageArgs, UpdateArtifactArgs,
};
use crate::domains::cowork::artifacts::{
    CoworkArtifactRuntime, CreateCoworkArtifactInput, UpdateCoworkArtifactInput,
};
use crate::domains::cowork::delegation::model::{
    CreateCodingSessionInput, CreateCodingWorkspaceInput, SendCodingMessageInput,
    MAX_CODING_SESSIONS_PER_MANAGED_WORKSPACE, MAX_MANAGED_WORKSPACES_PER_COWORK_SESSION,
};
use crate::domains::cowork::runtime::{default_cowork_coding_mode_for_agent, CoworkRuntime};
use crate::integrations::mcp::json_rpc::{deserialize_args, jsonrpc_error, CallToolParams};
use crate::integrations::mcp::tools::jsonrpc_tool_result;
use crate::sessions::runtime::SendPromptOutcome;
use crate::sessions::service::WorkspaceSessionLaunchCatalogData;
use crate::workspaces::model::WorkspaceRecord;

pub(super) async fn handle_tool_call(
    artifact_runtime: &CoworkArtifactRuntime,
    cowork_runtime: &CoworkRuntime,
    workspace: &WorkspaceRecord,
    parent_session_id: &str,
    workspace_delegation_enabled: bool,
    id: Option<Value>,
    params: CallToolParams,
) -> anyhow::Result<Value> {
    if protocol::is_delegation_tool(&params.name) && !workspace_delegation_enabled {
        return Ok(jsonrpc_tool_result::<Value, _>(
            id,
            Err(anyhow::anyhow!(
                "cowork workspace delegation is disabled for this thread"
            )),
        ));
    }

    match params.name.as_str() {
        "create_artifact" => {
            let args: CreateArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.create_artifact(
                    &workspace,
                    CreateCoworkArtifactInput {
                        path: args.path,
                        content: args.content,
                        title: args.title,
                        description: args.description,
                    },
                )
            })
            .await?;
            Ok(jsonrpc_tool_result(id, artifact))
        }
        "update_artifact" => {
            let args: UpdateArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.update_artifact(
                    &workspace,
                    UpdateCoworkArtifactInput {
                        id: args.id,
                        content: args.content,
                        title: args.title,
                        description: args.description,
                    },
                )
            })
            .await?;
            Ok(jsonrpc_tool_result(id, artifact))
        }
        "delete_artifact" => {
            let args: DeleteArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let result = tokio::task::spawn_blocking(move || {
                artifact_runtime
                    .delete_artifact(&workspace, &args.id)
                    .map(|_| {
                        json!({
                            "id": args.id,
                            "deleted": true,
                        })
                    })
            })
            .await?;
            Ok(jsonrpc_tool_result(id, result))
        }
        "list_artifacts" => {
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let manifest =
                tokio::task::spawn_blocking(move || artifact_runtime.get_manifest(&workspace))
                    .await?;
            Ok(jsonrpc_tool_result(id, manifest))
        }
        "get_artifact" => {
            let args: GetArtifactArgs = deserialize_args(params.arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.get_artifact(&workspace, &args.id)
            })
            .await?;
            Ok(jsonrpc_tool_result(id, artifact))
        }
        name if protocol::is_delegation_tool(name) => Ok(jsonrpc_tool_result(
            id,
            handle_delegation_tool_call(cowork_runtime, parent_session_id, name, params.arguments)
                .await,
        )),
        _ => Ok(jsonrpc_error(
            id,
            -32601,
            format!("unknown tool: {}", params.name),
        )),
    }
}

async fn handle_delegation_tool_call(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    tool_name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match tool_name {
        "get_coding_workspace_launch_options" => {
            get_coding_workspace_launch_options(cowork_runtime, parent_session_id)
        }
        "create_coding_workspace" => {
            let args: CreateCodingWorkspaceArgs = deserialize_args(arguments)?;
            create_coding_workspace(cowork_runtime, parent_session_id, args).await
        }
        "list_coding_workspaces" => list_coding_workspaces(cowork_runtime, parent_session_id).await,
        "get_coding_session_launch_options" => {
            let args: CodingWorkspaceArgs = deserialize_args(arguments)?;
            get_coding_session_launch_options(cowork_runtime, parent_session_id, args)
        }
        "create_coding_session" => {
            let args: CreateCodingSessionArgs = deserialize_args(arguments)?;
            create_coding_session(cowork_runtime, parent_session_id, args).await
        }
        "send_coding_message" => {
            let args: SendCodingMessageArgs = deserialize_args(arguments)?;
            send_coding_message(cowork_runtime, parent_session_id, args).await
        }
        "get_coding_status" => {
            let args: CodingSessionArgs = deserialize_args(arguments)?;
            get_coding_status(cowork_runtime, parent_session_id, args).await
        }
        "schedule_coding_wake" => {
            let args: CodingSessionArgs = deserialize_args(arguments)?;
            schedule_coding_wake(cowork_runtime, parent_session_id, args)
        }
        "read_coding_events" => {
            let args: ReadCodingEventsArgs = deserialize_args(arguments)?;
            read_coding_events(cowork_runtime, parent_session_id, args)
        }
        _ => anyhow::bail!("unknown cowork delegation tool: {tool_name}"),
    }
}

fn get_coding_workspace_launch_options(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
) -> anyhow::Result<Value> {
    let _parent = cowork_runtime
        .session_record(parent_session_id)?
        .ok_or_else(|| anyhow::anyhow!("parent session not found"))?;
    let options = cowork_runtime.list_coding_workspace_launch_options(parent_session_id)?;
    let workspaces = options
        .into_iter()
        .map(|option| {
            let catalog = cowork_runtime.workspace_session_launch_catalog(&option.workspace.id)?;
            let base_branch = cowork_runtime
                .repo_default_branch_for_workspace(&option.workspace)?
                .or(option.workspace.original_branch.clone())
                .or(option.workspace.current_branch.clone())
                .unwrap_or_else(|| "main".to_string());
            Ok(json!({
                "workspaceId": option.workspace.id,
                "displayName": option.workspace.display_name,
                "path": option.workspace.path,
                "repoRootId": option.workspace.repo_root_id,
                "currentBranch": option.workspace.current_branch,
                "baseBranch": base_branch,
                "createBlockReason": option.create_block_reason,
                "agents": launch_agents_to_json(catalog),
            }))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json!({
        "parentSessionId": parent_session_id,
        "limits": {
            "maxManagedWorkspacesPerCoworkSession": MAX_MANAGED_WORKSPACES_PER_COWORK_SESSION,
            "maxCodingSessionsPerManagedWorkspace": MAX_CODING_SESSIONS_PER_MANAGED_WORKSPACE
        },
        "sourceWorkspaces": workspaces,
        "notes": [
            "create_coding_workspace creates only a standard worktree workspace. Use create_coding_session to start agent work inside it.",
            "sourceWorkspaceId selects the repo/source context; the new worktree branches from baseBranch, usually the repo default branch.",
            "Pass workspaceName for a concise workspace/path slug, or branchName for an explicit full Git branch name.",
            "create_coding_session adds another linked coding session to an owned managed coding workspace.",
            "For fast autonomous coding sessions, use the recommended modeId. Claude uses bypassPermissions when no explicit modeId is provided.",
            "When workspaceName and branchName are omitted, the runtime derives a readable workspace name from label or falls back to a short default with numeric suffixes.",
            "Cowork-created coding sessions cannot create their own subagents in this version."
        ]
    }))
}

async fn create_coding_workspace(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CreateCodingWorkspaceArgs,
) -> anyhow::Result<Value> {
    let result = cowork_runtime
        .create_coding_workspace(
            parent_session_id,
            CreateCodingWorkspaceInput {
                source_workspace_id: args.source_workspace_id,
                label: args.label,
                workspace_name: args.workspace_name,
                branch_name: args.branch_name,
            },
        )
        .await?;
    let branch_name = result
        .workspace
        .current_branch
        .clone()
        .or(result.workspace.original_branch.clone());
    let workspace_name = result
        .workspace
        .path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .map(str::to_string);
    Ok(json!({
        "ownershipId": result.managed_workspace.id,
        "workspaceId": result.workspace.id,
        "sourceWorkspaceId": result.managed_workspace.source_workspace_id,
        "label": result.managed_workspace.label,
        "workspaceName": workspace_name,
        "branchName": branch_name,
        "path": result.workspace.path,
        "status": result.status,
        "ready": result.ready,
    }))
}

fn get_coding_session_launch_options(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CodingWorkspaceArgs,
) -> anyhow::Result<Value> {
    let parent = cowork_runtime
        .session_record(parent_session_id)?
        .ok_or_else(|| anyhow::anyhow!("parent session not found"))?;
    let _managed =
        cowork_runtime.validate_managed_coding_workspace(parent_session_id, &args.workspace_id)?;
    let live_config = cowork_runtime.live_config_snapshot(parent_session_id)?;
    let live_mode_control = live_config
        .as_ref()
        .and_then(|snapshot| snapshot.normalized_controls.mode.as_ref());
    let default_agent_kind = parent.agent_kind.clone();
    let default_model_id = parent
        .current_model_id
        .clone()
        .or(parent.requested_model_id.clone());
    let default_mode_id = default_cowork_coding_mode_for_agent(&default_agent_kind)
        .map(str::to_string)
        .or(parent.current_mode_id.clone())
        .or(parent.requested_mode_id.clone())
        .or_else(|| live_mode_control.and_then(|control| control.current_value.clone()));
    let catalog = cowork_runtime.workspace_session_launch_catalog(&args.workspace_id)?;
    Ok(json!({
        "parentSessionId": parent_session_id,
        "workspaceId": args.workspace_id,
        "defaults": {
            "agentKind": default_agent_kind,
            "modelId": default_model_id,
            "modeId": default_mode_id,
            "source": "cowork_parent_session_with_fast_coding_mode_fallback"
        },
        "agents": launch_agents_to_json(catalog),
        "mode": {
            "recommendedModeId": default_mode_id,
            "recommendedModeByAgentKind": recommended_modes_by_agent_kind_json(),
            "recommendedModeSource": "runtime fast coding defaults; explicit modeId overrides this",
            "acceptedModeIdSource": "modeId is stored as a launch hint on the coding session and applied by the child agent when supported",
            "options": mode_options_to_json(live_mode_control),
        },
    }))
}

async fn list_coding_workspaces(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
) -> anyhow::Result<Value> {
    let response = cowork_runtime
        .managed_workspaces_context(parent_session_id)
        .await?;
    Ok(serde_json::to_value(response)?)
}

async fn create_coding_session(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CreateCodingSessionArgs,
) -> anyhow::Result<Value> {
    let workspace_id = args.workspace_id.clone();
    let result = cowork_runtime
        .create_coding_session(
            parent_session_id,
            CreateCodingSessionInput {
                workspace_id: args.workspace_id,
                prompt: args.prompt,
                label: args.label,
                agent_kind: args.agent_kind,
                model_id: args.model_id,
                mode_id: args.mode_id,
                wake_on_completion: args.wake_on_completion,
            },
        )
        .await?;
    Ok(json!({
        "workspaceId": workspace_id,
        "codingSessionId": result.session.id,
        "sessionLinkId": result.session_link.id,
        "label": result.session_link.label,
        "promptStatus": result.prompt_status,
        "wakeScheduleCreated": result.wake_schedule_created,
        "wakeScheduled": result.wake_scheduled,
    }))
}

async fn send_coding_message(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: SendCodingMessageArgs,
) -> anyhow::Result<Value> {
    let outcome = cowork_runtime
        .send_coding_message(parent_session_id, args.into())
        .await?;
    Ok(json!({
        "codingSessionId": outcome.coding_session_id,
        "status": prompt_outcome_label(&outcome.outcome),
        "wakeScheduleCreated": outcome.wake_schedule_created,
        "wakeScheduled": outcome.wake_scheduled,
    }))
}

fn schedule_coding_wake(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CodingSessionArgs,
) -> anyhow::Result<Value> {
    let (link, created) =
        cowork_runtime.schedule_coding_wake(parent_session_id, &args.coding_session_id)?;
    Ok(json!({
        "codingSessionId": args.coding_session_id,
        "sessionLinkId": link.id,
        "wakeScheduleCreated": created,
        "wakeScheduled": true,
    }))
}

async fn get_coding_status(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CodingSessionArgs,
) -> anyhow::Result<Value> {
    let status = cowork_runtime
        .coding_status(parent_session_id, &args.coding_session_id)
        .await?;
    Ok(json!({
        "codingSessionId": status.session.id,
        "sessionLinkId": status.session_link.id,
        "status": status.session.status,
        "agentKind": status.session.agent_kind,
        "modelId": status.session.current_model_id.or(status.session.requested_model_id),
        "modeId": status.session.current_mode_id.or(status.session.requested_mode_id),
        "wakeScheduled": status.wake_scheduled,
        "latestCompletion": status.latest_completion.map(|completion| json!({
            "completionId": completion.completion_id,
            "childTurnId": completion.child_turn_id,
            "childLastEventSeq": completion.child_last_event_seq,
            "outcome": completion.outcome.as_str(),
            "parentEventSeq": completion.parent_event_seq,
            "parentPromptSeq": completion.parent_prompt_seq,
            "createdAt": completion.created_at,
        })),
        "execution": status.execution,
    }))
}

fn read_coding_events(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: ReadCodingEventsArgs,
) -> anyhow::Result<Value> {
    let slice = cowork_runtime.read_coding_events(
        parent_session_id,
        &args.coding_session_id,
        args.since_seq,
        args.limit,
    )?;
    Ok(json!({
        "codingSessionId": slice.child_session_id,
        "events": slice.events,
        "nextSinceSeq": slice.next_since_seq,
        "truncated": slice.truncated,
    }))
}

fn launch_agents_to_json(catalog: WorkspaceSessionLaunchCatalogData) -> Vec<Value> {
    catalog
        .agents
        .into_iter()
        .map(|agent| {
            json!({
                "agentKind": agent.kind,
                "displayName": agent.display_name,
                "defaultModelId": agent.default_model_id,
                "models": agent.models.into_iter().map(|model| {
                    json!({
                        "modelId": model.id,
                        "displayName": model.display_name,
                        "isDefault": model.is_default,
                    })
                }).collect::<Vec<_>>(),
                "recommendedModeId": default_cowork_coding_mode_for_agent(&agent.kind),
            })
        })
        .collect()
}

fn mode_options_to_json(
    mode_control: Option<&anyharness_contract::v1::NormalizedSessionControl>,
) -> Vec<Value> {
    mode_control
        .map(|control| {
            control
                .values
                .iter()
                .map(|value| {
                    json!({
                        "modeId": value.value,
                        "label": value.label,
                        "description": value.description,
                        "isCurrent": control.current_value.as_deref() == Some(value.value.as_str()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn recommended_modes_by_agent_kind_json() -> Value {
    json!({
        "claude": "bypassPermissions",
        "codex": "full-access",
        "gemini": "yolo",
    })
}

fn prompt_outcome_label(outcome: &SendPromptOutcome) -> &'static str {
    match outcome {
        SendPromptOutcome::Running { .. } => "running",
        SendPromptOutcome::Queued { .. } => "queued",
    }
}

impl From<SendCodingMessageArgs> for SendCodingMessageInput {
    fn from(value: SendCodingMessageArgs) -> Self {
        Self {
            coding_session_id: value.coding_session_id,
            prompt: value.prompt,
            wake_on_completion: value.wake_on_completion,
        }
    }
}
