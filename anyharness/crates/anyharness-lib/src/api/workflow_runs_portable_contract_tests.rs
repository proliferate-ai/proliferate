//! Portable workflow HTTP contract, dispatch, access, and target-resolution tests.

use std::sync::Mutex;

use axum::http::StatusCode;
use serde_json::{json, Value};

use super::workflow_runs_tests::{get, put, test_state};
use crate::app::test_support;

fn valid_v2_body(workspace_id: &str) -> Value {
    json!({
        "schemaVersion": 2,
        "workspaceId": workspace_id,
        "definition": {
            "inputs": [{ "name": "ticket", "type": "string", "required": true }],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelSelection": {
                        "kind": "exact",
                        "modelId": "definitely-not-a-real-model"
                    },
                    "permissionPolicy": "workflowDefault"
                },
                "steps": [{ "kind": "agent.prompt", "prompt": "Investigate {{inputs.ticket}}" }]
            }]
        },
        "arguments": { "ticket": "PROL-123" }
    })
}

#[test]
fn openapi_documents_model_and_mode_ids_as_required_nullable() {
    // Spec §3.1/§8.1: modelId/modeId are required keys that may be null, and
    // the generated OpenAPI (thus the generated SDK) must say so.
    let doc: Value =
        serde_json::from_str(&super::openapi::openapi_json()).expect("parse openapi document");
    let schema = &doc["components"]["schemas"]["WorkflowRunHarnessConfig"];
    let required: Vec<&str> = schema["required"]
        .as_array()
        .expect("required array")
        .iter()
        .map(|value| value.as_str().expect("required entry"))
        .collect();
    assert!(required.contains(&"agentKind"), "required: {required:?}");
    assert!(required.contains(&"modelId"), "required: {required:?}");
    assert!(required.contains(&"modeId"), "required: {required:?}");
    assert_eq!(
        schema["properties"]["modelId"]["type"],
        json!(["string", "null"])
    );
    assert_eq!(
        schema["properties"]["modeId"]["type"],
        json!(["string", "null"])
    );
}

#[test]
fn openapi_keeps_v1_components_and_adds_versioned_operation_wrappers() {
    let doc: Value =
        serde_json::from_str(&super::openapi::openapi_json()).expect("parse openapi document");
    let schemas = doc["components"]["schemas"]
        .as_object()
        .expect("schemas object");
    for name in [
        "PutWorkflowRunRequest",
        "WorkflowRunResponse",
        "WorkflowRun",
        "WorkflowRunStep",
        "WorkflowRunFailureCode",
        "PutWorkflowRunRequestV2",
        "WorkflowRunResponseV2",
        "VersionedPutWorkflowRunRequest",
        "VersionedWorkflowRunResponse",
    ] {
        assert!(schemas.contains_key(name), "missing component {name}");
    }
    let model_selection = serde_json::to_string(&schemas["WorkflowRunModelSelection"])
        .expect("serialize model selection schema");
    assert!(model_selection.contains("modelId"));
    assert!(!model_selection.contains("model_id"));
    let put = &doc["paths"]["/v1/workflow-runs/{run_id}"]["put"];
    assert_eq!(
        put["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/VersionedPutWorkflowRunRequest"
    );
    for status in ["200", "201", "400", "403", "404", "409", "422", "500"] {
        assert!(
            put["responses"].get(status).is_some(),
            "missing PUT {status}"
        );
    }
}

#[tokio::test]
async fn v2_access_and_target_resolution_fail_before_acceptance() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    let missing_workspace = "39999999-9999-4999-8999-999999999999";
    let mut malformed_prompt = valid_v2_body(missing_workspace);
    malformed_prompt["definition"]["stages"][0]["steps"][0]["prompt"] = json!("{{inputs.missing}}");
    let missing_run = uuid::Uuid::new_v4().to_string();
    let (status, body) = put(&state, &missing_run, malformed_prompt).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "WORKSPACE_NOT_FOUND");
    let (status, _) = get(&state, &missing_run).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "pre-acceptance failure stored a row"
    );

    let workspace_id = "30000000-0000-4000-8000-000000000099";
    test_support::seed_workspace_with_repo_root(
        &state.db,
        workspace_id,
        "worktree",
        "/tmp/workflow-v2-unresolvable",
    );
    let target_run = uuid::Uuid::new_v4().to_string();
    let (status, body) = put(&state, &target_run, valid_v2_body(workspace_id)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "WORKFLOW_RUN_TARGET_UNRESOLVABLE");
    let (status, _) = get(&state, &target_run).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "unresolved target stored a row"
    );
}

#[tokio::test]
async fn schema_version_dispatch_is_strict_for_v1_and_v2() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    for invalid_version in [Value::Null, json!("2"), json!(2.0), json!(3)] {
        let mut body = valid_v2_body("workspace");
        body["schemaVersion"] = invalid_version;
        let (status, response) = put(&state, &uuid::Uuid::new_v4().to_string(), body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(response["code"], "WORKFLOW_RUN_INVALID");
    }

    let mut snake_case = valid_v2_body("workspace");
    let selection = snake_case["definition"]["stages"][0]["harnessConfig"]["modelSelection"]
        .as_object_mut()
        .expect("selection");
    let model_id = selection.remove("modelId").expect("modelId");
    selection.insert("model_id".to_string(), model_id);
    let (status, response) = put(&state, &uuid::Uuid::new_v4().to_string(), snake_case).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(response["code"], "WORKFLOW_RUN_INVALID");
}
