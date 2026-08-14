//! Read projections for the API: everything a client renders about a run
//! comes from rows through these shapes, never from live actors. The wire
//! shape is the ADR API table's `{ run, nodes[], docs[] }`, mirrored
//! field-for-field by the client SDK's hand-authored gen-2 types: camelCase,
//! RAW `definitionJson`/`argumentsJson` strings (the verbatim-snapshot ruling
//! extends to the wire), and nullable fields serialized as explicit `null` —
//! the TS side declares `string | null`, not optional, so omission would be
//! contract drift. The rendered envelope stays internal — it is an execution
//! detail, not client state.

use serde::Serialize;
use utoipa::ToSchema;

use super::model::{
    WorkflowNodeKind, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunDocRecord,
    WorkflowRunNodeRecord, WorkflowRunRecord, WorkflowRunStatus,
};
use super::transition::RunState;

/// The full projection every read and every command returns.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct RunProjection {
    pub run: RunView,
    pub nodes: Vec<NodeView>,
    pub docs: Vec<DocView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub id: String,
    pub invocation_id: String,
    /// The verbatim definition snapshot, exactly as frozen at PUT time.
    pub definition_json: String,
    pub arguments_json: String,
    pub workspace_id: String,
    pub status: WorkflowRunStatus,
    // Nullable fields are REQUIRED in the schema: serde always emits them as
    // explicit `null`, and the TS mirror declares `string | null`, never
    // optional — `required = true` keeps the generated document honest.
    #[schema(required = true)]
    pub current_node_row_id: Option<String>,
    #[schema(required = true)]
    pub failure_code: Option<String>,
    #[schema(required = true)]
    pub interruption_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[schema(required = true)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub id: String,
    pub run_id: String,
    #[schema(required = true)]
    pub definition_node_id: Option<String>,
    pub kind: WorkflowNodeKind,
    pub node_type: WorkflowNodeType,
    #[schema(required = true)]
    pub replaces_node_row_id: Option<String>,
    #[schema(required = true)]
    pub anchor_node_row_id: Option<String>,
    #[schema(required = true)]
    pub chain_index: Option<i64>,
    pub title: String,
    pub prompt: String,
    pub status: WorkflowNodeStatus,
    #[schema(required = true)]
    pub session_id: Option<String>,
    #[schema(required = true)]
    pub prompt_id: Option<String>,
    #[schema(required = true)]
    pub failure_code: Option<String>,
    pub created_at: String,
    #[schema(required = true)]
    pub started_at: Option<String>,
    #[schema(required = true)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocView {
    pub id: String,
    pub run_id: String,
    pub slug: String,
    pub filename: String,
    #[schema(required = true)]
    pub producing_node_row_id: Option<String>,
    pub seeded_from_template: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn project(state: &RunState, docs: &[WorkflowRunDocRecord]) -> RunProjection {
    RunProjection {
        run: run_view(&state.run),
        nodes: state.nodes.iter().map(project_node).collect(),
        docs: docs.iter().map(project_doc).collect(),
    }
}

/// The list route's row shape: the same run view, one per run.
pub fn run_view(run: &WorkflowRunRecord) -> RunView {
    RunView {
        id: run.id.clone(),
        invocation_id: run.invocation_id.clone(),
        definition_json: run.definition_json.clone(),
        arguments_json: run.arguments_json.clone(),
        workspace_id: run.workspace_id.clone(),
        status: run.status,
        current_node_row_id: run.current_node_row_id.clone(),
        failure_code: run.failure_code.clone(),
        interruption_code: run.interruption_code.map(|code| code.as_str().to_string()),
        created_at: run.created_at.clone(),
        updated_at: run.updated_at.clone(),
        completed_at: run.completed_at.clone(),
    }
}

fn project_node(node: &WorkflowRunNodeRecord) -> NodeView {
    NodeView {
        id: node.id.clone(),
        run_id: node.run_id.clone(),
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
        prompt_id: node.prompt_id.clone(),
        failure_code: node.failure_code.map(|code| code.as_str().to_string()),
        created_at: node.created_at.clone(),
        started_at: node.started_at.clone(),
        completed_at: node.completed_at.clone(),
    }
}

fn project_doc(doc: &WorkflowRunDocRecord) -> DocView {
    DocView {
        id: doc.id.clone(),
        run_id: doc.run_id.clone(),
        slug: doc.slug.clone(),
        filename: doc.filename.clone(),
        producing_node_row_id: doc.producing_node_row_id.clone(),
        seeded_from_template: doc.seeded_from_template,
        created_at: doc.created_at.clone(),
        updated_at: doc.updated_at.clone(),
    }
}
