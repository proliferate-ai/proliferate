use serde_json::{json, Value};

use super::definition::ProductMcpDefinition;
use crate::integrations::mcp::json_rpc::jsonrpc_result;

pub fn initialize_response(
    id: Option<Value>,
    protocol_version: Option<String>,
    definition: &ProductMcpDefinition,
) -> Value {
    jsonrpc_result(
        id,
        json!({
            "protocolVersion": protocol_version.unwrap_or_else(|| "2025-11-25".to_string()),
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": definition.server_info_name,
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": definition.instructions,
        }),
    )
}
