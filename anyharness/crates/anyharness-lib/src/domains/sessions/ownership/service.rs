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
    pub fn link_owned_agent(
        &self,
        owner_session_id: &str,
        agent_session_id: &str,
        label: Option<String>,
    ) -> Result<SessionLinkRecord, OwnershipError> {
        Ok(self.link_service.create_link(CreateSessionLinkInput {
            relation: SessionLinkRelation::OwnedAgent,
            parent_session_id: owner_session_id.to_string(),
            child_session_id: agent_session_id.to_string(),
            // The agent is a peer, but it is still born in one workspace, and
            // in this tool that is the caller's own.
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
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
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::links::model::SessionLinkWorkspaceRelation;
    use crate::domains::sessions::links::service::CreateSessionLinkInput;
    use crate::domains::sessions::links::store::SessionLinkStore;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::persistence::Db;

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some(format!("Agent {id}")),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    struct Fixture {
        ownership: AgentOwnershipService,
        links: SessionLinkService,
        store: SessionStore,
    }

    fn fixture(session_ids: &[&str]) -> Fixture {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
        let store = SessionStore::new(db.clone());
        for id in session_ids {
            store.insert(&session_record(id)).expect("insert session");
        }
        let links = SessionLinkService::new(SessionLinkStore::new(db.clone()), store.clone());
        Fixture {
            ownership: AgentOwnershipService::new(links.clone(), store.clone()),
            links,
            store,
        }
    }

    fn link(fixture: &Fixture, relation: SessionLinkRelation, parent: &str, child: &str) -> String {
        fixture
            .links
            .create_link(CreateSessionLinkInput {
                relation,
                parent_session_id: parent.to_string(),
                child_session_id: child.to_string(),
                workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                label: Some("Schema audit".to_string()),
                created_by_turn_id: None,
                created_by_tool_call_id: None,
            })
            .expect("create link")
            .id
    }

    #[test]
    fn an_owner_resolves_its_child_by_session_id_and_by_subagent_id() {
        let fixture = fixture(&["ses_parent", "ses_child"]);
        let link_id = link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        let public_id = fixture
            .links
            .find_owned_link_including_closed("ses_parent", "ses_child")
            .expect("find link")
            .expect("link exists")
            .public_id
            .expect("public id");

        let by_session = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("resolve by session id");
        assert_eq!(by_session.link.id, link_id);
        assert_eq!(by_session.target.id, "ses_child");

        let by_public = fixture
            .ownership
            .resolve_owned("ses_parent", Some(&public_id), None)
            .expect("resolve by subagent id");
        assert_eq!(by_public.link.id, link_id);
    }

    #[test]
    fn a_stranger_owns_nothing_even_though_it_may_message_the_same_agent() {
        // The whole reason ownership is not `authorize`: reach is runtime-wide,
        // ownership is not. `ses_other` can message `ses_child` all day.
        let fixture = fixture(&["ses_parent", "ses_child", "ses_other"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );

        let error = fixture
            .ownership
            .resolve_owned("ses_other", None, Some("ses_child"))
            .err()
            .expect("a stranger does not own it");
        assert!(matches!(error, OwnershipError::NotOwned));
    }

    #[test]
    fn a_child_cannot_turn_the_link_around_and_own_its_parent() {
        let fixture = fixture(&["ses_parent", "ses_child"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );

        let error = fixture
            .ownership
            .resolve_owned("ses_child", None, Some("ses_parent"))
            .err()
            .expect("ownership points one way");
        assert!(matches!(error, OwnershipError::NotOwned));
    }

    #[test]
    fn a_fork_relation_is_not_ownership() {
        // A fork's parent is not its owner: forks are copies, and closing the
        // original must not be able to reach through this row.
        let fixture = fixture(&["ses_parent", "ses_fork"]);
        link(
            &fixture,
            SessionLinkRelation::Fork,
            "ses_parent",
            "ses_fork",
        );

        let error = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_fork"))
            .err()
            .expect("a fork is not owned");
        assert!(matches!(error, OwnershipError::NotOwned));
    }

    #[test]
    fn an_owned_agent_row_resolves_the_same_way_a_subagent_does() {
        let fixture = fixture(&["ses_parent", "ses_owned"]);
        link(
            &fixture,
            SessionLinkRelation::OwnedAgent,
            "ses_parent",
            "ses_owned",
        );

        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_owned"))
            .expect("an owned agent is owned");
        assert_eq!(owned.link.relation, SessionLinkRelation::OwnedAgent);
        // ... but it is already top level, so there is nothing to promote.
        let error = fixture
            .ownership
            .promote(&owned)
            .err()
            .expect("an owned agent cannot be promoted");
        assert!(matches!(error, OwnershipError::NotASubagent));
    }

    #[test]
    fn spawning_a_peer_writes_an_owned_agent_row_the_owner_resolves() {
        // ADR §3.2's settled ruling, at the only place that writes it:
        // `spawn_agent` creates `relation = 'owned_agent'`. If this wrote
        // 'subagent' the new agent would silently acquire everything
        // subordination implies — a fanout slot, the close cascade, and the
        // spawn block — none of which a peer is under.
        let fixture = fixture(&["ses_owner", "ses_peer"]);

        let link = fixture
            .ownership
            .link_owned_agent("ses_owner", "ses_peer", Some("Schema audit".to_string()))
            .expect("link the owned agent");

        assert_eq!(link.relation, SessionLinkRelation::OwnedAgent);
        assert_eq!(link.parent_session_id, "ses_owner");
        assert_eq!(link.child_session_id, "ses_peer");
        assert_eq!(link.label.as_deref(), Some("Schema audit"));
        // Born a peer, not promoted into one: `promoted_at` describes a
        // subagent's history and this agent never had that history.
        assert!(link.promoted_at.is_none());
        assert!(!link.is_unpromoted_subagent());
        assert!(link
            .public_id
            .as_deref()
            .is_some_and(|id| id.starts_with("agent_")));

        // The row is ownership, so close and promote resolve it — and the peer
        // is not promotable, because it is already top level.
        let owned = fixture
            .ownership
            .resolve_owned("ses_owner", None, Some("ses_peer"))
            .expect("the owner owns it");
        assert_eq!(owned.link.id, link.id);
        assert!(matches!(
            fixture.ownership.promote(&owned).err(),
            Some(OwnershipError::NotASubagent)
        ));
    }

    #[test]
    fn an_owned_agent_link_does_not_claim_a_subagent_parent_slot() {
        // Negative control on the relation: the child of an owned link must not
        // read as somebody's subagent anywhere, or the depth rule and the
        // fanout count would both pick it up.
        let fixture = fixture(&["ses_owner", "ses_peer"]);
        fixture
            .ownership
            .link_owned_agent("ses_owner", "ses_peer", None)
            .expect("link the owned agent");

        assert!(fixture
            .links
            .find_subagent_parent("ses_peer")
            .expect("subagent parent lookup")
            .is_none());
        assert!(fixture
            .links
            .list_subagent_children("ses_owner")
            .expect("subagent children")
            .is_empty());
        assert!(!fixture
            .ownership
            .is_unpromoted_subagent("ses_peer")
            .expect("spawn block lookup"));
    }

    #[test]
    fn promotion_stamps_the_row_keeps_the_relation_and_is_idempotent() {
        let fixture = fixture(&["ses_parent", "ses_child"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("resolve");

        let first = fixture.ownership.promote(&owned).expect("promote");
        assert!(!first.already_promoted);
        // The relation is untouched: the parent still owns this agent, which is
        // what lets it close it individually later.
        assert_eq!(first.link.relation, SessionLinkRelation::Subagent);
        assert_eq!(first.link.promoted_at.as_deref(), Some(&*first.promoted_at));
        assert!(!first.link.is_unpromoted_subagent());

        let reloaded = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("resolve again");
        let second = fixture.ownership.promote(&reloaded).expect("promote again");
        assert!(second.already_promoted);
        assert_eq!(second.promoted_at, first.promoted_at);
    }

    #[test]
    fn promotion_lifts_the_spawn_block_for_that_child_only() {
        let fixture = fixture(&["ses_parent", "ses_child", "ses_sibling"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_sibling",
        );

        assert!(fixture
            .ownership
            .is_unpromoted_subagent("ses_child")
            .expect("check child"));
        // A top-level session was never blocked.
        assert!(!fixture
            .ownership
            .is_unpromoted_subagent("ses_parent")
            .expect("check parent"));

        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("resolve");
        fixture.ownership.promote(&owned).expect("promote");

        assert!(!fixture
            .ownership
            .is_unpromoted_subagent("ses_child")
            .expect("check promoted child"));
        // Negative control: the sibling is untouched by its peer's promotion.
        assert!(fixture
            .ownership
            .is_unpromoted_subagent("ses_sibling")
            .expect("check sibling"));
    }

    #[test]
    fn a_closed_agent_cannot_be_promoted() {
        let fixture = fixture(&["ses_parent", "ses_child"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        fixture
            .store
            .mark_closed("ses_child", "2026-08-08T01:00:00Z")
            .expect("close the child session");

        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("a closed agent still resolves");
        let error = fixture
            .ownership
            .promote(&owned)
            .err()
            .expect("a closed agent cannot be promoted");
        assert!(matches!(error, OwnershipError::Closed));
    }

    #[test]
    fn close_attribution_is_written_once_and_reads_as_end_requested_while_open() {
        let fixture = fixture(&["ses_parent", "ses_child"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("resolve");

        assert!(fixture
            .ownership
            .record_close_attribution(&owned, "ses_parent", Some("superseded by the schema audit"))
            .expect("stamp attribution"));

        // While the link is open the stamp IS the close request the turn-finish
        // hook completes.
        let pending = fixture
            .ownership
            .pending_close_request("ses_child")
            .expect("pending lookup")
            .expect("a close was requested");
        assert!(pending.is_close_requested());
        assert_eq!(pending.closed_by_session_id.as_deref(), Some("ses_parent"));
        assert_eq!(
            pending.close_reason.as_deref(),
            Some("superseded by the schema audit")
        );

        // Once closed, the request is spent and a second close cannot rewrite
        // who closed it.
        fixture
            .ownership
            .close_link(&pending, "2026-08-08T02:00:00Z")
            .expect("close the link");
        assert!(fixture
            .ownership
            .pending_close_request("ses_child")
            .expect("pending lookup")
            .is_none());

        let reloaded = fixture.ownership.reload_link(&pending).expect("reload");
        assert!(!fixture
            .ownership
            .record_close_attribution(&owned, "ses_other", Some("second close"))
            .expect("second attribution attempt"));
        let after = fixture.ownership.reload_link(&reloaded).expect("reload");
        assert_eq!(after.closed_by_session_id.as_deref(), Some("ses_parent"));
        assert_eq!(
            after.close_reason.as_deref(),
            Some("superseded by the schema audit")
        );
    }

    #[test]
    fn the_first_requester_owns_the_attribution_for_the_whole_end_requested_window() {
        // The window between "close requested" and "closed" is a whole turn
        // wide, and the docstring promises attribution is written once. Without
        // the `closed_by_session_id IS NULL` guard a second close inside that
        // window silently rewrites who asked and why, and §4's
        // "Closed by X · reason" then credits the wrong agent.
        let fixture = fixture(&["ses_parent", "ses_child", "ses_other"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_child"))
            .expect("resolve");

        assert!(fixture
            .ownership
            .record_close_attribution(&owned, "ses_parent", Some("superseded"))
            .expect("first requester stamps"));
        // Still open, still requested — and a second close lands in that window.
        assert!(!fixture
            .ownership
            .record_close_attribution(&owned, "ses_other", Some("me too"))
            .expect("second requester is a no-op"));

        let pending = fixture
            .ownership
            .pending_close_request("ses_child")
            .expect("pending lookup")
            .expect("still requested");
        assert_eq!(pending.closed_by_session_id.as_deref(), Some("ses_parent"));
        assert_eq!(pending.close_reason.as_deref(), Some("superseded"));
    }

    #[test]
    fn a_close_owed_from_a_dead_runtime_is_still_findable_at_boot() {
        // The turn-finish hook can only pay a debt whose turn finishes. If the
        // process died mid-turn the request stays armed with nothing to fire
        // it, so the startup pass reads it back — runtime-wide, not per child.
        let fixture = fixture(&["ses_parent", "ses_child", "ses_other", "ses_quiet"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        link(
            &fixture,
            SessionLinkRelation::OwnedAgent,
            "ses_parent",
            "ses_other",
        );
        // Un-requested: an ordinary open child is not swept.
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_quiet",
        );

        for child in ["ses_child", "ses_other"] {
            let owned = fixture
                .ownership
                .resolve_owned("ses_parent", None, Some(child))
                .expect("resolve");
            fixture
                .ownership
                .record_close_attribution(&owned, "ses_parent", None)
                .expect("stamp");
        }

        let owed = fixture
            .ownership
            .pending_close_requests()
            .expect("sweep the pending requests");
        let mut children = owed
            .iter()
            .map(|link| link.child_session_id.as_str())
            .collect::<Vec<_>>();
        children.sort_unstable();
        assert_eq!(children, vec!["ses_child", "ses_other"]);

        // Settling one takes it out of the sweep; the other is still owed.
        fixture
            .ownership
            .close_link(&owed[0], "2026-08-08T02:00:00Z")
            .expect("settle one");
        assert_eq!(
            fixture
                .ownership
                .pending_close_requests()
                .expect("sweep again")
                .len(),
            1
        );
    }

    #[test]
    fn a_promoted_child_frees_the_slot_the_advertised_limits_report() {
        // The advertised `existingSubagentCount`/`remainingSubagents` and the
        // spawn pre-check read this count, and the store's insert subselect IS
        // the cap. All three must agree, or the tool tells an agent it is out
        // of slots while `spawn_subagent` keeps succeeding.
        let fixture = fixture(&["ses_parent", "ses_a", "ses_b", "ses_c"]);
        for child in ["ses_a", "ses_b", "ses_c"] {
            link(
                &fixture,
                SessionLinkRelation::Subagent,
                "ses_parent",
                child,
            );
        }
        assert_eq!(
            fixture
                .links
                .count_open_unpromoted_subagent_children("ses_parent")
                .expect("count slots"),
            3
        );

        let owned = fixture
            .ownership
            .resolve_owned("ses_parent", None, Some("ses_b"))
            .expect("resolve");
        fixture.ownership.promote(&owned).expect("promote");

        assert_eq!(
            fixture
                .links
                .count_open_unpromoted_subagent_children("ses_parent")
                .expect("count slots after promotion"),
            2,
            "a promoted child keeps its ownership row but frees its slot"
        );
        // The row is still there — it is only the CAP that stopped counting it.
        assert_eq!(
            fixture
                .links
                .list_subagent_children("ses_parent")
                .expect("list children")
                .len(),
            3
        );
    }

    #[test]
    fn a_human_close_leaves_no_attribution_so_nothing_reads_as_requested() {
        let fixture = fixture(&["ses_parent", "ses_child"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );

        // No attribution stamped: the link is open and un-requested, which is
        // exactly the state a human close goes through.
        assert!(fixture
            .ownership
            .pending_close_request("ses_child")
            .expect("pending lookup")
            .is_none());
    }

    #[test]
    fn a_target_is_required_and_the_two_handles_must_agree() {
        let fixture = fixture(&["ses_parent", "ses_child", "ses_other"]);
        link(
            &fixture,
            SessionLinkRelation::Subagent,
            "ses_parent",
            "ses_child",
        );
        let public_id = fixture
            .links
            .find_owned_link_including_closed("ses_parent", "ses_child")
            .expect("find")
            .expect("exists")
            .public_id
            .expect("public id");

        assert!(matches!(
            fixture
                .ownership
                .resolve_owned("ses_parent", None, None)
                .err()
                .expect("no target"),
            OwnershipError::TargetRequired
        ));
        assert!(matches!(
            fixture
                .ownership
                .resolve_owned("ses_parent", Some(&public_id), Some("ses_other"))
                .err()
                .expect("handles disagree"),
            OwnershipError::ConflictingTarget
        ));
        assert!(matches!(
            fixture
                .ownership
                .resolve_owned("ses_parent", None, Some("ses_parent"))
                .err()
                .expect("self target"),
            OwnershipError::SelfTarget
        ));
    }
}
