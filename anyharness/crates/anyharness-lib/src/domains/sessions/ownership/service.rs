//! Resolving ownership, promoting a subagent, and recording a close.
//!
//! Everything here is a decision plus at most one durable write. Actually
//! stopping an agent is the runtime's job (`close_session_tree`); this module
//! decides WHETHER the caller may, and leaves the row that says who did it.

use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::{
    CreateSessionLinkError, CreateSessionLinkInput, SessionLinkService,
};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::SessionStore;

#[derive(Debug, thiserror::Error)]
pub enum OwnershipError {
    #[error("caller session not found: {0}")]
    OwnerNotFound(String),
    #[error("target session not found: {0}")]
    TargetNotFound(String),
    #[error("a target is required: pass sessionId")]
    TargetRequired,
    #[error("subagentId and sessionId refer to different agents")]
    ConflictingTarget,
    #[error(
        "you do not own that agent. You can close and promote the subagents you spawned and the \
         agents you own; use list_subagents to see them"
    )]
    NotOwned,
    #[error("an agent cannot own itself")]
    SelfTarget,
    #[error("that agent is already a top-level agent, not one of your subagents")]
    NotASubagent,
    #[error("that agent is closed")]
    Closed,
    #[error(transparent)]
    Link(#[from] CreateSessionLinkError),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// An ownership row plus the session it points at, resolved together so callers
/// never re-read one without the other.
#[derive(Debug, Clone)]
pub struct OwnedAgent {
    pub link: SessionLinkRecord,
    pub target: SessionRecord,
}

impl OwnedAgent {
    /// The handle an agent uses for this target in the subagent tool class.
    pub fn subagent_id(&self) -> Option<&str> {
        self.link.public_id.as_deref()
    }
}

#[derive(Debug, Clone)]
pub struct PromotionOutcome {
    pub link: SessionLinkRecord,
    pub promoted_at: String,
    /// `false` when this call did the promoting; `true` when the agent was
    /// already a peer. Promotion is idempotent — ADR §3.2 makes it one write.
    pub already_promoted: bool,
}

#[derive(Clone)]
pub struct AgentOwnershipService {
    link_service: SessionLinkService,
    session_store: SessionStore,
}

impl AgentOwnershipService {
    pub fn new(link_service: SessionLinkService, session_store: SessionStore) -> Self {
        Self {
            link_service,
            session_store,
        }
    }

    pub fn session_store(&self) -> &SessionStore {
        &self.session_store
    }

    /// Resolve a target the caller OWNS, by either handle.
    ///
    /// Closed rows resolve too: closing an already-closed agent is idempotent,
    /// and the close attribution has to stay readable on a closed row.
    pub fn resolve_owned(
        &self,
        owner_session_id: &str,
        subagent_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<OwnedAgent, OwnershipError> {
        let subagent_id = subagent_id.map(str::trim).filter(|value| !value.is_empty());
        let session_id = session_id.map(str::trim).filter(|value| !value.is_empty());
        if subagent_id.is_none() && session_id.is_none() {
            return Err(OwnershipError::TargetRequired);
        }
        if session_id == Some(owner_session_id) {
            return Err(OwnershipError::SelfTarget);
        }

        let link = match subagent_id {
            // The public id is already scoped to one row, so ownership is one
            // equality check on the row it names.
            Some(public_id) => self
                .link_service
                .find_by_public_id(public_id)?
                .filter(|link| {
                    link.relation.is_ownership() && link.parent_session_id == owner_session_id
                })
                .ok_or(OwnershipError::NotOwned)?,
            None => {
                let target_id = session_id.expect("checked above");
                self.link_service
                    .find_owned_link_including_closed(owner_session_id, target_id)?
                    .ok_or(OwnershipError::NotOwned)?
            }
        };

        // Both handles supplied: they must name the same agent, or the caller
        // is confused about which one it is acting on.
        if let Some(target_id) = session_id {
            if link.child_session_id != target_id {
                return Err(OwnershipError::ConflictingTarget);
            }
        }

        let target = self
            .session_store
            .find_by_id(&link.child_session_id)?
            .ok_or_else(|| OwnershipError::TargetNotFound(link.child_session_id.clone()))?;
        Ok(OwnedAgent { link, target })
    }

    /// Record that `owner` owns a newly spawned PEER agent.
    ///
    /// `relation = 'owned_agent'` is the whole of the difference from a
    /// subagent link (ADR §3.2): no fanout cap, no depth rule, and
    /// `runtime::lifecycle::cascades_to_child` never follows the row, so
    /// closing the owner leaves this agent running. The row exists at all
    /// because ownership has to be readable — it is what lets the creator
    /// close this agent later.
    ///
    /// `spawn_agent` is this relation's only producer. Promotion never writes
    /// it: a promoted subagent keeps `relation = 'subagent'` and gains
    /// `promoted_at`, because the row also records how the agent came to be.
    ///
    /// The two workspace ids are taken rather than assumed. `spawn_agent` may
    /// place a peer in a workspace that is not the caller's, so the row records
    /// which of the two it was — a durable claim on a public field
    /// (`SessionLinkView::workspace_relation`), and one that is far cheaper to
    /// get right at insert than to reinterpret later.
    pub fn link_owned_agent(
        &self,
        owner_session_id: &str,
        owner_workspace_id: &str,
        agent_session_id: &str,
        agent_workspace_id: &str,
        label: Option<String>,
    ) -> Result<SessionLinkRecord, OwnershipError> {
        Ok(self.link_service.create_link(CreateSessionLinkInput {
            relation: SessionLinkRelation::OwnedAgent,
            parent_session_id: owner_session_id.to_string(),
            child_session_id: agent_session_id.to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::between(
                owner_workspace_id,
                agent_workspace_id,
            ),
            label,
            created_by_turn_id: None,
            created_by_tool_call_id: None,
        })?)
    }

    /// Promote one of the caller's linked subagents to a peer.
    ///
    /// The row keeps `relation = 'subagent'` and gains `promoted_at` — ADR §3.2
    /// spells the promoted state as exactly that, and it is what keeps the
    /// former parent an owner who may still close it individually. What the
    /// stamp changes: the close cascade stops following the row, the fanout cap
    /// stops counting it, and the spawn tools unlock for the child.
    pub fn promote(&self, owned: &OwnedAgent) -> Result<PromotionOutcome, OwnershipError> {
        if owned.link.relation != SessionLinkRelation::Subagent {
            // An `owned_agent` row was never linked, so there is nothing to
            // promote. Saying so beats a silent success that implies a change.
            return Err(OwnershipError::NotASubagent);
        }
        if owned.link.closed_at.is_some() || is_closed(&owned.target) {
            return Err(OwnershipError::Closed);
        }
        if let Some(promoted_at) = owned.link.promoted_at.clone() {
            return Ok(PromotionOutcome {
                link: owned.link.clone(),
                promoted_at,
                already_promoted: true,
            });
        }

        let promoted_at = chrono::Utc::now().to_rfc3339();
        let promoted = self
            .link_service
            .promote_link(&owned.link.id, &promoted_at)?;
        // Lost the race with a concurrent promote: re-read rather than report a
        // timestamp this call did not write.
        let link = self
            .link_service
            .find_owned_link_including_closed(
                &owned.link.parent_session_id,
                &owned.link.child_session_id,
            )?
            .unwrap_or_else(|| owned.link.clone());
        Ok(PromotionOutcome {
            promoted_at: link
                .promoted_at
                .clone()
                .unwrap_or_else(|| promoted_at.clone()),
            already_promoted: !promoted,
            link,
        })
    }

    /// Record who is closing this agent and why, before the runtime stops it.
    ///
    /// On an OPEN row the stamp doubles as the durable close request: if the
    /// target turns out to be mid-turn, this row is what the turn-finish hook
    /// finds and completes. Attribution is written once — a second close of an
    /// already-closed agent leaves the first close's record alone.
    pub fn record_close_attribution(
        &self,
        owned: &OwnedAgent,
        closed_by_session_id: &str,
        close_reason: Option<&str>,
    ) -> Result<bool, OwnershipError> {
        Ok(self.link_service.record_close_attribution(
            &owned.link.id,
            closed_by_session_id,
            close_reason,
        )?)
    }

    /// Mark the ownership row closed. Runs AFTER the live session is down, so a
    /// failed live close leaves the link open and the close retryable.
    pub fn close_link(
        &self,
        link: &SessionLinkRecord,
        closed_at: &str,
    ) -> Result<bool, OwnershipError> {
        Ok(self.link_service.close_link(&link.id, closed_at)?)
    }

    /// Re-read one ownership row by id, for reporting the settled state.
    pub fn reload_link(
        &self,
        link: &SessionLinkRecord,
    ) -> Result<SessionLinkRecord, OwnershipError> {
        Ok(self
            .link_service
            .find_owned_link_including_closed(&link.parent_session_id, &link.child_session_id)?
            .unwrap_or_else(|| link.clone()))
    }

    /// The soft-close question, asked of every session that finishes a turn:
    /// did somebody ask for this agent to stop once it was done?
    pub fn pending_close_request(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionLinkRecord>, OwnershipError> {
        Ok(self.link_service.find_pending_close_request(session_id)?)
    }

    /// Every close still owed, runtime-wide. Read once at boot: a request whose
    /// turn never finished (the runtime died mid-turn) has nothing left to fire
    /// it, so the startup pass settles it instead.
    pub fn pending_close_requests(&self) -> Result<Vec<SessionLinkRecord>, OwnershipError> {
        Ok(self.link_service.list_pending_close_requests()?)
    }

    /// Whether `session_id` is an UNPROMOTED subagent child — ruling 3's
    /// predicate, and the only caller barred from the spawn tools.
    pub fn is_unpromoted_subagent(&self, session_id: &str) -> Result<bool, OwnershipError> {
        Ok(self
            .link_service
            .find_subagent_parent(session_id)?
            .is_some_and(|link| link.is_unpromoted_subagent()))
    }
}

fn is_closed(session: &SessionRecord) -> bool {
    session.closed_at.is_some() || session.status == "closed"
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
