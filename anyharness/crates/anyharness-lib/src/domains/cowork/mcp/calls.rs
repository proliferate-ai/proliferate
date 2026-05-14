use serde_json::{json, Value};

use super::calls_helpers::{
    launch_agents_to_json, mode_options_to_json, non_empty, prompt_outcome_label,
    recommended_modes_by_agent_kind_json,
};
use super::context::CoworkMcpContext;
use super::tools::{
    self, CodingSessionArgs, CodingWorkspaceArgs, CreateArtifactArgs, CreateCodingSessionArgs,
    CreateCodingWorkspaceArgs, DeleteArtifactArgs, GetArtifactArgs, ReadCodingEventsArgs,
    ReadCodingLatestTurnsArgs, SearchCodingTranscriptArgs, SendCodingMessageArgs,
    UpdateArtifactArgs,
};
use crate::domains::cowork::artifacts::{
    CoworkArtifactRuntime, CreateCoworkArtifactInput, UpdateCoworkArtifactInput,
};
use crate::domains::cowork::delegation::model::{
    CreateCodingSessionInput, CreateCodingWorkspaceInput, SendCodingMessageInput,
    MAX_CODING_SESSIONS_PER_MANAGED_WORKSPACE, MAX_MANAGED_WORKSPACES_PER_COWORK_SESSION,
};
use crate::domains::cowork::runtime::{default_cowork_coding_mode_for_agent, CoworkRuntime};
use crate::integrations::mcp::json_rpc::deserialize_args;
use crate::workspaces::model::WorkspaceRecord;

pub async fn call_tool(
    artifact_runtime: &CoworkArtifactRuntime,
    cowork_runtime: &CoworkRuntime,
    ctx: &CoworkMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    ensure_tool_available(name, ctx)?;

    if let Some(result) =
        call_artifact_tool(artifact_runtime, &ctx.workspace, name, arguments.clone()).await?
    {
        return Ok(result);
    }

    match name {
        name if tools::is_delegation_tool(name) => {
            handle_delegation_tool_call(cowork_runtime, &ctx.session_id, name, arguments).await
        }
        _ => anyhow::bail!("unknown tool: {name}"),
    }
}

pub(super) fn ensure_tool_available(name: &str, ctx: &CoworkMcpContext) -> anyhow::Result<()> {
    if tools::is_delegation_tool(name) && !ctx.workspace_delegation_enabled {
        anyhow::bail!("cowork workspace delegation is disabled for this thread");
    }
    Ok(())
}

