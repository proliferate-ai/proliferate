//! Wire contract for the one-prompt workflow execution vertical (spec
//! `workflow-runs.md`, revision C2a.3).
//!
//! Every object is strict (`deny_unknown_fields`) at every level: the
//! definition is a frozen executable artifact, so an unexpected key is a
//! caller error, never silently dropped. `modelId`/`modeId` are *required*
//! keys that may carry `null`; see [`nullable_string`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Required-key-but-nullable string. Using `Option::deserialize` (rather than
/// `#[serde(default)]`) keeps the key mandatory while accepting an explicit
/// `null`: an omitted key is a deserialization error, a `null` value yields
/// `None`. This encodes the spec rule that `modelId`/`modeId` must be present
/// as keys but may be null to request existing default behavior.
fn nullable_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

/// `PUT /v1/workflow-runs/{runId}` request body. The `runId` lives in the path
/// only and never appears in the body.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutWorkflowRunRequest {
    pub schema_version: i64,
    pub workspace_id: String,
    pub definition: WorkflowRunDefinition,
    /// Concrete scalar argument values keyed by declared input name. Values are
    /// validated against declared input types after decode; the wire type is
    /// left open so a type mismatch produces our own coded 400 rather than a
    /// serde shape error.
    #[serde(default)]
    pub arguments: BTreeMap<String, serde_json::Value>,
}

/// The frozen executable definition: inputs plus exactly one stage.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunDefinition {
    #[serde(default)]
    pub inputs: Vec<WorkflowRunInput>,
    pub stages: Vec<WorkflowRunStage>,
}

/// A declared scalar input.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunInput {
    pub name: String,
    #[serde(rename = "type")]
    pub input_type: WorkflowRunInputType,
    pub required: bool,
}

/// The only permitted input types (scalars). Defaults, arrays, objects,
/// choices, and secret types are rejected by omission from this enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowRunInputType {
    String,
    Number,
    Boolean,
}

/// Exactly one stage: a harness configuration plus exactly one prompt step.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunStage {
    pub harness_config: WorkflowRunHarnessConfig,
    pub steps: Vec<WorkflowRunPromptStep>,
}

/// Harness selection for the stage's session.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunHarnessConfig {
    pub agent_kind: String,
    /// Required key; `null` requests the target-default model. The
    /// `schema(required)` override keeps the generated OpenAPI/SDK in sync
    /// with the wire rule (present key, nullable value) that `nullable_string`
    /// enforces at deserialization.
    #[serde(deserialize_with = "nullable_string")]
    #[schema(required = true)]
    pub model_id: Option<String>,
    /// Required key; `null` requests existing `SessionRuntime` mode behavior.
    #[serde(deserialize_with = "nullable_string")]
    #[schema(required = true)]
    pub mode_id: Option<String>,
}

/// The single `agent.prompt` step.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRunPromptStep {
    pub kind: String,
    pub prompt: String,
}

/// Durable run status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    Accepted,
    Running,
    Completed,
    Failed,
}

/// Durable step status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

/// PUT/GET response envelope.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResponse {
    pub run: WorkflowRun,
    pub steps: Vec<WorkflowRunStep>,
}

/// The durable run view.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: String,
    pub schema_version: i64,
    pub definition: WorkflowRunDefinition,
    pub arguments: BTreeMap<String, serde_json::Value>,
    pub status: WorkflowRunStatus,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

