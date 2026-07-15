use std::path::PathBuf;

use serde_json::json;

use super::{model_entries_from_model_state, native_cli_path};
use crate::domains::agents::model::AgentKind;

#[test]
fn maps_model_id_name_and_description() {
    let state = json!({
        "currentModelId": "grok-build-0.1",
        "availableModels": [
            { "modelId": "grok-build-0.1", "name": "Grok Build", "description": "coding" },
            { "modelId": "grok-4.3", "name": "Grok 4.3" }
        ]
    });
    assert_eq!(
        model_entries_from_model_state(&state).expect("entries"),
        vec![
            (
                "grok-build-0.1".to_string(),
                "Grok Build".to_string(),
                Some("coding".to_string())
            ),
            ("grok-4.3".to_string(), "Grok 4.3".to_string(), None),
        ]
    );
}

#[test]
fn falls_back_to_model_id_when_name_absent() {
    let state = json!({ "availableModels": [{ "modelId": "grok-4.3" }] });
    assert_eq!(
        model_entries_from_model_state(&state).expect("entries"),
        vec![("grok-4.3".to_string(), "grok-4.3".to_string(), None)]
    );
}

#[test]
fn skips_entries_without_a_model_id() {
    let state = json!({ "availableModels": [{ "name": "no id" }, { "modelId": "grok-4.3" }] });
    assert_eq!(
        model_entries_from_model_state(&state).expect("entries"),
        vec![("grok-4.3".to_string(), "grok-4.3".to_string(), None)]
    );
}

#[test]
fn none_when_no_usable_models() {
    assert!(model_entries_from_model_state(&json!({})).is_none());
    assert!(model_entries_from_model_state(&json!({ "availableModels": [] })).is_none());
    assert!(model_entries_from_model_state(&json!({ "currentModelId": "x" })).is_none());
    assert!(
        model_entries_from_model_state(&json!({ "availableModels": [{ "name": "x" }] })).is_none()
    );
}

#[test]
fn claude_executable_override_is_scoped_to_claude() {
    let managed_codex = PathBuf::from("/managed/codex");
    assert_eq!(
        native_cli_path(
            &AgentKind::Codex,
            Some(managed_codex.clone()),
            Some("/managed/claude")
        ),
        Some(managed_codex)
    );
    assert_eq!(
        native_cli_path(&AgentKind::OpenCode, None, Some("/managed/claude")),
        None
    );
    assert_eq!(
        native_cli_path(
            &AgentKind::Claude,
            Some(PathBuf::from("/fallback/claude")),
            Some("/managed/claude")
        ),
        Some(PathBuf::from("/managed/claude"))
    );
}