pub(super) async fn call_artifact_tool(
    artifact_runtime: &CoworkArtifactRuntime,
    workspace: &WorkspaceRecord,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Option<Value>> {
    let result = match name {
        "create_artifact" => {
            let args: CreateArtifactArgs = deserialize_args(arguments)?;
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
            .await??;
            serde_json::to_value(artifact)?
        }
        "update_artifact" => {
            let args: UpdateArtifactArgs = deserialize_args(arguments)?;
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
            .await??;
            serde_json::to_value(artifact)?
        }
        "delete_artifact" => {
            let args: DeleteArtifactArgs = deserialize_args(arguments)?;
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
            .await??;
            result
        }
        "list_artifacts" => {
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let manifest =
                tokio::task::spawn_blocking(move || artifact_runtime.get_manifest(&workspace))
                    .await??;
            serde_json::to_value(manifest)?
        }
        "get_artifact" => {
            let args: GetArtifactArgs = deserialize_args(arguments)?;
            let artifact_runtime = artifact_runtime.clone();
            let workspace = workspace.clone();
            let artifact = tokio::task::spawn_blocking(move || {
                artifact_runtime.get_artifact(&workspace, &args.id)
            })
            .await??;
            serde_json::to_value(artifact)?
        }
        _ => return Ok(None),
    };
    Ok(Some(result))
}

async fn handle_delegation_tool_call(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    tool_name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match tool_name {
        "get_cowork_workspace_launch_options" | "get_coding_workspace_launch_options" => {
            get_coding_workspace_launch_options(cowork_runtime, parent_session_id)
        }
        "create_cowork_workspace" | "create_coding_workspace" => {
            let args: CreateCodingWorkspaceArgs = deserialize_args(arguments)?;
            create_coding_workspace(cowork_runtime, parent_session_id, args).await
        }
        "list_cowork_workspaces" | "list_coding_workspaces" => {
            list_coding_workspaces(cowork_runtime, parent_session_id).await
        }
        "get_cowork_agent_launch_options" | "get_coding_session_launch_options" => {
            let args: CodingWorkspaceArgs = deserialize_args(arguments)?;
            get_coding_session_launch_options(cowork_runtime, parent_session_id, args)
        }
        "create_cowork_agent" | "create_coding_session" => {
            let args: CreateCodingSessionArgs = deserialize_args(arguments)?;
            create_coding_session(cowork_runtime, parent_session_id, args).await
        }
        "send_cowork_agent_message" | "send_coding_message" => {
            let args: SendCodingMessageArgs = deserialize_args(arguments)?;
            send_coding_message(cowork_runtime, parent_session_id, args).await
        }
        "get_cowork_agent_status" | "get_coding_status" => {
            let args: CodingSessionArgs = deserialize_args(arguments)?;
            get_coding_status(cowork_runtime, parent_session_id, args).await
        }
        "schedule_cowork_agent_wake" | "schedule_coding_wake" => {
            let args: CodingSessionArgs = deserialize_args(arguments)?;
            schedule_coding_wake(cowork_runtime, parent_session_id, args)
        }
        "read_cowork_agent_events" | "read_coding_events" => {
            let args: ReadCodingEventsArgs = deserialize_args(arguments)?;
            read_coding_events(cowork_runtime, parent_session_id, args)
        }
        "read_cowork_agent_latest_turns" => {
            let args: ReadCodingLatestTurnsArgs = deserialize_args(arguments)?;
            read_cowork_agent_latest_turns(cowork_runtime, parent_session_id, args)
        }
        "search_cowork_agent_transcript" => {
            let args: SearchCodingTranscriptArgs = deserialize_args(arguments)?;
            search_cowork_agent_transcript(cowork_runtime, parent_session_id, args)
        }
        "close_cowork_agent" => {
            let args: CodingSessionArgs = deserialize_args(arguments)?;
            close_cowork_agent(cowork_runtime, parent_session_id, args).await
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
            let catalog = cowork_runtime.resolved_workspace_launch_options(&option.workspace.id)?;
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
        "coworkWorkspaceId": result.managed_workspace.public_id,
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
    let workspace_id_arg = non_empty(args.workspace_id);
    let managed = cowork_runtime.resolve_managed_coding_workspace(
        parent_session_id,
        args.cowork_workspace_id.as_deref(),
        workspace_id_arg.as_deref(),
    )?;
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
    let catalog = cowork_runtime.resolved_workspace_launch_options(&managed.workspace_id)?;
    Ok(json!({
        "parentSessionId": parent_session_id,
        "coworkWorkspaceId": managed.public_id,
        "workspaceId": managed.workspace_id,
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
    let managed = cowork_runtime.resolve_managed_coding_workspace(
        parent_session_id,
        args.cowork_workspace_id.as_deref(),
        args.workspace_id.as_deref(),
    )?;
    let workspace_id = managed.workspace_id.clone();
    let cowork_workspace_id = managed.public_id.clone();
    let result = cowork_runtime
        .create_coding_session(
            parent_session_id,
            CreateCodingSessionInput {
                workspace_id: managed.workspace_id,
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
        "coworkWorkspaceId": cowork_workspace_id,
        "workspaceId": workspace_id,
        "coworkAgentId": result.session_link.public_id,
        "codingSessionId": result.session.id,
        "sessionLinkId": result.session_link.id,
        "label": result.session_link.label,
        "promptStatus": result.prompt_status,
        "wake": {
            "scheduled": result.wake_scheduled,
            "created": result.wake_schedule_created,
            "scope": if result.wake_scheduled { Some("next_completion") } else { None::<&str> },
        },
        "wakeScheduleCreated": result.wake_schedule_created,
        "wakeScheduled": result.wake_scheduled,
        "wakeScope": if result.wake_scheduled { Some("next_completion") } else { None::<&str> },
        "readCursor": { "sinceSeq": 0 },
    }))
}

async fn send_coding_message(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: SendCodingMessageArgs,
) -> anyhow::Result<Value> {
    let link = cowork_runtime.resolve_coding_session_target(
        parent_session_id,
        args.cowork_agent_id.as_deref(),
        args.coding_session_id.as_deref(),
    )?;
    let outcome = cowork_runtime
        .send_coding_message(
            parent_session_id,
            SendCodingMessageInput {
                coding_session_id: link.child_session_id.clone(),
                prompt: args.prompt,
                wake_on_completion: args.wake_on_completion,
            },
        )
        .await?;
    Ok(json!({
        "coworkAgentId": link.public_id,
        "codingSessionId": outcome.coding_session_id,
        "status": prompt_outcome_label(&outcome.outcome),
        "wake": {
            "scheduled": outcome.wake_scheduled,
            "created": outcome.wake_schedule_created,
            "scope": if outcome.wake_scheduled { Some("next_completion") } else { None::<&str> },
        },
        "wakeScheduleCreated": outcome.wake_schedule_created,
        "wakeScheduled": outcome.wake_scheduled,
        "wakeScope": if outcome.wake_scheduled { Some("next_completion") } else { None::<&str> },
    }))
}

fn schedule_coding_wake(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CodingSessionArgs,
) -> anyhow::Result<Value> {
    let (link, created) = cowork_runtime.schedule_coding_wake_for_target(
        parent_session_id,
        args.cowork_agent_id.as_deref(),
        args.coding_session_id.as_deref(),
    )?;
    Ok(json!({
        "coworkAgentId": link.public_id,
        "codingSessionId": link.child_session_id,
        "sessionLinkId": link.id,
        "wakeScheduleCreated": created,
        "wakeScheduled": true,
        "wakeScope": "next_completion",
    }))
}

async fn get_coding_status(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CodingSessionArgs,
) -> anyhow::Result<Value> {
    let status = cowork_runtime
        .coding_status_for_target(
            parent_session_id,
            args.cowork_agent_id.as_deref(),
            args.coding_session_id.as_deref(),
        )
        .await?;
    Ok(json!({
        "coworkAgentId": status.session_link.public_id,
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
    let slice = cowork_runtime.read_coding_events_for_target(
        parent_session_id,
        args.cowork_agent_id.as_deref(),
        args.coding_session_id.as_deref(),
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

fn read_cowork_agent_latest_turns(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: ReadCodingLatestTurnsArgs,
) -> anyhow::Result<Value> {
    let turns = cowork_runtime.read_coding_latest_turns_for_target(
        parent_session_id,
        args.cowork_agent_id.as_deref(),
        args.coding_session_id.as_deref(),
        args.limit,
    )?;
    Ok(json!({ "turns": turns }))
}

fn search_cowork_agent_transcript(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: SearchCodingTranscriptArgs,
) -> anyhow::Result<Value> {
    let matches = cowork_runtime.search_coding_transcript_for_target(
        parent_session_id,
        args.cowork_agent_id.as_deref(),
        args.coding_session_id.as_deref(),
        &args.query,
        args.limit,
    )?;
    Ok(json!({ "query": args.query, "matches": matches }))
}

async fn close_cowork_agent(
    cowork_runtime: &CoworkRuntime,
    parent_session_id: &str,
    args: CodingSessionArgs,
) -> anyhow::Result<Value> {
    let (link, already_closed, closed_at) = cowork_runtime
        .close_coding_session_for_target(
            parent_session_id,
            args.cowork_agent_id.as_deref(),
            args.coding_session_id.as_deref(),
        )
        .await?;
    Ok(json!({
        "coworkAgentId": link.public_id,
        "codingSessionId": link.child_session_id,
        "sessionLinkId": link.id,
        "closed": true,
        "alreadyClosed": already_closed,
        "closedAt": link.closed_at.unwrap_or(closed_at),
    }))
}
