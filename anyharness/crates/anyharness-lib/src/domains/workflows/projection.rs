//! Read projections for the API: everything a client renders about a run
//! comes from rows through these shapes, never from live actors. The rendered
//! envelope stays internal — it is an execution detail, not client state.

use serde::Serialize;

use super::model::{
    WorkflowNodeKind, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunDocRecord,
    WorkflowRunNodeRecord, WorkflowRunRecord, WorkflowRunStatus,
};
use super::transition::RunState;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProjection {
    pub id: String,
    pub invocation_id: String,
    pub workspace_id: String,
    pub status: WorkflowRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_node_row_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_code: Option<String>,
    /// The verbatim definition snapshot, parsed for the client.
    pub definition: serde_json::Value,
    pub arguments: serde_json::Value,
    pub nodes: Vec<NodeView>,
    pub docs: Vec<DocView>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_node_id: Option<String>,
    pub kind: WorkflowNodeKind,
    pub node_type: WorkflowNodeType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaces_node_row_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_node_row_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_index: Option<i64>,
    pub title: String,
    pub prompt: String,
    pub status: WorkflowNodeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocView {
    pub id: String,
    pub slug: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub producing_node_row_id: Option<String>,
    pub seeded_from_template: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A one-line summary for workspace listings.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub invocation_id: String,
    pub workspace_id: String,
    pub status: WorkflowRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

pub fn project(state: &RunState, docs: &[WorkflowRunDocRecord]) -> RunProjection {
    RunProjection {
        id: state.run.id.clone(),
        invocation_id: state.run.invocation_id.clone(),
        workspace_id: state.run.workspace_id.clone(),
        status: state.run.status,
        current_node_row_id: state.run.current_node_row_id.clone(),
        failure_code: state.run.failure_code.clone(),
        interruption_code: state
            .run
            .interruption_code
            .map(|code| code.as_str().to_string()),
        definition: serde_json::from_str(&state.run.definition_json)
            .unwrap_or(serde_json::Value::Null),
        arguments: serde_json::from_str(&state.run.arguments_json)
            .unwrap_or(serde_json::Value::Null),
        nodes: state.nodes.iter().map(project_node).collect(),
        docs: docs.iter().map(project_doc).collect(),
        created_at: state.run.created_at.clone(),
        updated_at: state.run.updated_at.clone(),
        completed_at: state.run.completed_at.clone(),
    }
}

fn project_node(node: &WorkflowRunNodeRecord) -> NodeView {
    NodeView {
        id: node.id.clone(),
        definition_node_id: node.definition_node_id.clone(),
        kind: node.kind,
        node_type: node.node_type,
        replaces_node_row_id: node.replaces_node_row_id.clone(),
        anchor_node_row_id: node.anchor_node_row_id.clone(),
        chain_index: node.chain_index,
        title: node.title.clone(),
        prompt: node.prompt.clone(),
        status: node.status,
        session_id: node.session_id.clone(),
        failure_code: node.failure_code.map(|code| code.as_str().to_string()),
        created_at: node.created_at.clone(),
        started_at: node.started_at.clone(),
        completed_at: node.completed_at.clone(),
    }
}

fn project_doc(doc: &WorkflowRunDocRecord) -> DocView {
    DocView {
        id: doc.id.clone(),
        slug: doc.slug.clone(),
        filename: doc.filename.clone(),
        producing_node_row_id: doc.producing_node_row_id.clone(),
        seeded_from_template: doc.seeded_from_template,
        created_at: doc.created_at.clone(),
        updated_at: doc.updated_at.clone(),
    }
}

pub fn summarize(run: &WorkflowRunRecord) -> RunSummary {
    RunSummary {
        id: run.id.clone(),
        invocation_id: run.invocation_id.clone(),
        workspace_id: run.workspace_id.clone(),
        status: run.status,
        failure_code: run.failure_code.clone(),
        interruption_code: run.interruption_code.map(|code| code.as_str().to_string()),
        created_at: run.created_at.clone(),
        updated_at: run.updated_at.clone(),
        completed_at: run.completed_at.clone(),
    }
}
