use std::time::Duration;

use anyharness_contract::v1::SessionEventEnvelope;
use serde_json::Value;

use crate::error::Result;

use super::{anyharness_status_error, AnyHarnessClient};

#[derive(Default)]
pub struct SseParser {
    event: Option<String>,
    data: String,
}

impl SseParser {
    pub fn push_str(&mut self, chunk: &str) -> Vec<SseEvent> {
        let mut events = Vec::new();
        for line in chunk.lines() {
            let line = line.trim_end_matches('\r');
            if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(SseEvent {
                        event: self.event.take(),
                        data: self.data.trim_end_matches('\n').to_string(),
                    });
                    self.data.clear();
                }
                continue;
            }
            if let Some(value) = line.strip_prefix("event:") {
                self.event = Some(value.trim().to_string());
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data.push_str(value.trim_start());
                self.data.push('\n');
            }
        }
        events
    }
}

#[derive(Debug, Clone)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

impl AnyHarnessClient {
    pub async fn stream_session_events_once(
        &self,
        session_id: &str,
        after_seq: Option<i64>,
        inactivity_timeout: Duration,
    ) -> Result<Vec<SessionEventEnvelope>> {
        let mut path = format!("v1/sessions/{session_id}/stream");
        if let Some(after_seq) = after_seq {
            path.push_str(&format!("?after_seq={after_seq}"));
        }

        let request = self.http.get(self.endpoint(&path)?);
        let mut response = self.apply_auth(request).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyharness_status_error(status, &body));
        }

        let mut parser = SseParser::default();
        let mut envelopes = Vec::new();

        loop {
            let next = tokio::time::timeout(inactivity_timeout, response.chunk()).await;
            let Some(chunk) = next.ok().transpose()?.flatten() else {
                break;
            };
            let text = String::from_utf8_lossy(&chunk);
            for event in parser.push_str(&text) {
                if let Some(envelope) = parse_session_event(&event.data) {
                    envelopes.push(envelope);
                }
                if envelopes.len() >= 100 {
                    return Ok(envelopes);
                }
            }
        }

        Ok(envelopes)
    }
}

fn parse_session_event(data: &str) -> Option<SessionEventEnvelope> {
    serde_json::from_str::<SessionEventEnvelope>(data)
        .or_else(|_| {
            let value = serde_json::from_str::<Value>(data)?;
            serde_json::from_value::<SessionEventEnvelope>(value)
        })
        .ok()
}

#[cfg(test)]
mod tests {
    use super::SseParser;

    #[test]
    fn parses_multiline_sse_events() {
        let mut parser = SseParser::default();
        let events = parser.push_str("event: message\ndata: {\"a\":1}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].data, "{\"a\":1}");
    }
}
