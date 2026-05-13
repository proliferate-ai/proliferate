use serde_json::{json, Value};

use super::super::service::SubagentService;
use super::context::SubagentMcpContext;
use super::tools::{
    ChildSessionArgs, CreateSubagentArgs, ReadSubagentEventsArgs, SendSubagentMessageArgs,
};
use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::integrations::mcp::json_rpc::deserialize_args;
use crate::origin::OriginContext;
use crate::sessions::delegation::{READ_EVENTS_DEFAULT_LIMIT, READ_EVENTS_MAX_LIMIT};
use crate::sessions::runtime::{SendPromptOutcome, SessionRuntime};

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
                    &args.child_session_id,
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
            "canSpecifyModelId": true,
            "canSpecifyModeId": true,
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
            "If agentKind, modelId, or modeId are omitted, create_subagent inherits the current parent session values when available.",
            "agentKind and modelId are validated against the launch catalog before the child session is created.",
            "modeId is currently a launch hint stored on the child session; available mode options can only be inferred from the parent session's live config snapshot.",
            "Subagents are same-workspace normal sessions. They cannot create grandchildren and do not inherit the parent's MCP bindings in this PR.",
            "Completions are passive by default. Call schedule_subagent_wake after create_subagent or send_subagent_message when you want to be prompted after the child's next completed turn."
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
    let prompt = args.prompt.trim().to_string();
    if prompt.is_empty() {
        anyhow::bail!("prompt is required");
    }
    let agent_kind = args
        .agent_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&parent.agent_kind)
        .to_string();
    let model_id = args
        .model_id
        .or(parent.current_model_id.clone())
        .or(parent.requested_model_id.clone());
    let mode_id = args
        .mode_id
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
            crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            false,
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
        match service.schedule_wake_for_child(parent_session_id, &child.id) {
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
            SubagentService::parent_to_child_provenance(parent_session_id, &link.id, label.clone()),
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
        "childSessionId": started.id,
        "label": label,
        "wakeScheduled": args.wake_on_completion,
        "wakeScheduleCreated": wake_scheduled,
        "promptStatus": prompt_outcome_label(&outcome),
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

fn default_model_for_agent(
    catalog: &ResolvedWorkspaceLaunchOptions,
    agent_kind: &str,
) -> Option<String> {
    catalog
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
        .and_then(|agent| agent.default_model_id.clone())
}

fn launch_agents_to_json(
    catalog: ResolvedWorkspaceLaunchOptions,
    parent_agent_kind: &str,
) -> Vec<Value> {
    catalog
        .agents
        .into_iter()
        .map(|agent| {
            json!({
                "agentKind": agent.kind,
                "displayName": agent.display_name,
                "defaultModelId": agent.default_model_id,
                "isParentAgent": agent.kind == parent_agent_kind,
                "models": agent.models.into_iter().map(|model| {
                    json!({
                        "modelId": model.id,
                        "displayName": model.display_name,
                        "isDefault": model.is_default,
                    })
                }).collect::<Vec<_>>(),
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

async fn send_subagent_message(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    args: SendSubagentMessageArgs,
) -> anyhow::Result<Value> {
    let prompt = args.prompt.trim().to_string();
    if prompt.is_empty() {
        anyhow::bail!("prompt is required");
    }
    let link = service.authorize_child(parent_session_id, &args.child_session_id)?;
    let wake_scheduled = if args.wake_on_completion {
        service
            .schedule_wake_for_child(parent_session_id, &args.child_session_id)?
            .1
    } else {
        false
    };
    let outcome = match session_runtime
        .send_text_prompt_with_provenance(
            &args.child_session_id,
            prompt,
            SubagentService::parent_to_child_provenance(
                parent_session_id,
                &link.id,
                link.label.clone(),
            ),
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
        "childSessionId": args.child_session_id,
        "wakeScheduled": args.wake_on_completion,
        "wakeScheduleCreated": wake_scheduled,
        "status": prompt_outcome_label(&outcome),
    }))
}

fn schedule_subagent_wake(
    service: &SubagentService,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    let (link, inserted) =
        service.schedule_wake_for_child(parent_session_id, &args.child_session_id)?;
    Ok(json!({
        "sessionLinkId": link.id,
        "childSessionId": args.child_session_id,
        "scheduled": true,
        "alreadyScheduled": !inserted,
    }))
}

async fn get_subagent_status(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    service.authorize_child(parent_session_id, &args.child_session_id)?;
    let session = service
        .session_store()
        .find_by_id(&args.child_session_id)?
        .ok_or_else(|| anyhow::anyhow!("child session not found"))?;
    let execution = session_runtime.session_execution_summary(&session).await;
    Ok(json!({
        "childSessionId": session.id,
        "status": session.status,
        "agentKind": session.agent_kind,
        "modelId": session.current_model_id.or(session.requested_model_id),
        "modeId": session.current_mode_id.or(session.requested_mode_id),
        "execution": execution,
    }))
}

fn summaries_to_json(summaries: Vec<super::super::model::SubagentSummary>) -> Vec<Value> {
    summaries
        .into_iter()
        .map(|summary| {
            json!({
                "sessionLinkId": summary.link_id,
                "childSessionId": summary.child_session_id,
                "label": summary.label,
                "status": summary.status,
                "agentKind": summary.agent_kind,
                "modelId": summary.model_id,
                "modeId": summary.mode_id,
                "createdAt": summary.created_at,
            })
        })
        .collect()
}

fn prompt_outcome_label(outcome: &SendPromptOutcome) -> &'static str {
    match outcome {
        SendPromptOutcome::Running { .. } => "running",
        SendPromptOutcome::Queued { .. } => "queued",
    }
}
