//! Portable schema-v2 workflow-run wire contract.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::workflow_runs::{
    PutWorkflowRunRequest, WorkflowRunArgumentValue, WorkflowRunInput, WorkflowRunPromptStep,
    WorkflowRunResponse, WorkflowRunStatus, WorkflowRunStepStatus,
};

/// Operation-level PUT union. API decoding first inspects the required integer
/// `schemaVersion`, then strictly decodes the selected member.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum VersionedPutWorkflowRunRequest {
    V1(PutWorkflowRunRequest),
    V2(PutWorkflowRunRequestV2),
}

/// Schema-v2 portable invocation. Model, mode, and optional effort are target
/// intent until AnyHarness resolves and persists a concrete plan.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutWorkflowRunRequestV2 {
    pub schema_version: i64,
    pub workspace_id: String,
    pub definition: WorkflowRunDefinitionV2,
    #[serde(default)]
    pub arguments: BTreeMap<String, WorkflowRunArgumentValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunDefinitionV2 {
    #[serde(default)]
    pub inputs: Vec<WorkflowRunInput>,
    pub stages: Vec<WorkflowRunStageV2>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunStageV2 {
    pub harness_config: WorkflowRunHarnessConfigV2,
    pub steps: Vec<WorkflowRunPromptStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunHarnessConfigV2 {
    pub agent_kind: String,
    pub model_selection: WorkflowRunModelSelection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    pub permission_policy: WorkflowRunPermissionPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkflowRunModelSelection {
    TargetDefault,
    Exact {
        #[serde(rename = "modelId")]
        #[schema(rename = "modelId")]
        model_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowRunPermissionPolicy {
    WorkflowDefault,
}

/// V2 extends, but does not widen, the stable V1 failure-code component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunFailureCodeV2 {
    WorkspaceUnavailable,
    SessionCreateFailed,
    SessionStartFailed,
    PromptDispatchFailed,
    SessionTurnFailed,
    SessionTurnCancelled,
    RuntimeRestarted,
    SessionConfigApplyFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResolvedHarnessV2 {
    pub agent_kind: String,
    pub model_id: String,
    pub mode_id: String,
    #[schema(required = true)]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResponseV2 {
    pub run: WorkflowRunV2,
    pub steps: Vec<WorkflowRunStepV2>,
    pub resolved_harness: WorkflowRunResolvedHarnessV2,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunV2 {
    pub id: String,
    pub schema_version: i64,
    pub definition: WorkflowRunDefinitionV2,
    pub arguments: BTreeMap<String, WorkflowRunArgumentValue>,
    pub status: WorkflowRunStatus,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<WorkflowRunFailureCodeV2>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunStepV2 {
    pub stage_index: i64,
    pub step_index: i64,
    pub status: WorkflowRunStepStatus,
    pub prompt_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<WorkflowRunFailureCodeV2>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum VersionedWorkflowRunResponse {
    V1(WorkflowRunResponse),
    V2(WorkflowRunResponseV2),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::v1::WorkflowRunFailureCode;

    #[test]
    fn exact_model_uses_model_id_and_is_strict() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/contracts/workflow-portable-execution/v1.json"
        ))
        .expect("portable workflow fixture");
        let request: PutWorkflowRunRequestV2 =
            serde_json::from_value(fixture["anyHarnessRequest"].clone())
                .expect("decode v2 fixture");
        let encoded = serde_json::to_value(&request).expect("encode v2 request");
        let selection = &encoded["definition"]["stages"][0]["harnessConfig"]["modelSelection"];
        assert_eq!(selection["kind"], "exact");
        assert_eq!(selection["modelId"], "claude-sonnet-4-5");
        assert!(selection.get("model_id").is_none());

        let mut unknown = fixture["anyHarnessRequest"].clone();
        unknown["definition"]["stages"][0]["harnessConfig"]["modelSelection"]["extra"] =
            serde_json::json!(true);
        assert!(serde_json::from_value::<PutWorkflowRunRequestV2>(unknown).is_err());
    }

    #[test]
    fn v1_failure_component_does_not_gain_v2_only_code() {
        assert!(
            serde_json::from_str::<WorkflowRunFailureCode>("\"session_config_apply_failed\"")
                .is_err()
        );
        assert_eq!(
            serde_json::to_string(&WorkflowRunFailureCodeV2::SessionConfigApplyFailed)
                .expect("serialize v2 failure"),
            "\"session_config_apply_failed\""
        );
    }
}
