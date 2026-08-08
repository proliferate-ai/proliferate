use std::collections::HashMap;

use anyharness_contract::v1::ConfigApplyState;
use serde_json::{json, Value};

use super::calls_helpers::{
    cleanup_wake_schedule_after_failed_dispatch, default_model_for_agent, launch_agents_to_json,
    mode_options_to_json, prompt_outcome_label, summaries_to_json,
};
use super::config_ops::{
    compose_agent_config_options, controls_to_json, current_selection_to_json,
    prepare_agent_config_change,
};
use super::context::AgentOpsMcpContext;
use super::peer_ops::{
    admit_peer_mutation, assert_target_still_takes_messages, assert_workspace_can_be_mutated,
    authorize_transcript_read, consume_reply_wake, lease_target_workspace_for_peer_write,
    prepare_agent_message,
};
use super::spawn_ops::{create_agent_session, CreateAgentSessionRequest};
use super::tools::{
    canonical_tool_name, is_spawn_style_tool, ChildSessionArgs, CloseAgentArgs, ConfigureAgentArgs,
    CreateSubagentArgs, GetAgentConfigOptionsArgs, ListAgentsArgs, PromoteSubagentArgs,
    ReadAgentTranscriptArgs, ReadAgentTranscriptMode, ReadSubagentEventsArgs,
    ReadSubagentLatestTurnsArgs, ScheduleAgentWakeArgs, SearchSubagentTranscriptArgs,
    SendAgentMessageArgs, SendSubagentMessageArgs, SpawnAgentArgs, SpawnWorkspaceArgs,
};
use super::workspace_ops;
use super::{AgentOpsPeerGates, AgentOpsWorkspaceOps};
use crate::domains::sessions::admission::SessionMutationKind;
use crate::domains::sessions::authorize::{authorize, AgentAccessIntent};
use crate::domains::sessions::ownership::service::{AgentOwnershipService, OwnedAgent};
use crate::domains::sessions::delegation::{
    parent_to_child_provenance, READ_EVENTS_DEFAULT_LIMIT, READ_EVENTS_MAX_LIMIT,
};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::store::agent_wakes::AgentWakeReason;
use crate::domains::sessions::store::{
    SessionSearchCursor, SessionSearchQuery, SESSION_SEARCH_DEFAULT_LIMIT, SESSION_SEARCH_MAX_LIMIT,
};
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::sessions::transcript_read::{
    read_session_events, read_session_latest_turns, search_session_transcript,
};
use crate::domains::sessions::wakes::service::AgentWakeService;
use crate::domains::workspaces::model::WorkspaceSurface;
use crate::integrations::mcp::json_rpc::deserialize_args;