/// The durable materialized step view.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunStep {
    pub stage_index: i64,
    pub step_index: i64,
    pub status: WorkflowRunStepStatus,
    pub prompt_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_request_json() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "workspaceId": "20000000-0000-4000-8000-000000000002",
            "definition": {
                "inputs": [
                    { "name": "ticket", "type": "string", "required": true }
                ],
                "stages": [
                    {
                        "harnessConfig": {
                            "agentKind": "claude",
                            "modelId": "claude-sonnet-4-5",
                            "modeId": "bypassPermissions"
                        },
                        "steps": [
                            { "kind": "agent.prompt", "prompt": "Investigate {{inputs.ticket}}" }
                        ]
                    }
                ]
            },
            "arguments": { "ticket": "PROL-123" }
        })
    }

    #[test]
    fn request_round_trips_camel_case() {
        let request: PutWorkflowRunRequest =
            serde_json::from_value(valid_request_json()).expect("decode request");
        assert_eq!(request.schema_version, 1);
        assert_eq!(request.workspace_id, "20000000-0000-4000-8000-000000000002");
        assert_eq!(request.definition.inputs.len(), 1);
        assert_eq!(
            request.definition.inputs[0].input_type,
            WorkflowRunInputType::String
        );
        let stage = &request.definition.stages[0];
        assert_eq!(stage.harness_config.agent_kind, "claude");
        assert_eq!(
            stage.harness_config.model_id.as_deref(),
            Some("claude-sonnet-4-5")
        );
        assert_eq!(stage.steps[0].kind, "agent.prompt");
    }

    #[test]
    fn null_model_and_mode_ids_are_accepted() {
        let mut json = valid_request_json();
        json["definition"]["stages"][0]["harnessConfig"]["modelId"] = serde_json::Value::Null;
        json["definition"]["stages"][0]["harnessConfig"]["modeId"] = serde_json::Value::Null;
        let request: PutWorkflowRunRequest =
            serde_json::from_value(json).expect("decode with null model/mode");
        assert!(request.definition.stages[0]
            .harness_config
            .model_id
            .is_none());
        assert!(request.definition.stages[0]
            .harness_config
            .mode_id
            .is_none());
    }

    #[test]
    fn missing_model_id_key_is_rejected() {
        let mut json = valid_request_json();
        let config = json["definition"]["stages"][0]["harnessConfig"]
            .as_object_mut()
            .expect("harness config object");
        config.remove("modelId");
        let result: Result<PutWorkflowRunRequest, _> = serde_json::from_value(json);
        assert!(result.is_err(), "modelId key must be required");
    }

    #[test]
    fn unknown_field_is_rejected_at_every_level() {
        // Top-level.
        let mut json = valid_request_json();
        json["surprise"] = serde_json::json!(true);
        assert!(serde_json::from_value::<PutWorkflowRunRequest>(json).is_err());

        // Nested harness config.
        let mut json = valid_request_json();
        json["definition"]["stages"][0]["harnessConfig"]["surprise"] = serde_json::json!(1);
        assert!(serde_json::from_value::<PutWorkflowRunRequest>(json).is_err());

        // Nested step.
        let mut json = valid_request_json();
        json["definition"]["stages"][0]["steps"][0]["surprise"] = serde_json::json!("x");
        assert!(serde_json::from_value::<PutWorkflowRunRequest>(json).is_err());

        // Nested input.
        let mut json = valid_request_json();
        json["definition"]["inputs"][0]["surprise"] = serde_json::json!("x");
        assert!(serde_json::from_value::<PutWorkflowRunRequest>(json).is_err());
    }

    #[test]
    fn harness_config_schema_requires_nullable_model_and_mode_ids() {
        // The wire rule (spec §3.1): modelId/modeId are REQUIRED keys that may
        // be null. The generated OpenAPI must document the same contract the
        // deserializer enforces.
        let schema = <WorkflowRunHarnessConfig as utoipa::PartialSchema>::schema();
        let json = serde_json::to_value(&schema).expect("serialize schema");
        let required: Vec<&str> = json["required"]
            .as_array()
            .expect("required array")
            .iter()
            .map(|value| value.as_str().expect("required entry"))
            .collect();
        assert!(required.contains(&"agentKind"), "required: {required:?}");
        assert!(required.contains(&"modelId"), "required: {required:?}");
        assert!(required.contains(&"modeId"), "required: {required:?}");
        // Still nullable: the value type admits null alongside string.
        let model_type = &json["properties"]["modelId"]["type"];
        assert_eq!(
            model_type,
            &serde_json::json!(["string", "null"]),
            "modelId type: {model_type:?}"
        );
    }

    #[test]
    fn response_serializes_camel_case_and_omits_absent_optionals() {
        let response = WorkflowRunResponse {
            run: WorkflowRun {
                id: "11111111-1111-4111-8111-111111111111".to_string(),
                schema_version: 1,
                definition: WorkflowRunDefinition {
                    inputs: Vec::new(),
                    stages: Vec::new(),
                },
                arguments: BTreeMap::new(),
                status: WorkflowRunStatus::Accepted,
                workspace_id: "ws".to_string(),
                session_id: None,
                failure_code: None,
                created_at: "2026-07-13T00:00:00+00:00".to_string(),
                updated_at: "2026-07-13T00:00:00+00:00".to_string(),
                started_at: None,
                finished_at: None,
            },
            steps: vec![WorkflowRunStep {
                stage_index: 0,
                step_index: 0,
                status: WorkflowRunStepStatus::Pending,
                prompt_id: "workflow:11111111-1111-4111-8111-111111111111:0:0".to_string(),
                turn_id: None,
                failure_code: None,
                created_at: "2026-07-13T00:00:00+00:00".to_string(),
                updated_at: "2026-07-13T00:00:00+00:00".to_string(),
                started_at: None,
                finished_at: None,
            }],
        };

        let json = serde_json::to_value(&response).expect("serialize response");
        assert_eq!(json["run"]["schemaVersion"], 1);
        assert_eq!(json["run"]["status"], "accepted");
        assert_eq!(json["steps"][0]["status"], "pending");
        assert_eq!(json["steps"][0]["stageIndex"], 0);
        assert!(json["run"].get("sessionId").is_none());
        assert!(json["run"].get("failureCode").is_none());
        assert!(json["steps"][0].get("turnId").is_none());
    }
}
