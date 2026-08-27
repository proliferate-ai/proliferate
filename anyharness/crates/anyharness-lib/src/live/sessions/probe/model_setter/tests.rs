use serde_json::json;

use super::{confirmed_model_from_ext_response, model_entries_from_model_state};

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
    let state =
        json!({ "availableModels": [{ "name": "no id" }, { "modelId": "grok-4.3" }] });
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
fn init_meta_model_setter_requires_exact_effective_readback() {
    let confirmed = json!({ "_meta": { "model": { "Ok": "grok-4.6" } } });
    let acknowledgement_only = json!({ "ok": true });

    assert_eq!(
        confirmed_model_from_ext_response(&confirmed).as_deref(),
        Some("grok-4.6")
    );
    assert_eq!(confirmed_model_from_ext_response(&acknowledgement_only), None);
}