#[allow(clippy::too_many_arguments)]
pub async fn call_tool(
    service: &SubagentService,
    wake_service: &AgentWakeService,
    session_runtime: &SessionRuntime,
    ownership: &AgentOwnershipService,
    gates: &AgentOpsPeerGates,
    workspaces: &AgentOpsWorkspaceOps,
    ctx: &AgentOpsMcpContext,
    name: &str,
    arguments: Option<Value>,
) -> anyhow::Result<Value> {
    // The spawn gate, at dispatch. `tools/list` also hides these, but that list
    // is baked into a session at launch: a subagent launched before promotion
    // holds a stale list forever, and one promoted afterwards holds a list that
    // never showed them. Only this check runs against the caller's state at the
    // moment it acts, so this — not the advertisement — is the gate. The wire
    // name is matched, not the canonical one, so the deprecated `create_subagent`
    // spelling cannot walk around it.
    if ctx.is_unpromoted_subagent && is_spawn_style_tool(name) {
        return Err(anyhow::anyhow!(
            "{name} is not available to a subagent. You are running as another agent's subagent, \
             so you cannot spawn agents of your own; ask the agent that spawned you to promote \
             you, or to spawn what you need."
        ));
    }

    match canonical_tool_name(name) {
        "get_subagent_launch_options" => get_subagent_launch_options(service, session_runtime, ctx),
        "spawn_subagent" => {
            let args: CreateSubagentArgs = deserialize_args(arguments)?;
            spawn_subagent(service, ownership, wake_service, session_runtime, ctx, args).await
        }
        "spawn_agent" => {
            let args: SpawnAgentArgs = deserialize_args(arguments)?;
            spawn_agent(
                service,
                ownership,
                wake_service,
                session_runtime,
                gates,
                workspaces,
                ctx,
                args,
            )
            .await
        }
        "get_workspace_options" => {
            let caller = caller_session(service, &ctx.parent_session_id)?;
            workspace_ops::get_workspace_options(
                &workspaces.workspace_runtime,
                &workspaces.repo_roots,
                &caller,
            )
        }
        "spawn_workspace" => {
            let args: SpawnWorkspaceArgs = deserialize_args(arguments)?;
            spawn_workspace(service, workspaces, ctx, args).await
        }
        "list_subagents" => service
            .list_subagents(&ctx.parent_session_id)
            .map(|summaries| json!({ "subagents": summaries_to_json(summaries) }))
            .map_err(anyhow::Error::from),
        "send_subagent_message" => {
            let args: SendSubagentMessageArgs = deserialize_args(arguments)?;
            send_subagent_message(service, session_runtime, &ctx.parent_session_id, args).await
        }
        "list_agents" => {
            let args: ListAgentsArgs = deserialize_args(arguments)?;
            list_agents(service, &ctx.parent_session_id, args)
        }
        "send_agent_message" => {
            let args: SendAgentMessageArgs = deserialize_args(arguments)?;
            send_agent_message(service, wake_service, session_runtime, gates, ctx, args).await
        }
        "read_agent_transcript" => {
            let args: ReadAgentTranscriptArgs = deserialize_args(arguments)?;
            read_agent_transcript(service, &ctx.parent_session_id, args)
        }
        "schedule_agent_wake" => {
            let args: ScheduleAgentWakeArgs = deserialize_args(arguments)?;
            schedule_agent_wake(wake_service, &ctx.parent_session_id, args)
        }
        "get_agent_config_options" => {
            let args: GetAgentConfigOptionsArgs = deserialize_args(arguments)?;
            get_agent_config_options(service, session_runtime, &ctx.parent_session_id, args)
        }
        "configure_agent" => {
            let args: ConfigureAgentArgs = deserialize_args(arguments)?;
            configure_agent(service, session_runtime, gates, ctx, args).await
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
        "promote_subagent" => {
            let args: PromoteSubagentArgs = deserialize_args(arguments)?;
            promote_subagent(ownership, ctx, args)
        }
        "close_agent" => {
            let args: CloseAgentArgs = deserialize_args(arguments)?;
            close_agent(service, session_runtime, ownership, gates, ctx, args).await
        }
        _ => Err(anyhow::anyhow!("unknown tool: {name}")),
    }
}

fn get_subagent_launch_options(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    ctx: &AgentOpsMcpContext,
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
            "If harnessId or initialConfig.modelId/modeId are omitted, spawn_subagent inherits the current parent session values when available.",
            "harnessId and initialConfig.modelId are validated against the launch catalog before the child session is created.",
            "initialConfig.modeId is currently a launch hint stored on the child session; available mode options can only be inferred from the parent session's live config snapshot.",
            "Subagents are same-workspace normal sessions. They cannot create grandchildren and do not inherit the parent's external/user MCP bindings; product MCPs like agent ops are mounted independently on every session, not inherited.",
            "Completions are passive by default. Pass wakeOnCompletion or call schedule_subagent_wake when you want to be prompted after the child's next completed turn."
        ]
    }))
}

async fn spawn_subagent(
    service: &SubagentService,
    ownership: &AgentOwnershipService,
    wake_service: &AgentWakeService,
    session_runtime: &SessionRuntime,
    ctx: &AgentOpsMcpContext,
    args: CreateSubagentArgs,
) -> anyhow::Result<Value> {
    if !ctx.can_create {
        anyhow::bail!(
            "{}",
            ctx.create_block_reason
                .as_deref()
                .unwrap_or("subagent creation is not available for this session")
        );
    }
    let parent = service.validate_parent_can_spawn(&ctx.parent_session_id)?;
    let request = CreateAgentSessionRequest::subagent(&parent, args)?;
    let wake_requested = request.wake_on_completion;
    let created = create_agent_session(
        service,
        ownership,
        wake_service,
        session_runtime,
        &parent,
        request,
    )
    .await?;
    let applied = applied_initial_config(&created.session);

    Ok(json!({
        "sessionLinkId": created.link.id,
        "subagentId": created.link.public_id,
        "childSessionId": created.session.id,
        "label": created.link.label,
        "appliedInitialConfig": applied,
        "wake": {
            "scheduled": wake_requested,
            "created": created.wake_created,
            "scope": if wake_requested { Some("next_completion") } else { None::<&str> },
        },
        "wakeScheduled": wake_requested,
        "wakeScheduleCreated": created.wake_created,
        "wakeScope": if wake_requested { Some("next_completion") } else { None::<&str> },
        "promptStatus": prompt_outcome_label(&created.prompt_outcome),
        "readCursor": { "sinceSeq": 0 },
    }))
}

