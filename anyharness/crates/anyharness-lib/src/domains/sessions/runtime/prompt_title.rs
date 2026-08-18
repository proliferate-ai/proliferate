use crate::domains::sessions::model::SessionRecord;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError};

use super::SessionRuntime;

const PROMPT_TITLE_MAX_CHARS: usize = 160;

pub(super) enum PromptTitleAssignment {
    Disabled,
    FirstAuthoredText(Option<String>),
}

impl PromptTitleAssignment {
    pub(super) fn from_authored_texts<'a>(texts: impl IntoIterator<Item = &'a str>) -> Self {
        Self::FirstAuthoredText(normalize_first_authored_text(texts))
    }

    /// Stores the title before the prompt reaches the actor. Authored titles
    /// and harness `session_info_update` titles compete for one absent-only
    /// write, so writing ahead of dispatch is what keeps a title the same turn
    /// reports from taking the row. The compare-and-set stays best effort: an
    /// accepted prompt is never failed because its title could not be stored.
    pub(super) fn apply_before_dispatch(
        self,
        runtime: &SessionRuntime,
        session_id: &str,
    ) -> AssignedPromptTitle {
        let Self::FirstAuthoredText(Some(title)) = self else {
            return AssignedPromptTitle(None);
        };
        AssignedPromptTitle(
            runtime
                .session_service
                .update_session_title_if_absent(session_id, &title)
                .unwrap_or(false)
                .then_some(title),
        )
    }
}

/// The title this dispatch stored, held so the write can be reflected in the
/// returned snapshot and undone when the dispatch turns out to have failed.
pub(super) struct AssignedPromptTitle(Option<String>);

impl AssignedPromptTitle {
    pub(super) fn merge_into(&self, mut session: SessionRecord) -> SessionRecord {
        if let Some(title) = self.0.as_ref() {
            session.title = Some(title.clone());
        }
        session
    }

    /// Undoes the write when the prompt verifiably never reached the actor. A
    /// dropped acknowledgement is ambiguous - the turn may be running - so the
    /// title stays, and a title reassigned since is left alone by the match.
    pub(super) fn revert_if_undelivered(
        &self,
        runtime: &SessionRuntime,
        session_id: &str,
        error: &LiveSessionCommandError<PromptAcceptError>,
    ) {
        let Some(title) = self.0.as_deref() else {
            return;
        };
        if matches!(error, LiveSessionCommandError::ResponseDropped) {
            return;
        }
        let _ = runtime
            .session_service
            .clear_session_title_if_matches(session_id, title);
    }
}

pub(super) fn normalize_first_authored_text<'a>(
    texts: impl IntoIterator<Item = &'a str>,
) -> Option<String> {
    let text = texts.into_iter().find_map(|text| {
        let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        (!collapsed.is_empty()).then_some(collapsed)
    })?;
    Some(
        text.chars()
            .take(PROMPT_TITLE_MAX_CHARS)
            .collect::<String>()
            .trim_end()
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizer_uses_first_authored_text_and_collapses_unicode_whitespace() {
        assert_eq!(
            normalize_first_authored_text([
                " \t\n",
                "  Inspect\u{2003}the\u{3000}replay  ",
                "later"
            ])
            .as_deref(),
            Some("Inspect the replay")
        );
    }

    #[test]
    fn normalizer_omits_blank_text() {
        assert_eq!(normalize_first_authored_text([" \n\t", "\u{2003}"]), None);
        assert_eq!(normalize_first_authored_text(std::iter::empty()), None);
    }

    #[test]
    fn normalizer_caps_unicode_scalars_and_removes_trailing_space() {
        let unicode = format!("{} tail", "🦀".repeat(PROMPT_TITLE_MAX_CHARS));
        let unicode_title = normalize_first_authored_text([unicode.as_str()]).expect("title");
        assert_eq!(unicode_title.chars().count(), PROMPT_TITLE_MAX_CHARS);
        assert_eq!(unicode_title, "🦀".repeat(PROMPT_TITLE_MAX_CHARS));

        let space_at_cap = "word ".repeat(40);
        let capped = normalize_first_authored_text([space_at_cap.as_str()]).expect("title");
        assert!(capped.chars().count() <= PROMPT_TITLE_MAX_CHARS);
        assert!(!capped.ends_with(' '));
    }
}
