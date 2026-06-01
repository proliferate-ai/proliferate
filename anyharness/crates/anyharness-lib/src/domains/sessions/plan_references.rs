#[derive(Debug, Clone)]
pub struct ResolvedPlanReference {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub body_markdown: String,
    pub snapshot_hash: String,
    pub source_session_id: String,
    pub source_turn_id: Option<String>,
    pub source_item_id: Option<String>,
    pub source_kind: String,
    pub source_tool_call_id: Option<String>,
}

pub trait PlanReferenceResolver {
    fn resolve_plan_reference(
        &self,
        plan_id: &str,
    ) -> anyhow::Result<Option<ResolvedPlanReference>>;
}

pub trait PlanInteractionLinkResolver: Send + Sync {
    fn has_linked_interaction(&self, session_id: &str, request_id: &str) -> anyhow::Result<bool>;
}

pub fn render_plan_reference_markdown(title: &str, body_markdown: &str) -> String {
    let title = title.trim();
    let body = body_markdown.trim_end();
    if body_starts_with_title_heading(body, title) {
        format!("{body}\n")
    } else {
        format!("# {title}\n\n{body}\n")
    }
}

fn body_starts_with_title_heading(body: &str, title: &str) -> bool {
    let Some(first_line) = body.lines().next() else {
        return false;
    };
    let Some(heading) = first_line.trim().strip_prefix("# ") else {
        return false;
    };
    heading.trim() == title
}

#[cfg(test)]
mod tests {
    use super::render_plan_reference_markdown;

    #[test]
    fn render_markdown_does_not_duplicate_matching_h1() {
        let markdown =
            render_plan_reference_markdown("README pass", "# README pass\n\n- Tighten intro.");
        assert_eq!(markdown, "# README pass\n\n- Tighten intro.\n");
    }

    #[test]
    fn render_markdown_adds_title_when_body_has_no_matching_h1() {
        let markdown = render_plan_reference_markdown("README pass", "Review the desktop folder.");
        assert_eq!(markdown, "# README pass\n\nReview the desktop folder.\n");
    }
}