/// Create a PEER agent the caller owns (ADR §3.4).
///
/// The same routine `spawn_subagent` uses, in `Owned` mode — which is the whole
/// of the difference. What is NOT here is as important as what is: no fanout
/// cap and no depth rule, because ruling 9 puts no numeric limit on owned
/// agents and a peer is not subordinate to anything. What IS here is ruling 3's
/// spawn block, enforced before dispatch reaches this function, and the
/// caller's own workspace being writable.
///
/// Since `spawn_workspace`, `workspaceId` may name any workspace — that is the
/// second step of ADR §5's flow 4. That changes the fencing: the session lands
/// in the TARGET workspace, so it is the TARGET's write lease this takes, in
/// the call, exactly as `send_agent_message` and `configure_agent` do (and why
/// this tool left `MUTATING_TOOL_NAMES`; the route's lease is the CALLER's).
/// There is still no target SESSION — this call is what creates it — so there
/// is no admission permit to take, and with a single lease and no permit there
/// is no lock order to invert (PR1227-LOCK-01).
#[allow(clippy::too_many_arguments)]
async fn spawn_agent(
    service: &SubagentService,
    ownership: &AgentOwnershipService,
    wake_service: &AgentWakeService,
    session_runtime: &SessionRuntime,
    gates: &AgentOpsPeerGates,
    workspaces: &AgentOpsWorkspaceOps,
    ctx: &AgentOpsMcpContext,
    args: SpawnAgentArgs,
) -> anyhow::Result<Value> {
    if !ctx.can_spawn_agent {
        anyhow::bail!(
            "{}",
            ctx.spawn_agent_block_reason
                .as_deref()
                .unwrap_or("spawning agents is not available for this session")
        );
    }
    let caller = service.validate_caller_can_spawn_agent(&ctx.parent_session_id)?;
    let request = CreateAgentSessionRequest::owned_agent(&caller, args)?;
    if request.is_cross_workspace(&caller) {
        // Worth a line of its own: this is the one call that reaches out of the
        // caller's workspace, and the lease taken below is that OTHER
        // workspace's. When a retire preflight blocks, this says who was in it.
        tracing::info!(
            caller_session_id = %caller.id,
            caller_workspace_id = %caller.workspace_id,
            target_workspace_id = %request.workspace_id,
            "spawn_agent creating a peer in another workspace"
        );
    }
    // Read-only up to here. A target workspace that does not exist or is not a
    // standard one is refused before any gate is taken.
    assert_spawnable_workspace(&workspaces.workspace_runtime, &request.workspace_id)?;
    let wake_requested = request.wake_on_completion;
    // The caller's own workspace still has to be writable — the route stopped
    // checking when this tool left `MUTATING_TOOL_NAMES`. No lease on it:
    // nothing here mutates the caller's workspace.
    assert_workspace_can_be_mutated(service.access_gate(), &ctx.workspace_id)?;
    // The TARGET workspace's write lease, held across creation, start and the
    // first prompt. It is that workspace's retire preflight that has to see a
    // session being built inside it.
    let _target_workspace_lease = lease_target_workspace_for_peer_write(
        &gates.workspace_operation_gate,
        service.access_gate(),
        &request.workspace_id,
    )
    .await?;
    let created = create_agent_session(
        service,
        ownership,
        wake_service,
        session_runtime,
        &caller,
        request,
    )
    .await?;
    let applied = applied_initial_config(&created.session);

    Ok(json!({
        // `sessionId` is the handle for everything afterwards: this agent is a
        // peer, so it is addressed the way `list_agents` addresses one.
        "sessionId": created.session.id,
        "workspaceId": created.session.workspace_id,
        "label": created.link.label,
        // The ownership handle, for the subagent-vocabulary form of
        // `close_agent`. `sessionId` works there too.
        "agentId": created.link.public_id,
        "ownership": "owned_agent",
        "appliedInitialConfig": applied,
        "wake": {
            "scheduled": wake_requested,
            "created": created.wake_created,
            "scope": if wake_requested { Some("next_turn_finish") } else { None::<&str> },
        },
        "promptStatus": prompt_outcome_label(&created.prompt_outcome),
    }))
}

/// What the new agent actually launched with, read off the row that exists
/// rather than off the request.
///
/// The two can differ: the shared routine resolves the launch selection against
/// the TARGET workspace's catalog first, and an inherited model that workspace
/// does not offer is replaced by its default there. Reporting the request would
/// tell the caller it got something it did not.
fn applied_initial_config(session: &crate::domains::sessions::model::SessionRecord) -> Value {
    json!({
        "harnessId": session.agent_kind,
        "modelId": session
            .current_model_id
            .clone()
            .or_else(|| session.requested_model_id.clone()),
        "modeId": session
            .current_mode_id
            .clone()
            .or_else(|| session.requested_mode_id.clone()),
    })
}

/// The caller's own session row, for the tools that need it beyond the id.
fn caller_session(
    service: &SubagentService,
    caller_session_id: &str,
) -> anyhow::Result<crate::domains::sessions::model::SessionRecord> {
    service
        .session_store()
        .find_by_id(caller_session_id)?
        .ok_or_else(|| anyhow::anyhow!("calling session not found: {caller_session_id}"))
}

