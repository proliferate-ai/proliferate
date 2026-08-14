use serde_json::{json, Value};

use super::super::service::SubagentService;
use super::calls_helpers::{
    default_model_for_agent, launch_agents_to_json, mode_options_to_json, summaries_to_json,
};
use super::context::SubagentMcpContext;
use super::tools::{
    ChildSessionArgs, CreateSubagentArgs, ReadSubagentEventsArgs, ReadSubagentLatestTurnsArgs,
    SearchSubagentTranscriptArgs, SendSubagentMessageArgs,
};
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::delegation::{READ_EVENTS_DEFAULT_LIMIT, READ_EVENTS_MAX_LIMIT};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::integrations::mcp::json_rpc::deserialize_args;

mod mutations;
use mutations::{close_subagent, create_subagent, schedule_subagent_wake, send_subagent_message};

pub async fn call_tool(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    session_admission: &SessionMutationAdmission,
    operation_gate: &WorkspaceOperationGate,
    ctx: &SubagentMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match name {
        "get_subagent_launch_options" => get_subagent_launch_options(service, session_runtime, ctx),
        "create_subagent" => {
            let args: CreateSubagentArgs = deserialize_args(arguments)?;
            create_subagent(
                service,
                session_runtime,
                session_admission,
                operation_gate,
                ctx,
                args,
            )
            .await
        }
        "list_subagents" => service
            .list_subagents(&ctx.parent_session_id)
            .map(|summaries| json!({ "subagents": summaries_to_json(summaries) }))
            .map_err(anyhow::Error::from),
        "send_subagent_message" => {
            let args: SendSubagentMessageArgs = deserialize_args(arguments)?;
            send_subagent_message(
                service,
                session_runtime,
                session_admission,
                operation_gate,
                &ctx.parent_session_id,
                args,
            )
            .await
        }
        "schedule_subagent_wake" => {
            let args: ChildSessionArgs = deserialize_args(arguments)?;
            schedule_subagent_wake(
                service,
                session_admission,
                operation_gate,
                &ctx.parent_session_id,
                args,
            )
            .await
        }
        "get_subagent_status" => {
            let args: ChildSessionArgs = deserialize_args(arguments)?;
            get_subagent_status(service, session_runtime, &ctx.parent_session_id, args).await
        }
        "read_subagent_events" => {
            let args: ReadSubagentEventsArgs = deserialize_args(arguments)?;
            service
                .read_subagent_events(
                    &ctx.parent_session_id,
                    args.subagent_id.as_deref(),
                    None,
                    args.since_seq,
                    args.limit,
                )
                .map(|slice| {
                    json!({
                        "childSessionId": slice.child_session_id,
                        "events": slice.events,
                        "nextSinceSeq": slice.next_since_seq,
                        "truncated": slice.truncated,
                    })
                })
                .map_err(anyhow::Error::from)
        }
        "read_subagent_latest_turns" => {
            let args: ReadSubagentLatestTurnsArgs = deserialize_args(arguments)?;
            let link = service.resolve_target_including_closed(
                &ctx.parent_session_id,
                args.subagent_id.as_deref(),
                None,
            )?;
            service
                .read_latest_turns(
                    &ctx.parent_session_id,
                    link.public_id.as_deref(),
                    Some(&link.child_session_id),
                    args.limit,
                )
                .map(|turns| {
                    json!({
                        "sessionLinkId": link.id,
                        "subagentId": link.public_id,
                        "childSessionId": link.child_session_id,
                        "label": link.label,
                        "turns": turns.into_iter().map(|turn| json!({
                            "childTurnId": turn.child_turn_id,
                            "outcome": turn.outcome,
                            "createdAt": turn.created_at,
                            "childLastEventSeq": turn.child_last_event_seq,
                            "assistantText": turn.assistant_text,
                            "toolErrors": turn.tool_errors,
                            "eventCount": turn.event_count,
                        })).collect::<Vec<_>>()
                    })
                })
                .map_err(anyhow::Error::from)
        }
        "search_subagent_transcript" => {
            let args: SearchSubagentTranscriptArgs = deserialize_args(arguments)?;
            let link = service.resolve_target_including_closed(
                &ctx.parent_session_id,
                args.subagent_id.as_deref(),
                None,
            )?;
            service
                .search_transcript(
                    &ctx.parent_session_id,
                    link.public_id.as_deref(),
                    Some(&link.child_session_id),
                    &args.query,
                    args.limit,
                )
                .map(|matches| {
                    json!({
                        "sessionLinkId": link.id,
                        "subagentId": link.public_id,
                        "childSessionId": link.child_session_id,
                        "label": link.label,
                        "query": args.query,
                        "matches": matches.into_iter().map(|entry| json!({
                            "seq": entry.seq,
                            "timestamp": entry.timestamp,
                            "turnId": entry.turn_id,
                            "itemId": entry.item_id,
                            "snippet": entry.snippet,
                        })).collect::<Vec<_>>()
                    })
                })
                .map_err(anyhow::Error::from)
        }
        "close_subagent" => {
            let args: ChildSessionArgs = deserialize_args(arguments)?;
            close_subagent(
                service,
                session_runtime,
                session_admission,
                operation_gate,
                &ctx.parent_session_id,
                args,
            )
            .await
        }
        _ => Err(anyhow::anyhow!("unknown tool: {name}")),
    }
}

