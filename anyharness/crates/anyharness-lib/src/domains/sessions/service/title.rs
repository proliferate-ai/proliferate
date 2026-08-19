use super::{SessionService, UpdateSessionTitleError};
use crate::domains::sessions::model::{SessionRecord, SESSION_TITLE_MAX_CHARS};

impl SessionService {
    pub fn update_session_title(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<SessionRecord, UpdateSessionTitleError> {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err(UpdateSessionTitleError::EmptyTitle);
        }
        if trimmed.chars().count() > SESSION_TITLE_MAX_CHARS {
            return Err(UpdateSessionTitleError::TitleTooLong(
                SESSION_TITLE_MAX_CHARS,
            ));
        }

        let existing = self
            .session_store
            .find_by_id(session_id)
            .map_err(UpdateSessionTitleError::Internal)?
            .ok_or_else(|| UpdateSessionTitleError::SessionNotFound(session_id.to_string()))?;

        let now = chrono::Utc::now().to_rfc3339();
        self.session_store
            .update_title(session_id, trimmed, &now)
            .map_err(UpdateSessionTitleError::Internal)?;

        let mut updated = existing;
        updated.title = Some(trimmed.to_string());
        updated.updated_at = now;
        Ok(updated)
    }

    /// Applies a fallback title only when the session has none yet; returns
    /// whether it was applied. Used for prompt-derived titles so an assigned
    /// title (user rename or generated summary) is never replaced.
    /// Returns the write's timestamp when it was applied, which identifies
    /// that exact write for [`Self::clear_session_title_write`].
    pub fn update_session_title_if_absent(
        &self,
        session_id: &str,
        title: &str,
    ) -> anyhow::Result<Option<String>> {
        let applied_at = chrono::Utc::now().to_rfc3339();
        let applied = self
            .session_store
            .update_title_if_absent(session_id, title, &applied_at)?;
        Ok(applied.then_some(applied_at))
    }

    /// Undoes one title write, identified by the title it stored and the
    /// timestamp it stored it at; any assignment since carries its own
    /// timestamp and is left in place.
    pub fn clear_session_title_write(
        &self,
        session_id: &str,
        title: &str,
        applied_at: &str,
    ) -> anyhow::Result<bool> {
        self.session_store.clear_title_write(
            session_id,
            title,
            applied_at,
            &chrono::Utc::now().to_rfc3339(),
        )
    }
}