/// A workspace an agent may be put into: it has to exist and be a standard
/// workspace, the same eligibility `validate_caller_can_create` applies to the
/// caller's own. Whether it may be MUTATED right now is the access gate's
/// question, asked when the lease is taken.
fn assert_spawnable_workspace(
    workspace_runtime: &crate::domains::workspaces::runtime::WorkspaceRuntime,
    workspace_id: &str,
) -> anyhow::Result<()> {
    let workspace = workspace_runtime
        .get_workspace(workspace_id)?
        .ok_or_else(|| {
            anyhow::anyhow!(
                "workspace {workspace_id} does not exist. Use list_agents or spawn_workspace to \
                 get a workspaceId you can spawn into."
            )
        })?;
    if workspace.surface != WorkspaceSurface::Standard {
        anyhow::bail!(
            "workspace {workspace_id} is not a standard workspace; agents cannot be spawned in it"
        );
    }
    Ok(())
}

/// `spawn_workspace` (ADR §3.4, §6 step 7).
///
/// Eligibility is the same `can_spawn_agent` signal a peer spawn uses — ADR
/// §3.4 marks this "promoted / top level agents only", and ruling 3's block on
/// unpromoted subagents is enforced at dispatch, before this runs.
async fn spawn_workspace(
    service: &SubagentService,
    workspaces: &AgentOpsWorkspaceOps,
    ctx: &AgentOpsMcpContext,
    args: SpawnWorkspaceArgs,
) -> anyhow::Result<Value> {
    if !ctx.can_spawn_agent {
        anyhow::bail!(
            "{}",
            ctx.spawn_agent_block_reason
                .as_deref()
                .unwrap_or("spawning workspaces is not available for this session")
        );
    }
    let caller = caller_session(service, &ctx.parent_session_id)?;
    workspace_ops::spawn_workspace(
        &workspaces.workspace_runtime,
        &workspaces.worktree_runtime,
        &workspaces.repo_roots,
        service.access_gate(),
        &caller,
        args,
    )
    .await
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
    let link = service.authorize_target(parent_session_id, args.subagent_id.as_deref(), None)?;
    authorize(
        service.session_store(),
        parent_session_id,
        &link.child_session_id,
        AgentAccessIntent::Send,
    )?;
    // The same refusal the peer send makes: a child whose end has been
    // requested is finishing one last step and will never run another prompt.
    // This is the tool a PARENT uses on its own child, which is exactly the
    // agent most likely to be end-requested.
    assert_target_still_takes_messages(service.link_service(), &link.child_session_id)?;
    let wake_scheduled = if args.wake_on_completion {
        service
            .schedule_wake_for_target(parent_session_id, args.subagent_id.as_deref(), None)?
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

fn list_agents(
    service: &SubagentService,
    caller_session_id: &str,
    args: ListAgentsArgs,
) -> anyhow::Result<Value> {
    let decoded_cursor = match args.cursor.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(token) => Some(SessionSearchCursor::decode(token).ok_or_else(|| {
            anyhow::anyhow!(
                "cursor is malformed: pass the nextCursor value from the previous \
                 list_agents response unchanged"
            )
        })?),
        None => None,
    };
    let limit = args
        .limit
        .unwrap_or(SESSION_SEARCH_DEFAULT_LIMIT)
        .clamp(1, SESSION_SEARCH_MAX_LIMIT);
    let sessions = service.session_store().search_sessions(&SessionSearchQuery {
        session_id: args.session_id.as_deref(),
        text: args.query.as_deref(),
        workspace_id: args.workspace_id.as_deref(),
        include_closed: args.include_closed,
        cursor: decoded_cursor
            .as_ref()
            .map(|(updated_at, id)| SessionSearchCursor {
                updated_at,
                id,
            }),
        limit,
    })?;

    // A full page may or may not have more behind it; handing back a cursor
    // costs one extra empty call at worst, and dropping it would silently lose
    // rows.
    let next_cursor = (sessions.len() == limit)
        .then(|| sessions.last())
        .flatten()
        .map(|session| {
            SessionSearchCursor {
                updated_at: &session.updated_at,
                id: &session.id,
            }
            .encode()
        });

    // A linked subagent is best known by the label its parent gave it; a top
    // level session by its own title. One query for the page, not one per row.
    let session_ids = sessions
        .iter()
        .map(|session| session.id.clone())
        .collect::<Vec<_>>();
    let mut link_labels = service
        .find_subagent_parents(&session_ids)?
        .into_iter()
        .filter_map(|link| {
            let label = link.label?;
            Some((link.child_session_id, label))
        })
        .collect::<HashMap<String, String>>();

    let mut agents = Vec::with_capacity(sessions.len());
    for session in sessions {
        let link_label = link_labels.remove(&session.id);
        agents.push(json!({
            "sessionId": session.id,
            "label": link_label.clone().or_else(|| session.title.clone()),
            "title": session.title,
            "subagentLabel": link_label,
            "workspaceId": session.workspace_id,
            "agentKind": session.agent_kind,
            "status": session.status,
            "closed": session.closed_at.is_some(),
            "closedAt": session.closed_at,
            "isCaller": session.id == caller_session_id,
            "createdAt": session.created_at,
            "updatedAt": session.updated_at,
        }));
    }
    Ok(json!({
        "agents": agents,
        "nextCursor": next_cursor,
    }))
}

async fn send_agent_message(
    service: &SubagentService,
    wake_service: &AgentWakeService,
    session_runtime: &SessionRuntime,
    gates: &AgentOpsPeerGates,
    ctx: &AgentOpsMcpContext,
    args: SendAgentMessageArgs,
) -> anyhow::Result<Value> {
    let prepared = prepare_agent_message(
        service.session_store(),
        service.link_service(),
        &ctx.parent_session_id,
        args.session_id.trim(),
        &args.message,
    )?;
    let caller_session_id = ctx.parent_session_id.as_str();
    // The caller's own workspace still has to be writable — the route used to
    // check this for us, and stopped once this tool started taking its own
    // leases (see `lease_target_workspace_for_peer_write`). No lease: nothing here
    // mutates the caller's workspace.
    assert_workspace_can_be_mutated(service.access_gate(), &ctx.workspace_id)?;
    // Canonical lock order, and the reason this tool is absent from
    // `MUTATING_TOOL_NAMES`: session mutation permit FIRST, then the target
    // workspace's write lease. Both are held across the dispatch below.
    let _admission_permit = admit_peer_mutation(
        &gates.session_admission,
        &prepared.target.id,
        SessionMutationKind::Prompt,
    )
    .await?;
    let _target_workspace_lease = lease_target_workspace_for_peer_write(
        &gates.workspace_operation_gate,
        service.access_gate(),
        &prepared.target.workspace_id,
    )
    .await?;
    // Armed BEFORE the send but AFTER the gates: the target may already be
    // mid-turn, and a schedule that exists when that turn finishes fires at its
    // end (ruling 10) — arming after the send would leave a window where the
    // answer-less turn ends first. A send the fence rejects must not leave a
    // schedule behind, so the gates come first.
    let wake_created = if args.wake_on_reply {
        wake_service
            .arm(
                caller_session_id,
                &prepared.target.id,
                AgentWakeReason::Reply,
            )?
            .created
    } else {
        false
    };
    // From here it is the ordinary prompt path: running targets queue, idle
    // ones boot. Nothing about an agent-sourced prompt is special to the queue.
    let outcome = match session_runtime
        .send_text_prompt_with_provenance(
            &prepared.target.id,
            prepared.text.clone(),
            prepared.provenance,
        )
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            // Compensation is by ROW STATE, not by "this call created it". A
            // parallel send to the same target reuses the same row (the pair is
            // the primary key), so `created` says nothing about whether another
            // send that LANDED now depends on the schedule. Only an unconfirmed
            // reply arm is taken away.
            if args.wake_on_reply {
                cleanup_agent_wake_after_failed_dispatch(
                    wake_service,
                    caller_session_id,
                    &prepared.target.id,
                );
            }
            return Err(anyhow::anyhow!("{error:?}"));
        }
    };
    // The send landed, so the schedule is now owed to this caller: confirm it
    // before any other in-flight send can compensate the shared row away.
    if args.wake_on_reply {
        confirm_agent_wake_after_dispatch(wake_service, caller_session_id, &prepared.target.id);
    }
    // The message just delivered content to the target. If the target was
    // waiting on this caller, that IS its wake.
    let consumed_reply_wake =
        consume_reply_wake(wake_service, caller_session_id, &prepared.target.id);
    Ok(json!({
        "sessionId": prepared.target.id,
        "workspaceId": prepared.target.workspace_id,
        "title": prepared.target.title,
        "senderLabel": prepared.sender_label,
        "deliveredText": prepared.text,
        "status": prompt_outcome_label(&outcome),
        "wake": {
            "scheduled": args.wake_on_reply,
            "created": wake_created,
            "scope": if args.wake_on_reply { Some("next_turn_finish") } else { None::<&str> },
        },
        "consumedPendingWake": consumed_reply_wake,
    }))
}

