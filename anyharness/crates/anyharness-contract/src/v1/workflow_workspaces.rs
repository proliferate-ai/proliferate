//! Wire contract for isolated Workflow workspace placement (spec
//! `workflow-workspace-placement`). `PUT/GET /v1/workflow-run-workspaces/{runId}`
//! deterministically materializes exactly one isolated, visible, retained
//! ordinary workspace for a Workflow run and returns its `workspaceId`. It stops
//! before accepting or executing the Workflow run.
//!
//! Every request object is strict (`deny_unknown_fields`): the placement is a
//! frozen materialization intent, so an unexpected key is a caller error.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// `PUT /v1/workflow-run-workspaces/{runId}` body. The path `runId` is the
/// canonical UUID later reused by the AnyHarness run and Cloud invocation; it is
/// never carried in the body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutWorkflowRunWorkspaceRequest {
    /// Exactly `1`.
    pub schema_version: u32,
    pub placement: WorkflowWorkspacePlacementRequest,
}

/// The requested placement, as a STRICT discriminated union on `kind`
/// (CONTRACT-01). The generated schema therefore encodes the placement contract
/// itself: `scratch` carries NO repository fields; `repositoryWorktree`
/// REQUIRES both `repoRootId` and `baseRef`. Every variant keeps
/// `deny_unknown_fields` so a nested unknown key or a scratch-with-repo-fields /
/// repository-without-required-fields body is rejected by the type, not merely
/// by the runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum WorkflowWorkspacePlacementRequest {
    /// "No user repository": an internal blank Git repository. No repository
    /// fields are permitted.
    Scratch,
    /// A new deterministic branch/worktree from one immutable source commit.
    #[serde(rename_all = "camelCase")]
    RepositoryWorktree {
        repo_root_id: String,
        base_ref: String,
    },
}

// utoipa's derive does not project `deny_unknown_fields` onto each child of an
// internally tagged enum. Define the exact wire union manually so both variant
// objects carry `additionalProperties: false`, matching serde and the generated
// TypeScript discriminated union.
impl utoipa::PartialSchema for WorkflowWorkspacePlacementRequest {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, OneOfBuilder, Type};

        let scratch = ObjectBuilder::new()
            .schema_type(Type::Object)
            .description(Some(
                "No user repository: an internal blank Git repository. No repository fields are permitted.",
            ))
            .property(
                "kind",
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .enum_values(Some(["scratch"])),
            )
            .required("kind")
            .additional_properties(Some(AdditionalProperties::FreeForm(false)));
        let repository = ObjectBuilder::new()
            .schema_type(Type::Object)
            .description(Some(
                "A new deterministic branch/worktree from one immutable source commit.",
            ))
            .property(
                "kind",
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .enum_values(Some(["repositoryWorktree"])),
            )
            .property("repoRootId", ObjectBuilder::new().schema_type(Type::String))
            .property("baseRef", ObjectBuilder::new().schema_type(Type::String))
            .required("kind")
            .required("repoRootId")
            .required("baseRef")
            .additional_properties(Some(AdditionalProperties::FreeForm(false)));

        OneOfBuilder::new()
            .item(scratch)
            .item(repository)
            .description(Some(
                "Strict workflow workspace placement discriminated by `kind`.",
            ))
            .into()
    }
}

impl ToSchema for WorkflowWorkspacePlacementRequest {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("WorkflowWorkspacePlacementRequest")
    }
}

/// The durable materialization status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowWorkspaceStatus {
    Accepted,
    Materializing,
    Ready,
    Failed,
}

/// The resolved placement echoed on the response. For a repository worktree it
/// exposes the resolved base OID as non-secret correlation; it never exposes
/// credentials or arbitrary runtime paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkflowWorkspaceResolvedPlacement {
    Scratch,
    #[serde(rename_all = "camelCase")]
    RepositoryWorktree {
        repo_root_id: String,
        base_ref: String,
        /// Present once the immutable base OID has been resolved and persisted.
        #[serde(skip_serializing_if = "Option::is_none")]
        base_oid: Option<String>,
    },
}

/// `PUT`/`GET` response for a Workflow run workspace materialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunWorkspaceResponse {
    pub run_id: String,
    pub schema_version: u32,
    pub status: WorkflowWorkspaceStatus,
    pub placement: WorkflowWorkspaceResolvedPlacement,
    /// The durable ordinary workspace id, present once the artifact exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    /// A bounded, secret-free failure code, present only when `status` is
    /// `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}
