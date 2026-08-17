use serde_json::json;

use super::*;
use crate::domains::agent_operations::model::WorkspacePinIntent;
use crate::domains::agent_operations::runtime::AgentWorkspacePinEvents;

pub(super) struct WorkspacePinEvents(pub(super) Mutex<Vec<(String, WorkspacePinIntent)>>);

#[async_trait]
impl AgentWorkspacePinEvents for WorkspacePinEvents {
    async fn emit_workspace_pin_intent(
        &self,
        session_id: &str,
        intent: WorkspacePinIntent,
    ) -> anyhow::Result<()> {
        self.0.lock().unwrap().push((session_id.into(), intent));
        Ok(())
    }
}

#[tokio::test]
async fn tools_return_correlated_requests_and_validate_the_target() {
    let (server, auth, _, workspace_pin_events) = server();
    let token = auth
        .mint_capability_token("workspace-a", "P")
        .expect("mint Workspace capability token");

    for (id, (tool_name, pinned)) in [
        (1, ("pin_workspace", true)),
        (2, ("unpin_workspace", false)),
    ] {
        let response = authenticated_dispatch(
            &server,
            &token,
            context("workspace-a", "P"),
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": { "workspaceId": "workspace-b" }
                }
            }),
        )
        .await
        .expect("pin dispatch")
        .expect("pin response");
        assert_eq!(
            response["result"]["structuredContent"]["workspace"]["identity"],
            json!({ "runtimeId": "runtime-1", "workspaceId": "workspace-b" })
        );
        assert_eq!(response["result"]["structuredContent"]["pinned"], pinned);
        let request_id = response["result"]["structuredContent"]["requestId"]
            .as_str()
            .expect("runtime request id");
        uuid::Uuid::parse_str(request_id).expect("UUID request id");
        assert_eq!(
            response["result"]["structuredContent"]["status"],
            "requested"
        );
        let (event_session_id, event) = workspace_pin_events
            .0
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("workspace pin intent event");
        assert_eq!(event_session_id, "P");
        assert_eq!(event.request_id, request_id);
        assert_eq!(event.runtime_id, "runtime-1");
        assert_eq!(event.source_session_id, "P");
        assert_eq!(event.workspace_id, "workspace-b");
        assert_eq!(event.pinned, pinned);
    }

    let missing = authenticated_dispatch(
        &server,
        &token,
        context("workspace-a", "P"),
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "pin_workspace",
                "arguments": { "workspaceId": "missing" }
            }
        }),
    )
    .await
    .expect("missing pin dispatch")
    .expect("missing pin response");
    assert_eq!(missing["result"]["isError"], true);
    assert_eq!(
        missing["result"]["structuredContent"]["error"]["code"],
        "WORKSPACE_NOT_FOUND"
    );
    assert_eq!(workspace_pin_events.0.lock().unwrap().len(), 2);
}