/// Undo a `wakeOnReply` arm whose send then failed — and ONLY while no landed
/// send relies on the row. Two sends to the same target share one schedule, so
/// an unconditional delete here would take away the wake a parallel, successful
/// send owes its watcher.
fn cleanup_agent_wake_after_failed_dispatch(
    wake_service: &AgentWakeService,
    watcher_session_id: &str,
    target_session_id: &str,
) {
    if let Err(error) =
        wake_service.discard_unconfirmed_reply_arm(watcher_session_id, target_session_id)
    {
        tracing::warn!(
            watcher_session_id,
            target_session_id,
            error = ?error,
            "failed to clean up an agent wake schedule after dispatch failure"
        );
    }
}

/// Stamp the schedule as relied upon by a landed send. Best-effort: losing this
/// write only re-opens the narrow window where a parallel failing send could
/// compensate the row away, which the caller can re-arm.
fn confirm_agent_wake_after_dispatch(
    wake_service: &AgentWakeService,
    watcher_session_id: &str,
    target_session_id: &str,
) {
    if let Err(error) =
        wake_service.confirm_reply_arm_dispatch(watcher_session_id, target_session_id)
    {
        tracing::warn!(
            watcher_session_id,
            target_session_id,
            error = ?error,
            "failed to confirm an agent wake schedule after a landed dispatch"
        );
    }
}

