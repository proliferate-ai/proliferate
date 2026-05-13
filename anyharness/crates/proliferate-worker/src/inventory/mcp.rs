use serde_json::json;

pub async fn probe_mcp_readiness() -> serde_json::Value {
    json!({
        "status": "unknown",
        "servers": [],
        "message": "MCP readiness is delegated to AnyHarness runtime inventory when available"
    })
}
