use crate::domains::sessions::model::SessionRecord;

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

    /// Runs only after the actor has returned `Started` or `Queued`. The
    /// compare-and-set remains best effort: an accepted prompt is never
    /// retroactively failed because its fallback title could not be stored.
    pub(super) fn apply_after_acceptance(
        self,
        runtime: &SessionRuntime,
        session_id: &str,
        mut session: SessionRecord,
    ) -> SessionRecord {
        let Self::FirstAuthoredText(Some(title)) = self else {
            return session;
        };
        if runtime
            .session_service
            .update_session_title_if_absent(session_id, &title)
            .unwrap_or(false)
        {
            session.title = Some(title);
        }
        session
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
