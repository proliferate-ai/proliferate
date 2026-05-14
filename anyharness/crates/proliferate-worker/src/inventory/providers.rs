use serde_json::{json, Value};

use crate::inventory::versions::command_version;

pub fn collect() -> Option<Value> {
    Some(json!({
        "claude": command_version("claude", &["--version"]),
        "codex": command_version("codex", &["--version"]),
        "gemini": command_version("gemini", &["--version"]),
        "opencode": command_version("opencode", &["--version"])
    }))
}
