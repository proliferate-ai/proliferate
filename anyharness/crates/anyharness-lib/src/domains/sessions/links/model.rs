use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLinkRelation {
    Subagent,
    /// A top-level agent one session owns without parenting it: no fanout cap,
    /// no depth rule, no close cascade. Nothing writes this relation yet — the
    /// spawn_agent step is its only producer — but ownership reads already span
    /// it, so an owned agent is closeable the day it can be created.
    OwnedAgent,
    /// Retired. Cowork is deleted; nothing writes this relation. Kept so
    /// historical rows still parse (ADR §6 step 8).
    CoworkCodingSession,
    /// Retired alongside [`Self::CoworkCodingSession`]: review agents are gone.
    ReviewAgent,
    Fork,
}

impl SessionLinkRelation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Subagent => "subagent",
            Self::OwnedAgent => "owned_agent",
            Self::CoworkCodingSession => "cowork_coding_session",
            Self::ReviewAgent => "review_agent",
            Self::Fork => "fork",
        }
    }

    pub fn parse(value: &str) -> Result<Self, SessionLinkParseError> {
        match value {
            "subagent" => Ok(Self::Subagent),
            "owned_agent" => Ok(Self::OwnedAgent),
            "cowork_coding_session" => Ok(Self::CoworkCodingSession),
            "review_agent" => Ok(Self::ReviewAgent),
            "fork" => Ok(Self::Fork),
            other => Err(SessionLinkParseError::UnknownRelation(other.to_string())),
        }
    }

    pub fn public_id_prefix(self) -> &'static str {
        match self {
            Self::Subagent => "subagent",
            Self::OwnedAgent => "agent",
            Self::CoworkCodingSession => "cowork_agent",
            Self::ReviewAgent => "reviewer",
            Self::Fork => "session_link",
        }
    }

    /// Whether the relation makes `parent_session_id` the OWNER of
    /// `child_session_id` — the one predicate behind close and promote rights.
    /// A fork is a copy and cowork/reviews are the deleted features; none of
    /// them confers ownership.
    pub fn is_ownership(self) -> bool {
        matches!(self, Self::Subagent | Self::OwnedAgent)
    }
}

impl fmt::Display for SessionLinkRelation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Where the child of a link lives relative to its parent.
///
/// A durable fact, not a derived one: the workspace ids on both sessions can
/// move (mobility) or be retired, so the relation the link was CREATED with is
/// what says whether the two agents were ever meant to share a checkout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLinkWorkspaceRelation {
    SameWorkspace,
    /// The child was placed in a workspace that is not the parent's. Since
    /// `spawn_agent` took a `workspaceId` this is an ordinary outcome, not an
    /// exotic one: an owner may staff a workspace it just spawned.
    CrossWorkspace,
    /// Retired with cowork; kept so historical rows still parse.
    CoworkManagedWorkspace,
}

impl SessionLinkWorkspaceRelation {
    /// Which of the two ordinary relations a parent/child pair is, from the
    /// only fact that decides it. The retired cowork managed relation is not
    /// reachable from here — it named a workspace the deleted cowork feature
    /// owned, a different claim than "these two are not in the same place".
    pub fn between(parent_workspace_id: &str, child_workspace_id: &str) -> Self {
        if parent_workspace_id == child_workspace_id {
            Self::SameWorkspace
        } else {
            Self::CrossWorkspace
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::SameWorkspace => "same_workspace",
            Self::CrossWorkspace => "cross_workspace",
            Self::CoworkManagedWorkspace => "cowork_managed_workspace",
        }
    }

    pub fn parse(value: &str) -> Result<Self, SessionLinkParseError> {
        match value {
            "same_workspace" => Ok(Self::SameWorkspace),
            "cross_workspace" => Ok(Self::CrossWorkspace),
            "cowork_managed_workspace" => Ok(Self::CoworkManagedWorkspace),
            other => Err(SessionLinkParseError::UnknownWorkspaceRelation(
                other.to_string(),
            )),
        }
    }
}

impl fmt::Display for SessionLinkWorkspaceRelation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionLinkRecord {
    pub id: String,
    pub public_id: Option<String>,
    pub relation: SessionLinkRelation,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub workspace_relation: SessionLinkWorkspaceRelation,
    pub label: Option<String>,
    pub created_by_turn_id: Option<String>,
    pub created_by_tool_call_id: Option<String>,
    pub created_at: String,
    pub closed_at: Option<String>,
    /// NULL = a plain linked subagent. Set once, idempotently, by
    /// `promote_subagent`: the row keeps `relation = 'subagent'` (the former
    /// parent still owns it and may close it individually) but stops being a
    /// close-cascade child and regains the spawn tools.
    pub promoted_at: Option<String>,
    /// The agent that asked for this link's child to close. NULL on a human
    /// close, which leaves no trace. Set while `closed_at` is still NULL, it is
    /// the durable "end requested" record a mid-turn close leaves behind.
    pub closed_by_session_id: Option<String>,
    /// Optional free text from the closing agent, rendered beside it.
    pub close_reason: Option<String>,
}