fn schedule_agent_wake(
    wake_service: &AgentWakeService,
    caller_session_id: &str,
    args: ScheduleAgentWakeArgs,
) -> anyhow::Result<Value> {
    let armed = wake_service.arm(
        caller_session_id,
        args.session_id.trim(),
        AgentWakeReason::ExplicitSchedule,
    )?;
    // Liveness, said out loud. The schedule fires at the end of the target's
    // next FINISHED turn: if one is running it covers that turn (ruling 10), but
    // an idle target that nobody prompts finishes nothing and fires nothing. The
    // caller has to be able to see that and send a message instead, so the
    // target's live status is part of the result rather than something it has to
    // infer from silence.
    let target_running = armed.target.status == "running";
    Ok(json!({
        "sessionId": armed.target.id,
        "workspaceId": armed.target.workspace_id,
        "title": armed.target.title,
        "watcherSessionId": armed.watcher_session_id,
        "scheduled": true,
        "alreadyScheduled": !armed.created,
        "wakeScope": "next_turn_finish",
        "targetStatus": armed.target.status,
        "targetRunning": target_running,
        "firesWhen": if target_running {
            "the turn already running finishes"
        } else {
            "the target's next turn finishes — it is idle now, so nothing fires until someone prompts it"
        },
    }))
}

fn get_agent_config_options(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    caller_session_id: &str,
    args: GetAgentConfigOptionsArgs,
) -> anyhow::Result<Value> {
    let composed = compose_agent_config_options(
        service.session_store(),
        caller_session_id,
        args.session_id.trim(),
        // The TARGET's workspace, always: its catalog, readiness and auth
        // contexts decide what it may run, and they need not match the
        // caller's.
        |workspace_id| session_runtime.resolved_workspace_launch_options(workspace_id),
        |session_id| session_runtime.live_config_snapshot(session_id),
    )?;
    Ok(json!({
        "sessionId": composed.target.id,
        "workspaceId": composed.target.workspace_id,
        "title": composed.target.title,
        "agentKind": composed.target.agent_kind,
        "status": composed.target.status,
        "optionsWorkspaceId": composed.catalog_workspace_id,
        "current": current_selection_to_json(&composed.target),
        "configurable": controls_to_json(&composed.controls),
        // The human client's exact live-config contract, verbatim: same
        // rawConfigOptions / normalizedControls an operator sees.
        "liveConfig": composed.live_config,
        "notes": [
            "Pass a configId and one of its values to configure_agent.",
            "source=live means the agent's harness is advertising that value right now; source=workspace_catalog means the target's workspace authorizes it and applying may relaunch the agent to reach it.",
            "A target that has never run reports no liveConfig; its model options still come from its workspace catalog.",
        ],
    }))
}

async fn configure_agent(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    gates: &AgentOpsPeerGates,
    ctx: &AgentOpsMcpContext,
    args: ConfigureAgentArgs,
) -> anyhow::Result<Value> {
    // Read-only up to here: authorize, compose the target's universe, validate.
    // A refusal costs no permit and no lease.
    let prepared = prepare_agent_config_change(
        service.session_store(),
        &ctx.parent_session_id,
        args.session_id.trim(),
        &args.config_id,
        &args.value,
        |workspace_id| session_runtime.resolved_workspace_launch_options(workspace_id),
        |session_id| session_runtime.live_config_snapshot(session_id),
    )?;
    // The caller's own workspace still has to be writable, exactly as for
    // `send_agent_message`: the route stopped checking once this tool left
    // `MUTATING_TOOL_NAMES`. No lease — nothing here mutates it.
    assert_workspace_can_be_mutated(service.access_gate(), &ctx.workspace_id)?;
    // Canonical lock order, and the reason this tool is absent from
    // `MUTATING_TOOL_NAMES`: the TARGET's session mutation permit FIRST — a
    // workflow-controlled agent refuses a foreign config change before any
    // side effect — then the TARGET workspace's write lease, which is the one
    // whose retire preflight has to see this work.
    let _admission_permit = admit_peer_mutation(
        &gates.session_admission,
        &prepared.target.id,
        SessionMutationKind::Config,
    )
    .await?;
    let _target_workspace_lease = lease_target_workspace_for_peer_write(
        &gates.workspace_operation_gate,
        service.access_gate(),
        &prepared.target.workspace_id,
    )
    .await?;
    // The existing apply path, unchanged: it boots an idle target, queues
    // behind an active turn, and persists requested_*/current_* so a relaunch
    // converges on the new selection.
    let (session, live_config, apply_state) = session_runtime
        .set_live_session_config_option(&prepared.target.id, &prepared.config_id, &prepared.value)
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    Ok(json!({
        "sessionId": session.id,
        "workspaceId": session.workspace_id,
        "title": session.title,
        "configId": prepared.config_id,
        "value": prepared.value,
        "applyState": serde_json::to_value(&apply_state)?,
        "queued": matches!(apply_state, ConfigApplyState::Queued),
        "current": current_selection_to_json(&session),
        "liveConfig": live_config,
    }))
}

