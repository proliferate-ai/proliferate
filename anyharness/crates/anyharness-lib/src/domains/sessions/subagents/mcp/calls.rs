use serde_json::{json, Value};

use super::super::service::SubagentService;
use super::calls_helpers::{
    default_model_for_agent, initial_config_string, launch_agents_to_json, mode_options_to_json,
    prompt_outcome_label, summaries_to_json,
};
use super::context::SubagentMcpContext;
use super::tools::{
    ChildSessionArgs, CreateSubagentArgs, ReadSubagentEventsArgs, ReadSubagentLatestTurnsArgs,
    SearchSubagentTranscriptArgs, SendSubagentMessageArgs,
};
use crate::domains::sessions::delegation::{
    parent_to_child_provenance, READ_EVENTS_DEFAULT_LIMIT, READ_EVENTS_MAX_LIMIT,
};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::integrations::mcp::json_rpc::deserialize_args;
use crate::origin::OriginContext;

pub async fn call_tool(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    ctx: &SubagentMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    match name {
        "get_subagent_launch_options" => get_subagent_launch_options(service, session_runtime, ctx),
        "create_subagent" => {
            let args: CreateSubagentArgs = deserialize_args(arguments)?;
            create_subagent(service, session_runtime, ctx, args).await
        }
        "list_subagents" => service
            .list_subagents(&ctx.parent_session_id)
            .map(|summaries| json!({ "subagents": summaries_to_json(summaries) }))
            .map_err(anyhow::Error::from),
        "send_subagent_message" => {
            let args: SendSubagentMessageArgs = deserialize_args(arguments)?;
            send_subagent_message(service, session_runtime, &ctx.parent_session_id, args).await
        }
        "schedule_subagent_wake" => {
            let args: ChildSessionArgs = deserialize_args(arguments)?;
            schedule_subagent_wake(service, &ctx.parent_session_id, args)
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
            close_subagent(service, session_runtime, &ctx.parent_session_id, args).await
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

async fn create_subagent(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    ctx: &SubagentMcpContext,
    args: CreateSubagentArgs,
) -> anyhow::Result<Value> {
    let parent_session_id = &ctx.parent_session_id;
    if !ctx.can_create {
        anyhow::bail!(
            "{}",
            ctx.create_block_reason
                .as_deref()
                .unwrap_or("subagent creation is not available for this session")
        );
    }
    let parent = service.validate_parent_can_spawn(parent_session_id)?;
    let prompt = args.prompt;
    if prompt.trim().is_empty() {
        anyhow::bail!("prompt is required");
    }
    let agent_kind = args
        .harness_id
        .unwrap_or_else(|| parent.agent_kind.clone());
    let model_id = initial_config_string(args.initial_config.as_ref(), &["modelId", "model"])
        .or(parent.current_model_id.clone())
        .or(parent.requested_model_id.clone());
    let mode_id = initial_config_string(args.initial_config.as_ref(), &["modeId", "mode"])
        .or(parent.current_mode_id.clone())
        .or(parent.requested_mode_id.clone());
    let label = args
        .label
        .map(|value| value.trim().to_string())
        .filter(|v| !v.is_empty());

    let child = session_runtime
        .create_durable_session(
            &parent.workspace_id,
            &agent_kind,
            model_id.as_deref(),
            mode_id.as_deref(),
            None,
            Vec::new(),
            None,
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            false,
            parent.agent_auth_scope.clone(),
            parent.required_agent_auth_revision,
            OriginContext::system_local_runtime(),
        )
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    let link = match service.link_child(parent_session_id, &child.id, label.clone(), None, None) {
        Ok(link) => link,
        Err(error) => {
            let _ = service.delete_session(&child.id);
            return Err(error.into());
        }
    };
    let wake_scheduled = if args.wake_on_completion {
        match service.schedule_wake_for_target(parent_session_id, None, Some(&child.id)) {
            Ok((_, inserted)) => inserted,
            Err(error) => {
                cleanup_child_session_after_failed_launch(service, &child.id, "schedule wake");
                return Err(error.into());
            }
        }
    } else {
        false
    };

    let started = match session_runtime.start_persisted_session(&child, None).await {
        Ok(started) => started,
        Err(error) => {
            if args.wake_on_completion {
                cleanup_wake_schedule_after_failed_dispatch(service, &link.id, "start subagent");
            }
            cleanup_child_session_after_failed_launch(service, &child.id, "start subagent");
            return Err(anyhow::anyhow!("{error:?}"));
        }
    };
    let outcome = match session_runtime
        .send_text_prompt_with_provenance(
            &started.id,
            prompt,
            parent_to_child_provenance(parent_session_id, &link.id, label.clone()),
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            if args.wake_on_completion {
                cleanup_wake_schedule_after_failed_dispatch(
                    service,
                    &link.id,
                    "send initial prompt",
                );
            }
            cleanup_child_session_after_failed_launch(service, &child.id, "send initial prompt");
            return Err(anyhow::anyhow!("{error:?}"));
        }
    };
    Ok(json!({
        "sessionLinkId": link.id,
        "subagentId": link.public_id,
        "childSessionId": started.id,
        "label": label,
        "appliedInitialConfig": {
            "harnessId": agent_kind,
            "modelId": model_id,
            "modeId": mode_id,
        },
        "wake": {
            "scheduled": args.wake_on_completion,
            "created": wake_scheduled,
            "scope": if args.wake_on_completion { Some("next_completion") } else { None::<&str> },
        },
        "wakeScheduled": args.wake_on_completion,
        "wakeScheduleCreated": wake_scheduled,
        "wakeScope": if args.wake_on_completion { Some("next_completion") } else { None::<&str> },
        "promptStatus": prompt_outcome_label(&outcome),
        "readCursor": { "sinceSeq": 0 },
    }))
}

fn cleanup_wake_schedule_after_failed_dispatch(
    service: &SubagentService,
    session_link_id: &str,
    context: &str,
) {
    if let Err(error) = service.delete_wake_schedule_for_link(session_link_id) {
        tracing::warn!(
            session_link_id,
            context,
            error = ?error,
            "failed to clean up subagent wake schedule after dispatch failure"
        );
    }
}

fn cleanup_child_session_after_failed_launch(
    service: &SubagentService,
    child_session_id: &str,
    context: &str,
) {
    if let Err(error) = service.delete_session(child_session_id) {
        tracing::warn!(
            child_session_id,
            context,
            error = ?error,
            "failed to clean up subagent child session after launch failure"
        );
    }
}

async fn send_subagent_message(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    args: SendSubagentMessageArgs,
) -> anyhow::Result<Value> {
    let prompt = args.prompt;
    if prompt.trim().is_empty() {
        anyhow::bail!("prompt is required");
    }
    let link = service.authorize_target(
        parent_session_id,
        args.subagent_id.as_deref(),
        None,
    )?;
    let wake_scheduled = if args.wake_on_completion {
        service
            .schedule_wake_for_target(
                parent_session_id,
                args.subagent_id.as_deref(),
                None,
            )?
            .1
    } else {
        false
    };
    let outcome = match session_runtime
        .send_text_prompt_with_provenance(
            &link.child_session_id,
            prompt,
            parent_to_child_provenance(parent_session_id, &link.id, link.label.clone()),
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            if args.wake_on_completion {
                cleanup_wake_schedule_after_failed_dispatch(
                    service,
                    &link.id,
                    "send subagent message",
                );
            }
            return Err(anyhow::anyhow!("{error:?}"));
        }
    };
    Ok(json!({
        "subagentId": link.public_id,
        "childSessionId": link.child_session_id,
        "label": link.label,
        "wake": {
            "scheduled": args.wake_on_completion,
            "created": wake_scheduled,
            "scope": if args.wake_on_completion { Some("next_completion") } else { None::<&str> },
        },
        "wakeScheduled": args.wake_on_completion,
        "wakeScheduleCreated": wake_scheduled,
        "wakeScope": if args.wake_on_completion { Some("next_completion") } else { None::<&str> },
        "status": prompt_outcome_label(&outcome),
    }))
}

fn schedule_subagent_wake(
    service: &SubagentService,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    let (link, inserted) = service.schedule_wake_for_target(
        parent_session_id,
        args.subagent_id.as_deref(),
        None,
    )?;
    Ok(json!({
        "subagentId": link.public_id,
        "sessionLinkId": link.id,
        "childSessionId": link.child_session_id,
        "label": link.label,
        "scheduled": true,
        "alreadyScheduled": !inserted,
        "wakeScope": "next_completion",
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

async fn close_subagent(
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
    let already_closed = link.closed_at.is_some();
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(child) = service.session_store().find_by_id(&link.child_session_id)? {
        if child.closed_at.is_none() {
            session_runtime
                .close_live_session(&link.child_session_id)
                .await
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        }
    }
    if !already_closed {
        service.close_link(&link, &now)?;
    }
    let refreshed = service.resolve_target_including_closed(
        parent_session_id,
        args.subagent_id.as_deref(),
        None,
    )?;
    Ok(json!({
        "subagentId": refreshed.public_id,
        "sessionLinkId": refreshed.id,
        "childSessionId": refreshed.child_session_id,
        "label": refreshed.label,
        "closed": true,
        "alreadyClosed": already_closed,
        "closedAt": refreshed.closed_at.unwrap_or(now),
    }))
}
