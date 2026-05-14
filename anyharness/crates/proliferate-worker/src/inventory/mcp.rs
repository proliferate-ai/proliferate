use serde_json::{json, Value};

pub fn collect() -> Option<Value> {
    Some(json!({
        "cacheWritable": true,
        "defaultPackageManager": "npm"
    }))
}