fn read_agent_transcript(
    service: &SubagentService,
    caller_session_id: &str,
    args: ReadAgentTranscriptArgs,
) -> anyhow::Result<Value> {
    let store = service.session_store();
    let target = authorize_transcript_read(store, caller_session_id, args.session_id.trim())?;
    match args.mode {
        ReadAgentTranscriptMode::LatestTurns => {
            let turns = read_session_latest_turns(store, &target.id, args.limit)?;
            Ok(json!({
                "sessionId": target.id,
                "mode": "latest_turns",
                "turns": turns.into_iter().map(|turn| json!({
                    "turnId": turn.turn_id,
                    "outcome": turn.outcome,
                    "stopReason": turn.stop_reason,
                    "startedAt": turn.started_at,
                    "lastEventSeq": turn.last_event_seq,
                    "assistantText": turn.assistant_text,
                    "toolErrors": turn.tool_errors,
                    "eventCount": turn.event_count,
                })).collect::<Vec<_>>(),
            }))
        }
        ReadAgentTranscriptMode::Search => {
            let query = args
                .query
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("query is required when mode is search"))?;
            let matches = search_session_transcript(store, &target.id, query, args.limit)?;
            Ok(json!({
                "sessionId": target.id,
                "mode": "search",
                "query": query,
                "matches": matches.into_iter().map(|entry| json!({
                    "seq": entry.seq,
                    "timestamp": entry.timestamp,
                    "turnId": entry.turn_id,
                    "itemId": entry.item_id,
                    "snippet": entry.snippet,
                })).collect::<Vec<_>>(),
            }))
        }
        ReadAgentTranscriptMode::Events => {
            let slice = read_session_events(store, &target.id, args.since_seq, args.limit)?;
            Ok(json!({
                "sessionId": slice.session_id,
                "mode": "events",
                "events": slice.events,
                "nextSinceSeq": slice.next_since_seq,
                "truncated": slice.truncated,
            }))
        }
    }
}

