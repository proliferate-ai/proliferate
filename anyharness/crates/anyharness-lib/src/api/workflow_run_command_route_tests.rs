//! Tier-1 tests for the six workflow command routes, over the same real
//! fixture as `workflow_runs_route_tests`: every command answers with the
//! fresh projection, unknown run/node map to their distinct 404 codes, and
//! the transition table's refusal is the 409.

use axum::http::{Method, StatusCode};
use serde_json::{json, Value};

use super::workflow_runs_route_tests::{fixture, run_uuid, single_node_definition};
use crate::domains::workflows::model::{WorkflowNodeStatus, WorkflowRunStatus};

fn node<'a>(projection: &'a Value, node_row_id: &str) -> &'a Value {
    projection["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["id"] == json!(node_row_id))
        .expect("node in projection")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn commands_return_projections_and_map_the_error_codes() {
    let fixture = fixture("wf-route-commands").await;
    let run_id = run_uuid(0x20);
    let body = fixture.snapshot(json!({
        "schemaVersion": 2,
        "nodes": [
            { "id": "review", "type": "human_in_loop", "title": "Review", "prompt": "summarize" },
            { "id": "ship", "type": "agent", "title": "Ship", "prompt": "ship it" }
        ],
        "edges": [ { "from": "review", "to": "ship" } ],
        "inputs": [],
        "docTemplates": [],
    }));
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");

    // Commands on ghosts: unknown run 404s with the run code, unknown node
    // 404s with the node code.
    let ghost_run = run_uuid(0x21);
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{ghost_run}/nodes/whatever/approve"),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_RUN_NOT_FOUND");
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/nodes/ghost-node/approve"),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_NODE_NOT_FOUND");

    fixture
        .wait_for_run(&run_id, "gate parks", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let state = fixture
        .state
        .workflow_store
        .load_run_state(&run_id)
        .expect("load")
        .expect("run");
    let gate = state
        .nodes
        .iter()
        .find(|node| node.definition_node_id.as_deref() == Some("review"))
        .expect("gate row");
    assert_eq!(gate.status, WorkflowNodeStatus::AwaitingHuman);

    // Approve answers with the fresh projection: the gate is completed in the
    // response body itself, no follow-up read.
    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/nodes/{}/approve", gate.id),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    assert_eq!(node(&projection, &gate.id)["status"], "completed");

    // A second approve is the transition table's refusal: 409 naming the
    // command and the state it was refused in.
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/nodes/{}/approve", gate.id),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_TRANSITION_ILLEGAL");
    let detail = problem["detail"].as_str().expect("detail");
    assert!(detail.contains("approve_gate"), "{detail}");

    fixture
        .wait_for_run(&run_id, "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fail_redo_answers_with_the_superseded_row_and_its_replacement() {
    let fixture = fixture("wf-route-fail-redo").await;
    let run_id = run_uuid(0x22);
    let body = fixture.snapshot(single_node_definition("blocking turn"));
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    let wedged_row_id = projection["nodes"][0]["id"].as_str().expect("row id");
    fixture.wait_for_control("turn-seen").await;

    // Redo-from-running (Ruling L): the reply already shows the old row
    // superseded AND the replacement launched — dispose-then-start happened
    // before the oneshot resolved.
    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/nodes/{wedged_row_id}/fail-redo"),
            Some(json!({ "prompt": "redo it" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    let superseded = node(&projection, wedged_row_id);
    assert_eq!(superseded["status"], "failed");
    assert_eq!(superseded["failureCode"], "superseded");
    let replacement = projection["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["replacesNodeRowId"] == json!(wedged_row_id))
        .expect("replacement row in the reply");
    assert_eq!(replacement["prompt"], "redo it");
    assert!(replacement["sessionId"].is_string(), "{projection}");

    fixture
        .wait_for_run(&run_id, "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn flip_type_flips_a_pending_node_and_the_flip_governs_the_advance() {
    let fixture = fixture("wf-route-flip").await;
    let run_id = run_uuid(0x23);
    let body = fixture.snapshot(json!({
        "schemaVersion": 2,
        "nodes": [
            { "id": "solo", "type": "agent", "title": "Solo", "prompt": "blocking turn" },
            { "id": "ship", "type": "agent", "title": "Ship", "prompt": "then ship" }
        ],
        "edges": [ { "from": "solo", "to": "ship" } ],
        "inputs": [],
        "docTemplates": [],
    }));
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    let ship_row_id = projection["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["definitionNodeId"] == "ship")
        .expect("pending ship row")["id"]
        .as_str()
        .expect("row id")
        .to_string();
    fixture.wait_for_control("turn-seen").await;

    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/nodes/{ship_row_id}/type"),
            Some(json!({ "nodeType": "human_in_loop" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    assert_eq!(node(&projection, &ship_row_id)["nodeType"], "human_in_loop");

    // The flip governs: after its turn, ship parks as a gate instead of
    // completing the run.
    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&run_id, "flipped gate parks", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/nodes/{ship_row_id}/approve"),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    fixture
        .wait_for_run(&run_id, "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn undo_advance_and_resume_map_the_illegal_and_missing_codes() {
    let fixture = fixture("wf-route-undo-resume").await;
    let run_id = run_uuid(0x24);
    let body = fixture.snapshot(single_node_definition("blocking turn"));
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");

    // No advance has happened: the undo window is closed and the table's
    // refusal is the 409.
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/undo-advance"),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_TRANSITION_ILLEGAL");

    // Resume on a run that is not interrupted is refused the same way.
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/resume"),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_TRANSITION_ILLEGAL");

    // Both routes 404 with the run code on a ghost run.
    let ghost_run = run_uuid(0x25);
    for route in ["undo-advance", "resume"] {
        let (status, problem) = fixture
            .request(
                Method::POST,
                &format!("/v1/workflow-runs/{ghost_run}/{route}"),
                Some(json!({})),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{route}");
        assert_eq!(problem["code"], "WORKFLOW_RUN_NOT_FOUND", "{route}");
    }

    fixture.wait_for_control("turn-seen").await;
    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&run_id, "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_answers_with_the_cancelled_projection_and_disposes_the_running_session() {
    let fixture = fixture("wf-route-cancel").await;
    let run_id = run_uuid(0x27);
    let body = fixture.snapshot(single_node_definition("blocking turn"));
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    let wedged_row_id = projection["nodes"][0]["id"].as_str().expect("row id");
    fixture.wait_for_control("turn-seen").await;

    // The QA finding this closes: a wedged (never-ending) turn had no way to
    // stop the run. Cancel answers with the run and its running node both
    // cancelled in the same reply — the live session was disposed before the
    // oneshot resolved, same persist-before-act shape as fail-redo.
    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/cancel"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    assert_eq!(projection["run"]["status"], "cancelled");
    assert_eq!(node(&projection, wedged_row_id)["status"], "cancelled");

    // A cancelled run is terminal: a second cancel is the transition table's
    // refusal, same 409 shape as every other command.
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/cancel"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_TRANSITION_ILLEGAL");
    let detail = problem["detail"].as_str().expect("detail");
    assert!(detail.contains("cancel"), "{detail}");

    // A ghost run 404s with the run code, same as every other command route.
    let ghost_run = run_uuid(0x28);
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{ghost_run}/cancel"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_RUN_NOT_FOUND");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn adhoc_nodes_launch_beside_the_chain_via_the_route() {
    let fixture = fixture("wf-route-adhoc").await;
    let run_id = run_uuid(0x26);
    let body = fixture.snapshot(single_node_definition("blocking turn"));
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    let anchor_row_id = projection["nodes"][0]["id"].as_str().expect("row id");
    fixture.wait_for_control("turn-seen").await;

    // A ghost anchor is the node 404, not a transition refusal.
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/adhoc-nodes"),
            Some(json!({ "anchorNodeRowId": "ghost-node", "prompt": "side job" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_NODE_NOT_FOUND");

    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/{run_id}/adhoc-nodes"),
            Some(json!({
                "anchorNodeRowId": anchor_row_id,
                "prompt": "adhoc side job",
                "model": { "agentKind": "claude", "modelId": "haiku" },
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    // The reply carries the launched adhoc row beside the untouched chain.
    assert_eq!(projection["run"]["status"], "running");
    let adhoc = projection["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["kind"] == "adhoc")
        .expect("adhoc row in the reply");
    assert_eq!(adhoc["anchorNodeRowId"], json!(anchor_row_id));
    assert_eq!(adhoc["prompt"], "adhoc side job");
    assert!(adhoc["sessionId"].is_string(), "{projection}");

    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&run_id, "run and adhoc settle", |state| {
            state.run.status == WorkflowRunStatus::Completed
                && state.nodes.iter().all(|node| {
                    matches!(
                        node.status,
                        WorkflowNodeStatus::Completed | WorkflowNodeStatus::Failed
                    )
                })
        })
        .await;
}
