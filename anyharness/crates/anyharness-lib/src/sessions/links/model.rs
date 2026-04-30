use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLinkRelation {
    Subagent,
    CoworkCodingSession,
}

impl SessionLinkRelation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Subagent => "subagent",
            Self::CoworkCodingSession => "cowork_coding_session",
        }
    }

    pub fn parse(value: &str) -> Result<Self, SessionLinkParseError> {
        match value {
            "subagent" => Ok(Self::Subagent),
            "cowork_coding_session" => Ok(Self::CoworkCodingSession),
            other => Err(SessionLinkParseError::UnknownRelation(other.to_string())),
        }
    }
}

impl fmt::Display for SessionLinkRelation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLinkWorkspaceRelation {
    SameWorkspace,
    CoworkManagedWorkspace,
}

impl SessionLinkWorkspaceRelation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SameWorkspace => "same_workspace",
            Self::CoworkManagedWorkspace => "cowork_managed_workspace",
        }
    }

    pub fn parse(value: &str) -> Result<Self, SessionLinkParseError> {
        match value {
            "same_workspace" => Ok(Self::SameWorkspace),
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
    pub relation: SessionLinkRelation,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub workspace_relation: SessionLinkWorkspaceRelation,
    pub label: Option<String>,
    pub created_by_turn_id: Option<String>,
    pub created_by_tool_call_id: Option<String>,
    pub created_at: String,
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
