use serde_json::{json, Value};

use crate::inventory::versions::command_version;

pub fn browser_inventory() -> Option<Value> {
    Some(json!({
        "chromium": command_version("chromium", &["--version"]),
        "chromiumBrowser": command_version("chromium-browser", &["--version"]),
        "googleChrome": command_version("google-chrome", &["--version"]),
        "playwright": command_version("playwright", &["--version"])
    }))
}
