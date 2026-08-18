use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoUpdatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePinIntentPayload {
    pub request_id: String,
    pub runtime_id: String,
    pub source_session_id: String,
    pub workspace_id: String,
    pub pinned: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::v1::SessionEvent;

    #[test]
    fn workspace_pin_intent_event_round_trips() {
        let event = SessionEvent::WorkspacePinIntent(WorkspacePinIntentPayload {
            request_id: "11111111-1111-4111-8111-111111111111".to_string(),
            runtime_id: "runtime-1".to_string(),
            source_session_id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            pinned: true,
        });

        let json = serde_json::to_value(&event).expect("serialize workspace pin intent");
        assert_eq!(
            json,
            serde_json::json!({
                "type": "workspace_pin_intent",
                "requestId": "11111111-1111-4111-8111-111111111111",
                "runtimeId": "runtime-1",
                "sourceSessionId": "session-1",
                "workspaceId": "workspace-1",
                "pinned": true
            })
        );

        let round_tripped: SessionEvent =
            serde_json::from_value(json).expect("deserialize workspace pin intent");
        assert_eq!(round_tripped.event_type(), "workspace_pin_intent");
        let SessionEvent::WorkspacePinIntent(payload) = round_tripped else {
            panic!("expected workspace pin intent event");
        };
        assert_eq!(payload.source_session_id, "session-1");
        assert!(payload.pinned);
    }
}
