use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    #[serde(default)]
    pub protocol_version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CallToolParams {
    pub name: String,
    #[serde(default)]
    pub arguments: Option<Value>,
}

pub fn deserialize_args<T: for<'de> Deserialize<'de>>(value: Option<Value>) -> anyhow::Result<T> {
    serde_json::from_value(value.unwrap_or_else(|| json!({}))).map_err(anyhow::Error::from)
}

pub fn jsonrpc_result(id: Option<Value>, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "result": result,
    })
}

pub fn jsonrpc_error(id: Option<Value>, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": {
            "code": code,
            "message": message.into(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{jsonrpc_error, jsonrpc_result};
    use serde_json::{json, Value};

    #[test]
    fn result_defaults_missing_id_to_null() {
        assert_eq!(
            jsonrpc_result(None, json!({ "ok": true })),
            json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "result": { "ok": true }
            })
        );
    }

    #[test]
    fn error_preserves_id_and_message() {
        assert_eq!(
            jsonrpc_error(Some(json!(7)), -32601, "unsupported"),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "error": {
                    "code": -32601,
                    "message": "unsupported",
                }
            })
        );
    }
}