fn schedule_subagent_wake(
    service: &SubagentService,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    let (link, inserted) =
        service.schedule_wake_for_target(parent_session_id, args.subagent_id.as_deref(), None)?;
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
    let session = authorize(
        service.session_store(),
        parent_session_id,
        &link.child_session_id,
        AgentAccessIntent::Read,
    )?
    .target;
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

/// Promote one of the caller's subagents to a peer.
///
/// Ownership, not reachability, so it resolves an ownership ROW rather than
/// going through `authorize` — the runtime-wide funnel deliberately answers a
/// different question (who may I reach), and every agent may reach every other
/// one. Only the parent that spawned this child can promote it.
///
/// One indexed UPDATE against a link row in the caller's own workspace, and no
/// session actor is touched, so this takes the route's workspace lease
/// (`MUTATING_TOOL_NAMES`) and no session mutation permit: there is no session
/// mutation to admit.
fn promote_subagent(
    ownership: &AgentOwnershipService,
    ctx: &AgentOpsMcpContext,
    args: PromoteSubagentArgs,
) -> anyhow::Result<Value> {
    let owned = ownership.resolve_owned(
        &ctx.parent_session_id,
        args.subagent_id.as_deref(),
        args.session_id.as_deref(),
    )?;
    let outcome = ownership.promote(&owned)?;
    Ok(json!({
        "subagentId": outcome.link.public_id,
        "sessionLinkId": outcome.link.id,
        "sessionId": outcome.link.child_session_id,
        "label": outcome.link.label,
        "promoted": true,
        "alreadyPromoted": outcome.already_promoted,
        "promotedAt": outcome.promoted_at,
        // The two consequences the calling agent has to reason about, stated
        // rather than implied: it is off the cascade, and off the fanout cap.
        "closesWithYou": false,
        "countsAgainstSubagentLimit": false,
    }))
}

/// Close an agent the caller owns.
///
/// Generalizes the old link-scoped `close_subagent`: same close tree underneath,
/// but the target is resolved through ownership and may be an agent in another
/// workspace, so this takes its own fence instead of the route's — the TARGET's
/// session mutation permit FIRST, then the TARGET workspace's write lease
/// (PR1227-LOCK-01). A close is the most destructive session mutation there is,
/// so skipping the permit would let it run straight through a workflow that has
/// taken control of that session.
///
/// Soft close (ADR §4): a target that is mid-turn is not interrupted. The
/// attribution stamp on the still-open ownership row IS the durable request,
/// and `ownership::hooks` completes it when that turn finishes.
async fn close_agent(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    ownership: &AgentOwnershipService,
    gates: &AgentOpsPeerGates,
    ctx: &AgentOpsMcpContext,
    args: CloseAgentArgs,
) -> anyhow::Result<Value> {
    let owned = ownership.resolve_owned(
        &ctx.parent_session_id,
        args.subagent_id.as_deref(),
        args.session_id.as_deref(),
    )?;
    let reason = args
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty());

    // Already closed: idempotent, and the FIRST close's attribution is what the
    // row keeps. Return before any gate — there is nothing left to admit.
    if owned.link.closed_at.is_some() || owned.target.closed_at.is_some() {
        let settled = ownership.reload_link(&owned.link)?;
        return Ok(close_result(&owned, &settled, false));
    }

    // The caller's own workspace still has to be writable — the route stopped
    // checking when this tool left `MUTATING_TOOL_NAMES`.
    assert_workspace_can_be_mutated(service.access_gate(), &ctx.workspace_id)?;
    let _admission_permit = admit_peer_mutation(
        &gates.session_admission,
        &owned.target.id,
        SessionMutationKind::Close,
    )
    .await?;
    let _target_workspace_lease = lease_target_workspace_for_peer_write(
        &gates.workspace_operation_gate,
        service.access_gate(),
        &owned.target.workspace_id,
    )
    .await?;

    // Stamped under the permit, so the request cannot be armed by a call the
    // fence would have refused.
    ownership.record_close_attribution(&owned, &ctx.parent_session_id, reason)?;

    if is_mid_turn(session_runtime, &owned).await {
        // End requested. The row is stamped and open; the turn-finish hook
        // takes this same pair of gates again and finishes the job.
        let requested = ownership.reload_link(&owned.link)?;
        return Ok(close_result(&owned, &requested, true));
    }

    session_runtime
        .close_live_session(&owned.target.id)
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    // The cascade closes the inbound ownership row itself; this covers the case
    // where the row somehow outlived it, and keeps the close retryable when the
    // live close failed above (the link stays open, so does the request).
    let settled = ownership.reload_link(&owned.link)?;
    let settled = if settled.closed_at.is_none() {
        ownership.close_link(&settled, &chrono::Utc::now().to_rfc3339())?;
        ownership.reload_link(&settled)?
    } else {
        settled
    };
    Ok(close_result(&owned, &settled, false))
}

/// Whether the target is actually working right now.
///
/// Only `Running` defers. `AwaitingInteraction` is a turn that cannot finish
/// without a human answering a prompt, so "let it finish first" would mean
/// "never"; `Starting` has no turn to finish and may never emit one. Both close
/// immediately, which is also what the caller means by "stop this agent".
async fn is_mid_turn(session_runtime: &SessionRuntime, owned: &OwnedAgent) -> bool {
    matches!(
        session_runtime
            .session_execution_summary(&owned.target)
            .await
            .phase,
        anyharness_contract::v1::SessionExecutionPhase::Running
    )
}

fn close_result(
    owned: &OwnedAgent,
    settled: &crate::domains::sessions::links::model::SessionLinkRecord,
    close_requested: bool,
) -> Value {
    json!({
        "subagentId": settled.public_id,
        "sessionLinkId": settled.id,
        "sessionId": settled.child_session_id,
        // The pre-agent-ops field name, kept so a session still holding the
        // `close_subagent` tool list reads the same shape back.
        "childSessionId": settled.child_session_id,
        "label": settled.label,
        // The link OR the session: the pre-gate early return already treats
        // either one as closed, and reporting only the link would claim a stop
        // that did not happen if a repair path ever closed a link out from
        // under a living session.
        "closed": settled.closed_at.is_some() || owned.target.closed_at.is_some(),
        "closeRequested": close_requested,
        "alreadyClosed": owned.link.closed_at.is_some() || owned.target.closed_at.is_some(),
        "closedAt": settled.closed_at,
        "closedBySessionId": settled.closed_by_session_id,
        "closeReason": settled.close_reason,
        "message": if close_requested {
            "That agent is mid-step. It will finish the step it is on, then stop."
        } else {
            "That agent is closed. Its transcript stays readable."
        },
    })
}
