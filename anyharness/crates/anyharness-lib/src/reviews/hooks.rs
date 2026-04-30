use std::sync::Arc;

use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport,
};

use super::mcp_auth::ReviewMcpAuth;
use crate::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras, SessionTurnFinishedContext,
};
use crate::sessions::mcp::{SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer};

#[derive(Clone)]
pub struct ReviewSessionHooks {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    mcp_auth: Arc<ReviewMcpAuth>,
    event_tx: tokio::sync::mpsc::Sender<ReviewHookEvent>,
}

#[derive(Debug, Clone)]
pub enum ReviewHookEvent {
    TurnFinished(SessionTurnFinishedContext),
}

impl ReviewSessionHooks {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        mcp_auth: Arc<ReviewMcpAuth>,
        event_tx: tokio::sync::mpsc::Sender<ReviewHookEvent>,
    ) -> Self {
        Self {
            runtime_base_url,
            runtime_bearer_token,
            mcp_auth,
            event_tx,
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

impl SessionExtension for ReviewSessionHooks {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        if ctx.workspace.surface != "standard" {
            return Ok(SessionLaunchExtras::default());
        }
        let capability_token = self
            .mcp_auth
            .mint_capability_token(&ctx.workspace.id, &ctx.session.id)?;
        let url = format!(
            "{}/v1/workspaces/{}/sessions/{}/reviews/mcp",
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

        Ok(SessionLaunchExtras {
            system_prompt_append: review_system_prompt_append(),
            mcp_servers: vec![SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: "reviews".to_string(),
                catalog_entry_id: None,
                server_name: "reviews".to_string(),
                url,
                headers,
            })],
            mcp_binding_summaries: vec![review_binding_summary()],
        })
    }

    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        if let Err(error) = self.event_tx.try_send(ReviewHookEvent::TurnFinished(ctx)) {
            tracing::warn!(error = %error, "dropped review hook event; reconciler will recover");
        }
    }
}

fn review_system_prompt_append() -> Vec<String> {
    vec![r#"AnyHarness may run structured review loops for plans and code. If you receive review feedback, address the feedback you agree with and explicitly justify feedback you ignore. Only call mark_review_revision_ready when the feedback prompt explicitly asks for manual revision signaling and the tool is available. If the feedback says auto iterate is enabled, all reviewers approved, or it is the final configured round, do not call mark_review_revision_ready; follow the feedback instructions instead. For plan review, that can mean presenting the final plan. Reviewer sessions must submit their verdict with submit_review_result instead of only writing prose."#.to_string()]
}

fn review_binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: "internal:reviews".to_string(),
        server_name: "reviews".to_string(),
        display_name: Some("Reviews".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}