fn get_subagent_launch_options(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    ctx: &SubagentMcpContext,
) -> anyhow::Result<Value> {
    let parent = service
        .session_store()
        .find_by_id(&ctx.parent_session_id)?
        .ok_or_else(|| anyhow::anyhow!("parent session not found"))?;
    let catalog = session_runtime.resolved_workspace_launch_options(&parent.workspace_id)?;
    let live_config = session_runtime.live_config_snapshot(&ctx.parent_session_id)?;

    let default_agent_kind = parent.agent_kind.clone();
    let default_model_id = parent
        .current_model_id
        .clone()
        .or(parent.requested_model_id.clone())
        .or_else(|| default_model_for_agent(&catalog, &default_agent_kind));
    let parent_mode_id = parent
        .current_mode_id
        .clone()
        .or(parent.requested_mode_id.clone());
    let live_mode_control = live_config
        .as_ref()
        .and_then(|snapshot| snapshot.normalized_controls.mode.as_ref());
    let default_mode_id = parent_mode_id
        .clone()
        .or_else(|| live_mode_control.and_then(|control| control.current_value.clone()));

    Ok(json!({
        "parentSessionId": ctx.parent_session_id,
        "workspaceId": ctx.workspace_id,
        "canCreate": ctx.can_create,
        "createBlockReason": ctx.create_block_reason,
        "defaults": {
            "harnessId": default_agent_kind,
            "agentKind": default_agent_kind,
            "modelId": default_model_id,
            "modeId": default_mode_id,
            "source": "current_parent_session"
        },
        "limits": {
            "maxSubagentsPerParent": ctx.max_subagents_per_parent,
            "existingSubagentCount": ctx.existing_subagent_count,
            "remainingSubagents": ctx.max_subagents_per_parent.saturating_sub(ctx.existing_subagent_count),
            "depthLimit": 1,
            "readEventsDefaultLimit": READ_EVENTS_DEFAULT_LIMIT,
            "readEventsMaxLimit": READ_EVENTS_MAX_LIMIT
        },
        "capabilities": {
            "workspaceRelation": "same_workspace",
            "canSpecifyAgentKind": true,
            "canSpecifyHarnessId": true,
            "canSpecifyModelId": true,
            "canSpecifyModeId": true,
            "createWakeOnCompletion": true,
            "sendWakeOnCompletion": true,
            "childCanSpawnSubagents": false,
            "childMcpInheritance": "none"
        },
        "agents": launch_agents_to_json(catalog, &parent.agent_kind),
        "mode": {
            "currentModeId": default_mode_id,
            "acceptedModeIdSource": "parent live mode control when available; otherwise any non-empty modeId is passed through as a launch hint",
            "options": mode_options_to_json(live_mode_control),
        },
        "notes": [
            "If harnessId or initialConfig.modelId/modeId are omitted, create_subagent inherits the current parent session values when available.",
            "harnessId and initialConfig.modelId are validated against the launch catalog before the child session is created.",
            "initialConfig.modeId is currently a launch hint stored on the child session; available mode options can only be inferred from the parent session's live config snapshot.",
            "Subagents are same-workspace normal sessions. They cannot create grandchildren and do not inherit the parent's MCP bindings in this PR.",
            "Completions are passive by default. Pass wakeOnCompletion or call schedule_subagent_wake when you want to be prompted after the child's next completed turn."
        ]
    }))
}

async fn get_subagent_status(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    let link = service.resolve_target_including_closed(
        parent_session_id,
        args.subagent_id.as_deref(),
        None,
    )?;
    let session = service
        .session_store()
        .find_by_id(&link.child_session_id)?
        .ok_or_else(|| anyhow::anyhow!("child session not found"))?;
    let execution = session_runtime.session_execution_summary(&session).await;
    Ok(json!({
        "subagentId": link.public_id,
        "sessionLinkId": link.id,
        "childSessionId": session.id,
        "label": link.label,
        "status": session.status,
        "agentKind": session.agent_kind,
        "modelId": session.current_model_id.or(session.requested_model_id),
        "modeId": session.current_mode_id.or(session.requested_mode_id),
        "execution": execution,
    }))
}
