use std::sync::Arc;

use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport, SubagentTurnCompletedPayload, SubagentTurnOutcome,
};
use uuid::Uuid;

use super::mcp_auth::SubagentMcpAuth;
use super::model::SubagentCompletionRecord;
use super::service::SubagentService;
use crate::acp::manager::AcpManager;
use crate::acp::session_actor::SessionCommand;
use crate::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras, SessionTurnFinishedContext,
    SessionTurnOutcome,
};
use crate::sessions::mcp::{SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer};
use crate::sessions::prompt::PromptPayload;
use crate::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::sessions::store::SessionStore;

#[derive(Clone)]
pub struct SubagentSessionHooks {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    mcp_auth: Arc<SubagentMcpAuth>,
    service: Arc<SubagentService>,
    acp_manager: AcpManager,
    session_store: SessionStore,
}

impl SubagentSessionHooks {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        mcp_auth: Arc<SubagentMcpAuth>,
        service: Arc<SubagentService>,
        acp_manager: AcpManager,
        session_store: SessionStore,
    ) -> Self {
        Self {
            runtime_base_url,
            runtime_bearer_token,
            mcp_auth,
            service,
            acp_manager,
            session_store,
        }
    }

    pub fn validate_capability_token(
        &self,
        token: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<bool> {
        self.mcp_auth
            .validate_capability_token(token, workspace_id, session_id)
    }

    pub fn capability_header_name(&self) -> &'static str {
        self.mcp_auth.capability_header_name()
    }
}

impl SessionExtension for SubagentSessionHooks {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        if ctx.workspace.surface != "standard" {
            return Ok(SessionLaunchExtras::default());
        }
        if !ctx.session.subagents_enabled {
            return Ok(SessionLaunchExtras::default());
        }
        if self
            .service
            .find_subagent_parent(&ctx.session.id)?
            .is_some()
        {
            return Ok(SessionLaunchExtras::default());
        }

        let capability_token = self
            .mcp_auth
            .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?;
        let url = format!(
            "{}/v1/workspaces/{}/sessions/{}/subagents/mcp",
            self.runtime_base_url, ctx.workspace.id, ctx.session.id
        );

        let mut headers = Vec::new();
        if let Some(token) = self.runtime_bearer_token.as_ref() {
            headers.push(SessionMcpHeader {
                name: "authorization".to_string(),
                value: format!("Bearer {token}"),
            });
        }
        headers.push(SessionMcpHeader {
            name: self.mcp_auth.capability_header_name().to_string(),
            value: capability_token,
        });

        tracing::info!(
            workspace_id = %ctx.workspace.id,
            session_id = %ctx.session.id,
            "injecting subagents MCP server into session launch"
        );

        Ok(SessionLaunchExtras {
            system_prompt_append: subagent_system_prompt_append(),
            mcp_servers: vec![SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: "subagents".to_string(),
                catalog_entry_id: None,
                server_name: "subagents".to_string(),
                url,
                headers,
            })],
            mcp_binding_summaries: vec![subagent_binding_summary()],
        })
    }

    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let service = self.service.clone();
        let acp_manager = self.acp_manager.clone();
        let session_store = self.session_store.clone();
        tokio::spawn(async move {
            if let Err(error) =
                deliver_subagent_completion(service, acp_manager, session_store, ctx).await
            {
                tracing::warn!(error = %error, "failed to process subagent completion");
            }
        });
    }
}

