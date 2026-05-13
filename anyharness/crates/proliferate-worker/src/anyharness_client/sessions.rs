use anyharness_contract::v1::SessionEventEnvelope;
use serde_json::{json, Value};

use crate::anyharness_client::contract::{LocalAcceptance, LocalAcceptanceStatus};
use crate::error::{Result, WorkerError};

use super::AnyHarnessClient;

impl AnyHarnessClient {
    pub async fn create_session(&self, payload: &Value) -> Result<LocalAcceptance> {
        self.post_acceptance("v1/sessions", payload).await
    }

    pub async fn send_prompt(&self, session_id: &str, payload: &Value) -> Result<LocalAcceptance> {
        self.post_acceptance(&format!("v1/sessions/{session_id}/prompt"), payload)
            .await
    }

    pub async fn update_session_config(
        &self,
        session_id: &str,
        payload: &Value,
    ) -> Result<LocalAcceptance> {
        self.post_acceptance(&format!("v1/sessions/{session_id}/config-options"), payload)
            .await
    }

    pub async fn resolve_interaction(
        &self,
        session_id: &str,
        request_id: &str,
        payload: &Value,
    ) -> Result<LocalAcceptance> {
        self.post_acceptance(
            &format!("v1/sessions/{session_id}/interactions/{request_id}/resolve"),
            payload,
        )
        .await
    }

    pub async fn cancel_session(&self, session_id: &str) -> Result<LocalAcceptance> {
        self.post_acceptance(&format!("v1/sessions/{session_id}/cancel"), &json!({}))
            .await
    }

    pub async fn list_sessions(&self, workspace_id: Option<&str>) -> Result<Value> {
        let path = match workspace_id {
            Some(workspace_id) => format!("v1/sessions?workspace_id={workspace_id}"),
            None => "v1/sessions".to_string(),
        };
        self.get_json(&path).await
    }

    pub async fn list_session_events(
        &self,
        session_id: &str,
        after_seq: Option<i64>,
        limit: Option<i64>,
    ) -> Result<Vec<SessionEventEnvelope>> {
        let mut path = format!("v1/sessions/{session_id}/events");
        let mut query = Vec::new();
        if let Some(after_seq) = after_seq {
            query.push(format!("after_seq={after_seq}"));
        }
        if let Some(limit) = limit {
            query.push(format!("limit={limit}"));
        }
        if !query.is_empty() {
            path.push('?');
            path.push_str(&query.join("&"));
        }
        self.get_json(&path).await
    }

    async fn post_acceptance(&self, path: &str, payload: &Value) -> Result<LocalAcceptance> {
        let request = self.http.post(self.endpoint(path)?).json(payload);
        let response = self.apply_auth(request).send().await?;
        let status = response.status();
        let status_code = status.as_u16();
        let text = response.text().await?;

        if !status.is_success() {
            return Ok(LocalAcceptance::rejected(
                status_code,
                "ANYHARNESS_REJECTED",
                text,
            ));
        }

        let json = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str::<Value>(&text)?
        };

        let acceptance_status = local_status_from_response(&json);
        Ok(match acceptance_status {
            LocalAcceptanceStatus::Accepted => LocalAcceptance::accepted(status_code, json),
            LocalAcceptanceStatus::AcceptedButQueued => LocalAcceptance::queued(status_code, json),
            LocalAcceptanceStatus::Rejected => LocalAcceptance::rejected(
                status_code,
                "ANYHARNESS_REJECTED",
                "runtime returned rejected status",
            ),
        })
    }
}

fn local_status_from_response(response: &Value) -> LocalAcceptanceStatus {
    let status = response
        .get("status")
        .or_else(|| response.get("applyState"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    match status {
        "queued" => LocalAcceptanceStatus::AcceptedButQueued,
        _ => LocalAcceptanceStatus::Accepted,
    }
}

pub fn required_session_id(command_id: &str, session_id: Option<&str>) -> Result<String> {
    session_id
        .map(ToOwned::to_owned)
        .ok_or_else(|| WorkerError::Cloud(format!("command {command_id} missing session_id")))
}
