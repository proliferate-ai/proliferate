use serde_json::{json, Value};

use super::mcp_protocol::JsonRpcRequest;
use super::mcp_protocol::{
    build_tool_list, deserialize_args, jsonrpc_error, jsonrpc_result, jsonrpc_tool_result,
    CallToolParams, ChildSessionArgs, CreateSubagentArgs, InitializeParams, ReadSubagentEventsArgs,
    SendSubagentMessageArgs,
};
use super::service::{SubagentService, MAX_SUBAGENTS_PER_PARENT};
use crate::origin::OriginContext;
use crate::sessions::delegation::{READ_EVENTS_DEFAULT_LIMIT, READ_EVENTS_MAX_LIMIT};
use crate::sessions::runtime::{SendPromptOutcome, SessionRuntime};
use crate::sessions::service::WorkspaceSessionLaunchCatalogData;
use crate::workspaces::runtime::WorkspaceRuntime;

pub async fn handle_json_rpc(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    workspace_runtime: &WorkspaceRuntime,
    workspace_id: &str,
    parent_session_id: &str,
    request_body: Value,
) -> anyhow::Result<Option<Value>> {
    let request: JsonRpcRequest = serde_json::from_value(request_body)?;
    if request.jsonrpc != "2.0" {
        return Ok(Some(jsonrpc_error(
            request.id,
            -32600,
            "invalid jsonrpc version",
        )));
    }
    validate_parent_context(service, workspace_runtime, workspace_id, parent_session_id)?;

    match request.method.as_str() {
        "initialize" => {
            let params = request
                .params
                .map(serde_json::from_value::<InitializeParams>)
                .transpose()?;
            Ok(Some(jsonrpc_result(
                request.id,
                json!({
                    "protocolVersion": params
                        .and_then(|value| value.protocol_version)
                        .unwrap_or_else(|| "2025-11-25".to_string()),
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "proliferate-subagents",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Use get_subagent_launch_options to inspect defaults, limits, and supported agent/model choices. Use subagent tools to create and manage same-workspace child agent sessions. Child completions are passive by default. Set wakeOnCompletion when creating or messaging a child, or call schedule_subagent_wake for an already-running child, if you want AnyHarness to prompt you after the child's next completed turn. Inspect child output with read_subagent_events before continuing."
                }),
            )))
        }
        "notifications/initialized" => Ok(None),
        "tools/list" => Ok(Some(jsonrpc_result(
            request.id,
            json!({ "tools": build_tool_list() }),
        ))),
        "tools/call" => {
            let params: CallToolParams =
                serde_json::from_value(request.params.unwrap_or_else(|| json!({})))?;
            Ok(Some(
                handle_tool_call(
                    service,
                    session_runtime,
                    parent_session_id,
                    request.id,
                    params,
                )
                .await,
            ))
        }
        _ => Ok(Some(jsonrpc_error(
            request.id,
            -32601,
            format!("unsupported method: {}", request.method),
        ))),
    }
}

async fn handle_tool_call(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    id: Option<Value>,
    params: CallToolParams,
) -> Value {
    let result = match params.name.as_str() {
        "get_subagent_launch_options" => {
            get_subagent_launch_options(service, session_runtime, parent_session_id)
        }
        "create_subagent" => {
            let args: anyhow::Result<CreateSubagentArgs> = deserialize_args(params.arguments);
            match args {
                Ok(args) => {
                    create_subagent(service, session_runtime, parent_session_id, args).await
                }
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        "list_subagents" => service
            .list_subagents(parent_session_id)
            .map(|summaries| json!({ "subagents": summaries_to_json(summaries) }))
            .map_err(anyhow::Error::from),
        "send_subagent_message" => {
            let args: anyhow::Result<SendSubagentMessageArgs> = deserialize_args(params.arguments);
            match args {
                Ok(args) => {
                    send_subagent_message(service, session_runtime, parent_session_id, args).await
                }
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        "schedule_subagent_wake" => {
            let args: anyhow::Result<ChildSessionArgs> = deserialize_args(params.arguments);
            match args {
                Ok(args) => schedule_subagent_wake(service, parent_session_id, args),
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        "get_subagent_status" => {
            let args: anyhow::Result<ChildSessionArgs> = deserialize_args(params.arguments);
            match args {
                Ok(args) => {
                    get_subagent_status(service, session_runtime, parent_session_id, args).await
                }
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        "read_subagent_events" => {
            let args: anyhow::Result<ReadSubagentEventsArgs> = deserialize_args(params.arguments);
            match args {
                Ok(args) => service
                    .read_subagent_events(
                        parent_session_id,
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
                    .map_err(anyhow::Error::from),
                Err(error) => Err(anyhow::anyhow!(error.to_string())),
            }
        }
        _ => Err(anyhow::anyhow!("unknown tool: {}", params.name)),
    };
    jsonrpc_tool_result(id, result)
}

fn get_subagent_launch_options(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
) -> anyhow::Result<Value> {
    let parent = service
        .session_store()
        .find_by_id(parent_session_id)?
        .ok_or_else(|| anyhow::anyhow!("parent session not found"))?;
    let existing_subagent_count = service.list_subagents(parent_session_id)?.len();
    let create_block_reason = service
        .validate_parent_can_spawn(parent_session_id)
        .err()
        .map(|error| error.to_string());
    let catalog = session_runtime.workspace_session_launch_catalog(&parent.workspace_id)?;
    let live_config = session_runtime.live_config_snapshot(parent_session_id)?;

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
        "parentSessionId": parent_session_id,
        "workspaceId": parent.workspace_id,
        "canCreate": create_block_reason.is_none(),
        "createBlockReason": create_block_reason,
        "defaults": {
            "agentKind": default_agent_kind,
            "modelId": default_model_id,
            "modeId": default_mode_id,
            "source": "current_parent_session"
        },
        "limits": {
            "maxSubagentsPerParent": MAX_SUBAGENTS_PER_PARENT,
            "existingSubagentCount": existing_subagent_count,
            "remainingSubagents": MAX_SUBAGENTS_PER_PARENT.saturating_sub(existing_subagent_count),
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
            "Completions are passive by default. Set wakeOnCompletion on create_subagent/send_subagent_message, or call schedule_subagent_wake, when you want to be prompted after the child's next completed turn."
        ]
    }))
}

async fn create_subagent(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    parent_session_id: &str,
    args: CreateSubagentArgs,
) -> anyhow::Result<Value> {
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
    catalog: &WorkspaceSessionLaunchCatalogData,
    agent_kind: &str,
) -> Option<String> {
    catalog
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
        .and_then(|agent| agent.default_model_id.clone())
}

fn launch_agents_to_json(
    catalog: WorkspaceSessionLaunchCatalogData,
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

fn validate_parent_context(
    service: &SubagentService,
    workspace_runtime: &WorkspaceRuntime,
    workspace_id: &str,
    parent_session_id: &str,
) -> anyhow::Result<()> {
    let parent = service
        .session_store()
        .find_by_id(parent_session_id)?
        .ok_or_else(|| anyhow::anyhow!("parent session not found"))?;
    if parent.workspace_id != workspace_id {
        anyhow::bail!("parent session does not belong to workspace");
    }
    let workspace = workspace_runtime
        .get_workspace(workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found"))?;
    if workspace.surface != "standard" {
        anyhow::bail!("subagents are only available in standard workspaces");
    }
    Ok(())
}

fn summaries_to_json(summaries: Vec<super::model::SubagentSummary>) -> Vec<Value> {
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