async fn deliver_subagent_completion(
    service: Arc<SubagentService>,
    acp_manager: AcpManager,
    session_store: SessionStore,
    ctx: SessionTurnFinishedContext,
) -> anyhow::Result<()> {
    if ctx.turn_id.trim().is_empty() {
        return Ok(());
    }
    let Some(link) = service.find_subagent_parent(&ctx.session_id)? else {
        return Ok(());
    };

    let now = chrono::Utc::now().to_rfc3339();
    let completion = SubagentCompletionRecord {
        completion_id: Uuid::new_v4().to_string(),
        session_link_id: link.id.clone(),
        child_turn_id: ctx.turn_id.clone(),
        child_last_event_seq: ctx.last_event_seq,
        outcome: ctx.outcome,
        parent_event_seq: None,
        parent_prompt_seq: None,
        created_at: now.clone(),
        updated_at: now,
    };
    let prompt = wake_prompt_text(
        link.label.as_deref(),
        &link.child_session_id,
        &link.id,
        ctx.outcome,
        ctx.last_event_seq,
    );
    let prompt_payload =
        PromptPayload::text(prompt).with_provenance(SubagentService::wake_prompt_provenance(
            &link.id,
            &completion.completion_id,
            link.label.clone(),
        ));
    let Some(inserted) = service.insert_completion_and_consume_schedule(
        &completion,
        &link.parent_session_id,
        &prompt_payload,
    )?
    else {
        return Ok(());
    };

    let payload = SubagentTurnCompletedPayload {
        completion_id: inserted.completion.completion_id.clone(),
        session_link_id: link.id.clone(),
        parent_session_id: link.parent_session_id.clone(),
        child_session_id: link.child_session_id.clone(),
        child_turn_id: ctx.turn_id.clone(),
        child_last_event_seq: ctx.last_event_seq,
        outcome: to_contract_outcome(ctx.outcome),
        label: link.label.clone(),
    };
    match acp_manager
        .emit_runtime_event(
            &link.parent_session_id,
            session_store.clone(),
            RuntimeInjectedSessionEvent::SubagentTurnCompleted(payload),
        )
        .await
    {
        Ok(envelope) => {
            let _ = service.mark_parent_event_seq(&inserted.completion.completion_id, envelope.seq);
        }
        Err(error) => {
            tracing::warn!(
                parent_session_id = %link.parent_session_id,
                child_session_id = %link.child_session_id,
                completion_id = %inserted.completion.completion_id,
                error = %error,
                "failed to inject subagent turn event"
            );
        }
    }

    if let (Some(record), Some(handle)) = (
        inserted.wake_prompt.as_ref(),
        acp_manager.get_handle(&link.parent_session_id).await,
    ) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .command_tx
            .send(SessionCommand::Prompt {
                payload: prompt_payload,
                prompt_id: None,
                latency: None,
                from_queue_seq: Some(record.seq),
                respond_to: tx,
            })
            .await?;
        let _ = rx.await?.map_err(|error| anyhow::anyhow!("{error:?}"))?;
    }
    Ok(())
}

fn to_contract_outcome(outcome: SessionTurnOutcome) -> SubagentTurnOutcome {
    match outcome {
        SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
        SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
        SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
    }
}

fn wake_prompt_text(
    label: Option<&str>,
    child_session_id: &str,
    session_link_id: &str,
    outcome: SessionTurnOutcome,
    child_last_event_seq: i64,
) -> String {
    let label = label.unwrap_or("subagent");
    format!(
        "Subagent \"{label}\" completed a turn.\n\nChild session: {child_session_id}\nSession link: {session_link_id}\nOutcome: {}\nLast child event seq: {child_last_event_seq}\n\nUse the subagent tools to inspect the child session before continuing.",
        outcome.as_str()
    )
}

fn subagent_system_prompt_append() -> Vec<String> {
    vec![r#"You can use the subagents MCP tools to delegate bounded work to same-workspace child sessions. Call get_subagent_launch_options before choosing a non-default agentKind, modelId, or modeId. Child sessions are normal agent sessions linked back to you. Child completions are passive by default: use wakeOnCompletion when creating or messaging a child, or call schedule_subagent_wake for an already-running child, when you want AnyHarness to prompt you after that child's next completed turn. Use read_subagent_events before relying on a child result."#.to_string()]
}

fn subagent_binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: "internal:subagents".to_string(),
        server_name: "subagents".to_string(),
        display_name: Some("Subagents".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}
