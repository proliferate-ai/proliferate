use serde_json::{json, Value};

use super::super::super::service::SubagentService;
use super::super::calls_helpers::{initial_config_string, prompt_outcome_label};
use super::super::context::SubagentMcpContext;
use super::super::tools::{ChildSessionArgs, CreateSubagentArgs, SendSubagentMessageArgs};
use crate::domains::sessions::admission::{
    SessionMutationAdmission, SessionMutationConflict, SessionMutationKind, SessionMutationSource,
};
use crate::domains::sessions::delegation::parent_to_child_provenance;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};

pub(super) async fn create_subagent(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    session_admission: &SessionMutationAdmission,
    operation_gate: &WorkspaceOperationGate,
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
    let _parent_permit = admit_legacy_subagent_mutation(
        session_admission,
        parent_session_id,
        SessionMutationKind::SubagentCreate,
    )
    .await?;
    let _lease = operation_gate
        .acquire_shared(&ctx.workspace_id, WorkspaceOperationKind::SubagentWrite)
        .await;
    let parent = service.validate_parent_can_spawn(parent_session_id)?;
    let prompt = args.prompt;
    if prompt.trim().is_empty() {
        anyhow::bail!("prompt is required");
    }
    let agent_kind = args.harness_id.unwrap_or_else(|| parent.agent_kind.clone());
    let model_id = initial_config_string(args.initial_config.as_ref(), &["modelId", "model"])
        .or(parent.current_model_id.clone())
        .or(parent.requested_model_id.clone());
    let mode_id = initial_config_string(args.initial_config.as_ref(), &["modeId", "mode"])
        .or(parent.current_mode_id.clone())
        .or(parent.requested_mode_id.clone());
    let label = args
        .label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let (child, link) = session_runtime
        .create_durable_subagent_session_and_link(
            &parent.workspace_id,
            &agent_kind,
            model_id.as_deref(),
            mode_id.as_deref(),
            parent_session_id,
            label.clone(),
        )
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
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

    let started = match session_runtime.start_persisted_session(&child).await {
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

pub(super) async fn send_subagent_message(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    session_admission: &SessionMutationAdmission,
    operation_gate: &WorkspaceOperationGate,
    parent_session_id: &str,
    args: SendSubagentMessageArgs,
) -> anyhow::Result<Value> {
    let prompt = args.prompt;
    if prompt.trim().is_empty() {
        anyhow::bail!("prompt is required");
    }
    let link = service.authorize_target(parent_session_id, args.subagent_id.as_deref(), None)?;
    let _permit = admit_legacy_subagent_mutation(
        session_admission,
        &link.child_session_id,
        SessionMutationKind::Prompt,
    )
    .await?;
    let _lease = operation_gate
        .acquire_shared(
            &link_workspace_id(service, &link)?,
            WorkspaceOperationKind::SubagentWrite,
        )
        .await;
    let link = service.authorize_target(parent_session_id, args.subagent_id.as_deref(), None)?;
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

pub(super) async fn schedule_subagent_wake(
    service: &SubagentService,
    session_admission: &SessionMutationAdmission,
    operation_gate: &WorkspaceOperationGate,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    let link = service.authorize_target(parent_session_id, args.subagent_id.as_deref(), None)?;
    let _permit = admit_legacy_subagent_mutation(
        session_admission,
        &link.child_session_id,
        SessionMutationKind::SubagentWake,
    )
    .await?;
    let _lease = operation_gate
        .acquire_shared(
            &link_workspace_id(service, &link)?,
            WorkspaceOperationKind::SubagentWrite,
        )
        .await;
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

pub(super) async fn close_subagent(
    service: &SubagentService,
    session_runtime: &SessionRuntime,
    session_admission: &SessionMutationAdmission,
    operation_gate: &WorkspaceOperationGate,
    parent_session_id: &str,
    args: ChildSessionArgs,
) -> anyhow::Result<Value> {
    let link = service.resolve_target_including_closed(
        parent_session_id,
        args.subagent_id.as_deref(),
        None,
    )?;
    if link.subagent_closed_at.is_some() {
        return Err(open_required());
    }
    let _permit = admit_legacy_subagent_mutation(
        session_admission,
        &link.child_session_id,
        SessionMutationKind::Close,
    )
    .await?;
    let _lease = operation_gate
        .acquire_shared(
            &link_workspace_id(service, &link)?,
            WorkspaceOperationKind::SubagentWrite,
        )
        .await;
    let link = service.resolve_target_including_closed(
        parent_session_id,
        args.subagent_id.as_deref(),
        None,
    )?;
    if link.subagent_closed_at.is_some() {
        return Err(open_required());
    }
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

fn link_workspace_id(
    service: &SubagentService,
    link: &crate::domains::sessions::links::model::SessionLinkRecord,
) -> anyhow::Result<String> {
    service
        .session_store()
        .find_by_id(&link.child_session_id)?
        .map(|session| session.workspace_id)
        .ok_or_else(|| anyhow::anyhow!("child session not found"))
}

async fn admit_legacy_subagent_mutation(
    session_admission: &SessionMutationAdmission,
    child_session_id: &str,
    kind: SessionMutationKind,
) -> anyhow::Result<crate::domains::sessions::admission::SessionMutationPermit> {
    session_admission
        .acquire(child_session_id, kind, &SessionMutationSource::external())
        .await
        .map_err(|conflict| match conflict {
            SessionMutationConflict::ControlledByWorkflow { .. } => {
                anyhow::anyhow!("session execution is controlled by an active workflow run")
            }
            SessionMutationConflict::SubagentOpenRequired => open_required(),
            SessionMutationConflict::Internal(error) => error,
        })
}

fn open_required() -> anyhow::Error {
    anyhow::Error::new(crate::domains::sessions::subagents::service::SubagentError::OpenRequired)
}