impl SessionLinkRecord {
    /// A linked subagent that has not been promoted — the only child the close
    /// cascade follows, and the only caller barred from the spawn tools.
    pub fn is_unpromoted_subagent(&self) -> bool {
        self.relation == SessionLinkRelation::Subagent && self.promoted_at.is_none()
    }

    /// An agent-initiated close that has been requested but not completed: the
    /// target was mid-turn, so the close waits for that turn to finish.
    pub fn is_close_requested(&self) -> bool {
        self.closed_at.is_none() && self.closed_by_session_id.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SessionLinkParseError {
    #[error("unknown session link relation: {0}")]
    UnknownRelation(String),
    #[error("unknown session link workspace relation: {0}")]
    UnknownWorkspaceRelation(String),
}

#[cfg(test)]
mod tests {
    use super::{SessionLinkRelation, SessionLinkWorkspaceRelation};

    #[test]
    fn relation_strings_round_trip() {
        assert_eq!(SessionLinkRelation::Subagent.as_str(), "subagent");
        assert_eq!(
            SessionLinkRelation::CoworkCodingSession.as_str(),
            "cowork_coding_session"
        );
        assert_eq!(
            SessionLinkRelation::parse("cowork_coding_session").expect("parse relation"),
            SessionLinkRelation::CoworkCodingSession
        );
        assert_eq!(
            SessionLinkRelation::parse("review_agent").expect("parse relation"),
            SessionLinkRelation::ReviewAgent
        );
        assert_eq!(SessionLinkRelation::Fork.as_str(), "fork");
        assert_eq!(
            SessionLinkRelation::parse("fork").expect("parse relation"),
            SessionLinkRelation::Fork
        );
        assert_eq!(SessionLinkRelation::OwnedAgent.as_str(), "owned_agent");
        assert_eq!(
            SessionLinkRelation::parse("owned_agent").expect("parse relation"),
            SessionLinkRelation::OwnedAgent
        );
    }

    #[test]
    fn only_subagent_and_owned_agent_confer_ownership() {
        for relation in [
            SessionLinkRelation::Subagent,
            SessionLinkRelation::OwnedAgent,
        ] {
            assert!(relation.is_ownership(), "{relation} should confer ownership");
        }
        // A fork is a copy, not a subordinate; cowork and reviews are the
        // deleted features. None makes the parent an owner, so none is
        // closeable or promotable through the ownership tools.
        for relation in [
            SessionLinkRelation::Fork,
            SessionLinkRelation::CoworkCodingSession,
            SessionLinkRelation::ReviewAgent,
        ] {
            assert!(
                !relation.is_ownership(),
                "{relation} must not confer ownership"
            );
        }
    }

    #[test]
    fn promotion_and_close_request_are_read_off_the_row() {
        use super::{SessionLinkRecord, SessionLinkWorkspaceRelation as Ws};

        let base = SessionLinkRecord {
            id: "link-1".to_string(),
            public_id: None,
            relation: SessionLinkRelation::Subagent,
            parent_session_id: "ses_parent".to_string(),
            child_session_id: "ses_child".to_string(),
            workspace_relation: Ws::SameWorkspace,
            label: None,
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: "2026-08-08T00:00:00Z".to_string(),
            closed_at: None,
            promoted_at: None,
            closed_by_session_id: None,
            close_reason: None,
        };

        assert!(base.is_unpromoted_subagent());
        assert!(!base.is_close_requested());

        let promoted = SessionLinkRecord {
            promoted_at: Some("2026-08-08T01:00:00Z".to_string()),
            ..base.clone()
        };
        assert!(!promoted.is_unpromoted_subagent());

        // An owned agent was never a subagent, so it is never a cascade child.
        let owned = SessionLinkRecord {
            relation: SessionLinkRelation::OwnedAgent,
            ..base.clone()
        };
        assert!(!owned.is_unpromoted_subagent());

        let requested = SessionLinkRecord {
            closed_by_session_id: Some("ses_parent".to_string()),
            ..base.clone()
        };
        assert!(requested.is_close_requested());

        // Once the close lands the request is spent: the attribution stays for
        // "Closed by X", the "still waiting on a turn" reading does not.
        let closed = SessionLinkRecord {
            closed_at: Some("2026-08-08T02:00:00Z".to_string()),
            closed_by_session_id: Some("ses_parent".to_string()),
            ..base
        };
        assert!(!closed.is_close_requested());
    }

    #[test]
    fn workspace_relation_strings_round_trip() {
        assert_eq!(
            SessionLinkWorkspaceRelation::SameWorkspace.as_str(),
            "same_workspace"
        );
        assert_eq!(
            SessionLinkWorkspaceRelation::CoworkManagedWorkspace.as_str(),
            "cowork_managed_workspace"
        );
        assert_eq!(
            SessionLinkWorkspaceRelation::parse("cowork_managed_workspace")
                .expect("parse workspace relation"),
            SessionLinkWorkspaceRelation::CoworkManagedWorkspace
        );
    }
}
