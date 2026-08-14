use super::{SubagentError, SubagentService};
use crate::domains::sessions::links::model::{SessionLinkRecord, SessionLinkRelation};

impl SubagentService {
    pub fn authorize_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionLinkRecord, SubagentError> {
        let link = self
            .link_service
            .find_subagent_link(parent_session_id, child_session_id)?
            .ok_or(SubagentError::NotOwned)?;
        if link.subagent_closed_at.is_some() {
            return Err(SubagentError::OpenRequired);
        }
        Ok(link)
    }

    pub fn authorize_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
    ) -> Result<SessionLinkRecord, SubagentError> {
        let link = self.resolve_target(parent_session_id, subagent_id, child_session_id, false)?;
        if link.closed_at.is_some() {
            return Err(SubagentError::Closed);
        }
        if link.subagent_closed_at.is_some() {
            return Err(SubagentError::OpenRequired);
        }
        Ok(link)
    }

    pub fn resolve_target_including_closed(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
    ) -> Result<SessionLinkRecord, SubagentError> {
        self.resolve_target(parent_session_id, subagent_id, child_session_id, true)
    }

    fn resolve_target(
        &self,
        parent_session_id: &str,
        subagent_id: Option<&str>,
        child_session_id: Option<&str>,
        include_closed: bool,
    ) -> Result<SessionLinkRecord, SubagentError> {
        let subagent_id = subagent_id.map(str::trim).filter(|value| !value.is_empty());
        let child_session_id = child_session_id
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if subagent_id.is_none() && child_session_id.is_none() {
            return Err(SubagentError::TargetRequired);
        }

        let link = if let Some(public_id) = subagent_id {
            self.link_service
                .find_by_public_id(public_id)?
                .filter(|link| {
                    link.relation == SessionLinkRelation::Subagent
                        && link.parent_session_id == parent_session_id
                })
                .ok_or(SubagentError::NotOwned)?
        } else {
            let child_id = child_session_id.expect("checked above");
            if include_closed {
                self.link_service
                    .find_link_by_relation_including_closed(
                        SessionLinkRelation::Subagent,
                        parent_session_id,
                        child_id,
                    )?
                    .ok_or(SubagentError::NotOwned)?
            } else {
                self.authorize_child(parent_session_id, child_id)?
            }
        };

        if child_session_id.is_some_and(|child_id| link.child_session_id != child_id) {
            return Err(SubagentError::ConflictingTarget);
        }
        Ok(link)
    }
}
