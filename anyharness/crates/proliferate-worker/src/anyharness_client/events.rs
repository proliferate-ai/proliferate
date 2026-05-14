use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::WorkerError;

use super::AnyHarnessClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventEnvelope {
    pub session_id: String,
    pub seq: i64,
    pub timestamp: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub event: Value,
}

impl AnyHarnessClient {
    pub async fn list_session_events(
        &self,
        session_id: &str,
        after_seq: i64,
        limit: Option<usize>,
    ) -> Result<Vec<SessionEventEnvelope>, WorkerError> {
        let mut request = self
            .authenticate(self.http().get(format!(
                "{}/v1/sessions/{}/events",
                self.base_url(),
                session_id
            )))
            .query(&[("after_seq", after_seq.to_string())]);
        if let Some(limit) = limit {
            request = request.query(&[("limit", limit.to_string())]);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        Ok(response.json().await?)
    }
}
