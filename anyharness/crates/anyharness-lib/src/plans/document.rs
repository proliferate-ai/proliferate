use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::model::PlanRecord;

pub fn snapshot_hash(title: &str, body_markdown: &str, source_kind: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    hasher.update([0]);
    hasher.update(body_markdown.as_bytes());
    hasher.update([0]);
    hasher.update(source_kind.as_bytes());
    format_sha256(hasher.finalize().as_slice())
}

pub fn projection_hash(markdown: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(markdown.as_bytes());
    format_sha256(hasher.finalize().as_slice())
}

pub fn render_markdown(plan: &PlanRecord) -> String {
    render_markdown_snapshot(&plan.title, &plan.body_markdown)
}

pub fn render_markdown_snapshot(title: &str, body_markdown: &str) -> String {
    let title = title.trim();
    let body = body_markdown.trim_end();
    if body_starts_with_title_heading(body, title) {
        format!("{body}\n")
    } else {
        format!("# {title}\n\n{body}\n")
    }
}

pub fn projection_path(runtime_home: &Path, workspace_id: &str, plan_id: &str) -> PathBuf {
    runtime_home
        .join("plan-projections")
        .join(workspace_id)
        .join(format!("{plan_id}.md"))
}

pub fn materialize_projection(
    runtime_home: &Path,
    plan: &PlanRecord,
) -> anyhow::Result<(PathBuf, String)> {
    let markdown = render_markdown(plan);
    let path = projection_path(runtime_home, &plan.workspace_id, &plan.id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("md.tmp");
    fs::write(&tmp_path, markdown.as_bytes())?;
    fs::rename(&tmp_path, &path)?;
    Ok((path, projection_hash(&markdown)))
}

fn format_sha256(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
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
    use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};

    use super::render_markdown;
    use crate::plans::model::PlanRecord;

    #[test]
    fn render_markdown_does_not_duplicate_matching_h1() {
        let markdown = render_markdown(&record("# README pass\n\n- Tighten intro."));
        assert_eq!(markdown, "# README pass\n\n- Tighten intro.\n");
    }

    #[test]
    fn render_markdown_adds_title_when_body_has_no_matching_h1() {
        let markdown = render_markdown(&record("Review the desktop folder."));
        assert_eq!(markdown, "# README pass\n\nReview the desktop folder.\n");
    }

    fn record(body_markdown: &str) -> PlanRecord {
        PlanRecord {
            id: "plan-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            session_id: "session-1".to_string(),
            item_id: "plan-1".to_string(),
            title: "README pass".to_string(),
            body_markdown: body_markdown.to_string(),
            snapshot_hash: "hash".to_string(),
            decision_state: ProposedPlanDecisionState::Pending,
            native_resolution_state: ProposedPlanNativeResolutionState::None,
            decision_version: 1,
            source_agent_kind: "codex".to_string(),
            source_kind: "codex_turn_plan".to_string(),
            source_session_id: "session-1".to_string(),
            source_turn_id: Some("turn-1".to_string()),
            source_item_id: Some("item-1".to_string()),
            source_tool_call_id: None,
            superseded_by_plan_id: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }
}
