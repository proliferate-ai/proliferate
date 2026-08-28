use anyharness_contract::v1::{
    ErrorEventDetails, InteractionKind, InteractionOutcome, SessionMcpBindingNotAppliedReason,
    SessionMcpBindingOutcome, SessionMcpBindingSummary, SessionMcpTransport,
};

use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::workspaces::model::WorkspaceRecord;

use super::model::SessionRecord;

#[derive(Debug, Clone, Default)]
pub struct SessionLaunchExtras {
    pub system_prompt_append: Vec<String>,
    pub first_prompt_system_prompt_append: Vec<String>,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
}

/// The domain-facing vocabulary extensions use when they report MCP binding
/// work, so they never name wire types: this file (the grandfathered contract
/// seam) owns the one mapping onto the contract's binding-summary rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchBindingTransport {
    Http,
    Stdio,
}

/// Why a binding an extension resolved was not applied to the launch. Same
/// seam rule as [`LaunchBindingTransport`]: extensions speak this vocabulary,
/// and only this file maps it to the wire reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchBindingSkip {
    NativeUnavailable,
    NativeStale,
    NativeNameCollision,
}

impl SessionLaunchExtras {
    /// Record one binding this launch applies.
    pub fn push_binding_applied(
        &mut self,
        id: &str,
        server_name: &str,
        display_name: Option<String>,
        transport: LaunchBindingTransport,
    ) {
        self.mcp_binding_summaries.push(SessionMcpBindingSummary {
            id: id.to_string(),
            server_name: server_name.to_string(),
            display_name,
            transport: wire_transport(transport),
            outcome: SessionMcpBindingOutcome::Applied,
            reason: None,
        });
    }

    /// Record one binding this launch refused, with the reason it skipped.
    pub fn push_binding_not_applied(
        &mut self,
        id: &str,
        server_name: &str,
        display_name: Option<String>,
        transport: LaunchBindingTransport,
        skip: LaunchBindingSkip,
    ) {
        self.mcp_binding_summaries.push(SessionMcpBindingSummary {
            id: id.to_string(),
            server_name: server_name.to_string(),
            display_name,
            transport: wire_transport(transport),
            outcome: SessionMcpBindingOutcome::NotApplied,
            reason: Some(wire_skip_reason(skip)),
        });
    }
}

fn wire_transport(transport: LaunchBindingTransport) -> SessionMcpTransport {
    match transport {
        LaunchBindingTransport::Http => SessionMcpTransport::Http,
        LaunchBindingTransport::Stdio => SessionMcpTransport::Stdio,
    }
}

fn wire_skip_reason(skip: LaunchBindingSkip) -> SessionMcpBindingNotAppliedReason {
    match skip {
        LaunchBindingSkip::NativeUnavailable => {
            SessionMcpBindingNotAppliedReason::NativeUnavailable
        }
        LaunchBindingSkip::NativeStale => SessionMcpBindingNotAppliedReason::NativeStale,
        LaunchBindingSkip::NativeNameCollision => {
            SessionMcpBindingNotAppliedReason::NativeNameCollision
        }
    }
}

#[derive(Debug)]
pub struct SessionLaunchContext<'a> {
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionTurnOutcome {
    Completed,
    Failed,
    Cancelled,
}

impl SessionTurnOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionTurnFinishedContext {
    pub workspace: WorkspaceRecord,
    pub session_id: String,
    pub turn_id: String,
    /// The finished prompt's caller-supplied id when it carried one
    /// (provenance only). The workflow extension matches by session link and
    /// reports EVERY turn end of a linked session — a queued interjection's
    /// turn must be able to complete a node — never by prompt identity.
    pub prompt_id: Option<String>,
    pub outcome: SessionTurnOutcome,
    pub stop_reason: Option<String>,
    pub last_event_seq: i64,
    pub error_details: Option<ErrorEventDetails>,
}

#[derive(Debug, Clone)]
pub struct SessionStartedContext {
    pub session_id: String,
    pub agent_kind: String,
}

#[derive(Debug, Clone)]
pub struct SessionInteractionRequestedContext {
    pub session_id: String,
    pub request_id: String,
    pub kind: InteractionKind,
}

#[derive(Debug, Clone)]
pub struct SessionInteractionResolvedContext {
    pub session_id: String,
    pub request_id: String,
    pub kind: InteractionKind,
    pub outcome: InteractionOutcome,
}

#[derive(Debug, Clone)]
pub struct SessionClosingContext {
    pub session_id: String,
    pub closed_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct SessionClosingActions {
    pub close_session_ids: Vec<String>,
}

pub trait SessionExtension: Send + Sync {
    fn resolve_launch_extras(
        &self,
        _ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        Ok(SessionLaunchExtras::default())
    }

    fn on_session_started(&self, _ctx: SessionStartedContext) {}

    fn on_turn_finished(&self, _ctx: SessionTurnFinishedContext) {}

    fn on_interaction_requested(&self, _ctx: SessionInteractionRequestedContext) {}

    fn on_interaction_resolved(&self, _ctx: SessionInteractionResolvedContext) {}

    fn on_session_closing(
        &self,
        _ctx: SessionClosingContext,
    ) -> anyhow::Result<SessionClosingActions> {
        Ok(SessionClosingActions::default())
    }
}
