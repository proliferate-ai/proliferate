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
    pub fn update_session_title_if_absent(
        &self,
        session_id: &str,
        title: &str,
    ) -> anyhow::Result<bool> {
        self.session_store.update_title_if_absent(
            session_id,
            title,
            &chrono::Utc::now().to_rfc3339(),
        )
    }

    /// Undoes a prompt title stored before dispatch; returns whether it was
    /// still the stored title. A title assigned since is left in place.
    pub fn clear_session_title_if_matches(
        &self,
        session_id: &str,
        title: &str,
    ) -> anyhow::Result<bool> {
        self.session_store.clear_title_if_matches(
            session_id,
            title,
            &chrono::Utc::now().to_rfc3339(),
        )
    }
}
