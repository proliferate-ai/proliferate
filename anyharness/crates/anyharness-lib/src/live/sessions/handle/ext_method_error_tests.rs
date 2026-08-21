//! Classification tests for `AgentExtMethodError`, kept beside the handle
//! rather than inside it so `handle.rs` stays under the repo line cap.

use super::AgentExtMethodError;

#[test]
fn timeout_and_internal_errors_are_agent_unavailable() {
    assert!(AgentExtMethodError::Timeout {
        method: "_anyharness/goal/set".to_string(),
        timeout_secs: 45,
    }
    .is_agent_unavailable());
    assert!(AgentExtMethodError::Rpc {
        method: "_anyharness/goal/get".to_string(),
        code: -32603,
        message: "sqlite state db unavailable".to_string(),
    }
    .is_agent_unavailable());
}

#[test]
fn invalid_params_stays_a_client_rejection() {
    assert!(!AgentExtMethodError::Rpc {
        method: "_anyharness/goal/set".to_string(),
        code: -32602,
        message: "invalid params".to_string(),
    }
    .is_agent_unavailable());
}

#[test]
fn classification_survives_anyhow_downcast() {
    let error: anyhow::Error = AgentExtMethodError::Timeout {
        method: "_anyharness/goal/clear".to_string(),
        timeout_secs: 45,
    }
    .into();
    let downcast = error
        .downcast_ref::<AgentExtMethodError>()
        .expect("ext-method error survives anyhow round-trip");
    assert!(downcast.is_agent_unavailable());
}
