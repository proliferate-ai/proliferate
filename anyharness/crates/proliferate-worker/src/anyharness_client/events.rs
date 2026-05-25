use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::debug;

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
        if limit.is_some() {
            request = request.query(&[("oldest_first", "true")]);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        let events = response.json::<Vec<SessionEventEnvelope>>().await?;
        let first_seq = events.first().map(|event| event.seq);
        let last_seq = events.last().map(|event| event.seq);
        debug!(
            session_id,
            after_seq,
            limit = ?limit,
            event_count = events.len(),
            first_seq = ?first_seq,
            last_seq = ?last_seq,
            "anyharness session events fetched"
        );
        Ok(events)
    }
}
