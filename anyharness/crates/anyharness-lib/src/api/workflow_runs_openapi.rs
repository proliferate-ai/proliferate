//! The workflow-runs API surface's own OpenAPI document, merged into the main
//! doc at serve time (the subagents pattern), so `openapi.rs` stays under the
//! max-lines cap while the generated document is byte-identical in content.

use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        super::http::workflow_runs::put_workflow_run,
        super::http::workflow_runs::get_workflow_run,
        super::http::workflow_runs::list_workflow_runs,
        super::http::workflow_run_commands::approve_workflow_node,
        super::http::workflow_run_commands::fail_redo_workflow_node,
        super::http::workflow_run_commands::flip_workflow_node_type,
        super::http::workflow_run_commands::undo_workflow_advance,
        super::http::workflow_run_commands::resume_workflow_run,
        super::http::workflow_run_commands::add_workflow_adhoc_node,
        super::http::workflow_run_commands::cancel_workflow_run,
    ),
    components(schemas(
        super::http::workflow_runs::WorkflowRunPutRequest,
        super::http::workflow_runs::WorkflowRunsListResponse,
        super::http::workflow_run_commands::WorkflowRunFailRedoRequest,
        super::http::workflow_run_commands::WorkflowRunFlipTypeRequest,
        super::http::workflow_run_commands::WorkflowRunAddAdhocNodeRequest,
        crate::domains::workflows::projection::RunProjection,
        crate::domains::workflows::projection::RunView,
        crate::domains::workflows::projection::NodeView,
        crate::domains::workflows::projection::DocView,
        crate::domains::workflows::model::WorkflowRunStatus,
        crate::domains::workflows::model::WorkflowNodeStatus,
        crate::domains::workflows::model::WorkflowNodeKind,
        crate::domains::workflows::model::WorkflowNodeType,
        crate::domains::workflows::definition::WorkflowDefinition,
        crate::domains::workflows::definition::DefinitionNode,
        crate::domains::workflows::definition::DefinitionLeg,
        crate::domains::workflows::definition::NodeModel,
        crate::domains::workflows::definition::DefinitionEdge,
        crate::domains::workflows::definition::DefinitionInput,
        crate::domains::workflows::definition::DocTemplate,
        crate::domains::workflows::definition::InvocationPlacement,
        crate::domains::workflows::definition::PlacementMode,
    ))
)]
pub(super) struct WorkflowRunsApiDoc;
