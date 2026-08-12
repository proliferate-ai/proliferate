use serde_json::{json, Value};

use super::*;

const MAX_TOOL_RESPONSE_BYTES: usize = 65_536;
const INVALID_ARGUMENTS_CODE: &str = "WORKSPACE_MCP_ARGUMENTS_INVALID";
const INVALID_ARGUMENTS_MESSAGE: &str = "Workspace tool arguments are invalid.";

#[derive(Clone, Copy)]
enum ValidCallOutcome {
    Success,
    DomainError(&'static str),
}

struct ToolCallCase {
    name: &'static str,
    arguments: Value,
    outcome: ValidCallOutcome,
}

fn valid_tool_calls() -> Vec<ToolCallCase> {
    use ValidCallOutcome::{DomainError, Success};

    vec![
        ToolCallCase {
            name: "whoami",
            arguments: json!({}),
            outcome: Success,
        },
        ToolCallCase {
            name: "list_workspaces",
            arguments: json!({}),
            outcome: Success,
        },
        ToolCallCase {
            name: "list_workspace_options",
            arguments: json!({}),
            outcome: Success,
        },
        ToolCallCase {
            name: "list_agents",
            arguments: json!({ "limit": 10 }),
            outcome: Success,
        },
        ToolCallCase {
            name: "get_agent",
            arguments: json!({ "agentId": "P" }),
            outcome: Success,
        },
        ToolCallCase {
            name: "list_subagents",
            arguments: json!({}),
            outcome: Success,
        },
        ToolCallCase {
            name: "list_agent_launch_options",
            arguments: json!({ "workspaceId": "workspace-a" }),
            outcome: DomainError("WORKSPACE_CATALOGS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "list_agent_config_options",
            arguments: json!({ "agentId": "P" }),
            outcome: DomainError("WORKSPACE_CATALOGS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "get_task_output",
            arguments: json!({ "agentId": "P", "limit": 10 }),
            outcome: DomainError("AGENT_OPERATIONS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "create_workspace",
            arguments: json!({
                "repositoryId": "repo-missing",
                "creationMode": "local"
            }),
            outcome: DomainError("WORKSPACE_REPOSITORY_NOT_FOUND"),
        },
        ToolCallCase {
            name: "create_agent",
            arguments: json!({
                "workspaceId": "workspace-a",
                "kind": "ordinary"
            }),
            outcome: DomainError("WORKSPACE_CATALOGS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "configure_agent",
            arguments: json!({
                "agentId": "P",
                "configId": "effort",
                "value": "high"
            }),
            outcome: DomainError("WORKSPACE_CATALOGS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "resume_agent",
            arguments: json!({ "agentId": "P" }),
            outcome: DomainError("AGENT_OPERATIONS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "send_message",
            arguments: json!({
                "agentId": "Q",
                "message": "contract coverage"
            }),
            outcome: Success,
        },
        ToolCallCase {
            name: "interrupt_agent",
            arguments: json!({ "agentId": "P" }),
            outcome: DomainError("AGENT_OPERATIONS_UNAVAILABLE"),
        },
        ToolCallCase {
            name: "close_subagent",
            arguments: json!({ "agentId": "C" }),
            outcome: Success,
        },
        ToolCallCase {
            name: "open_subagent",
            arguments: json!({ "agentId": "C" }),
            outcome: Success,
        },
        ToolCallCase {
            name: "promote_subagent",
            arguments: json!({ "agentId": "C" }),
            outcome: Success,
        },
    ]
}

fn malformed_tool_calls() -> Vec<(&'static str, Value)> {
    vec![
        ("whoami", json!({ "unexpected": true })),
        ("list_workspaces", json!({ "limit": "many" })),
        ("list_workspace_options", json!({ "unexpected": true })),
        ("list_agents", json!({ "status": "unknown" })),
        ("get_agent", json!({})),
        ("list_subagents", json!({ "unexpected": true })),
        ("list_agent_launch_options", json!({})),
        ("list_agent_config_options", json!({})),
        (
            "get_task_output",
            json!({ "agentId": "P", "limit": "many" }),
        ),
        (
            "create_workspace",
            json!({ "repositoryId": "repo-missing" }),
        ),
        (
            "create_agent",
            json!({ "workspaceId": "workspace-a", "kind": "unknown" }),
        ),
        (
            "configure_agent",
            json!({ "agentId": "P", "configId": "effort" }),
        ),
        ("resume_agent", json!({})),
        ("send_message", json!({ "agentId": "Q" })),
        ("interrupt_agent", json!({})),
        ("close_subagent", json!({})),
        ("open_subagent", json!({})),
        ("promote_subagent", json!({})),
    ]
}

fn assert_exact_tool_coverage(names: impl IntoIterator<Item = &'static str>) {
    assert_eq!(names.into_iter().collect::<Vec<_>>(), tools::TOOL_NAMES);
}

async fn dispatch_tool_call(
    server: &WorkspaceProductMcpServer,
    token: &str,
    id: usize,
    name: &str,
    arguments: Value,
) -> Value {
    authenticated_dispatch(
        server,
        token,
        context("workspace-a", "P"),
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments }
        }),
    )
    .await
    .expect("authenticated tool dispatch")
    .expect("tools/call response")
}

fn assert_bounded(response: &Value, name: &str) {
    let len = serde_json::to_vec(response)
        .expect("serialize tools/call response")
        .len();
    assert!(
        len <= MAX_TOOL_RESPONSE_BYTES,
        "{name} response exceeded {MAX_TOOL_RESPONSE_BYTES} bytes: {len}"
    );
}

#[tokio::test]
async fn every_workspace_tool_accepts_one_schema_valid_call_through_the_dispatcher() {
    let cases = valid_tool_calls();
    assert_exact_tool_coverage(cases.iter().map(|case| case.name));

    let (server, auth, _) = server();
    let token = auth
        .mint_capability_token("workspace-a", "P")
        .expect("mint Workspace capability token");

    for (id, case) in cases.into_iter().enumerate() {
        let response = dispatch_tool_call(&server, &token, id + 1, case.name, case.arguments).await;
        assert_bounded(&response, case.name);
        let result = &response["result"];
        match case.outcome {
            ValidCallOutcome::Success => assert_eq!(
                result["isError"], false,
                "{} rejected schema-valid arguments: {response}",
                case.name
            ),
            ValidCallOutcome::DomainError(expected_code) => {
                assert_eq!(result["isError"], true, "{}: {response}", case.name);
                assert_eq!(
                    result["structuredContent"]["error"]["code"], expected_code,
                    "{} must reach its domain owner after argument validation",
                    case.name
                );
            }
        }
        assert_ne!(
            result["structuredContent"]["error"]["code"], INVALID_ARGUMENTS_CODE,
            "{} treated schema-valid arguments as malformed",
            case.name
        );
    }
}

#[tokio::test]
async fn every_workspace_tool_rejects_one_schema_invalid_call_through_the_dispatcher() {
    let cases = malformed_tool_calls();
    assert_exact_tool_coverage(cases.iter().map(|(name, _)| *name));

    let (server, auth, _) = server();
    let token = auth
        .mint_capability_token("workspace-a", "P")
        .expect("mint Workspace capability token");

    for (id, (name, arguments)) in cases.into_iter().enumerate() {
        let response = dispatch_tool_call(&server, &token, id + 1, name, arguments).await;
        assert_bounded(&response, name);
        assert_eq!(response["result"]["isError"], true, "{name}: {response}");
        assert_eq!(
            response["result"]["structuredContent"]["error"],
            json!({
                "code": INVALID_ARGUMENTS_CODE,
                "message": INVALID_ARGUMENTS_MESSAGE,
            }),
            "{name} did not return the bounded malformed-input receipt"
        );
    }
}
