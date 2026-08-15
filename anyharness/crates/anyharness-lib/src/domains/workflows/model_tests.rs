//! `session_title` pins the card's index-line format (one-based, two-digit,
//! "--" without a chain position) — the string every node session is named
//! with when the actor links it (PRO-277).

use super::model::{
    WorkflowNodeKind, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunNodeRecord,
};

fn node(chain_index: Option<i64>, title: &str) -> WorkflowRunNodeRecord {
    WorkflowRunNodeRecord {
        id: "row-1".into(),
        run_id: "run-1".into(),
        definition_node_id: None,
        kind: WorkflowNodeKind::Defined,
        node_type: WorkflowNodeType::Agent,
        replaces_node_row_id: None,
        anchor_node_row_id: None,
        chain_index,
        title: title.into(),
        prompt: "p".into(),
        status: WorkflowNodeStatus::Running,
        session_id: None,
        prompt_id: None,
        model: None,
        rendered_envelope: None,
        failure_code: None,
        first_turn_finished_at: None,
        created_at: "now".into(),
        started_at: None,
        completed_at: None,
    }
}

#[test]
fn session_titles_mirror_the_card_index_line() {
    assert_eq!(node(Some(0), "Plan").session_title(), "01 · Plan");
    assert_eq!(node(Some(2), "Ship").session_title(), "03 · Ship");
    assert_eq!(node(None, "Side").session_title(), "-- · Side");
}
