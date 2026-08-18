//! The OpenCode targeted-fork HTTP side-door client.
//!
//! Talks directly to the vendor `opencode acp` process's HTTP server on
//! `127.0.0.1:{port}` with the Basic-auth password minted for this process
//! (`live::sessions::driver::opencode_sidedoor::SidedoorSpawnConfig`). Every
//! call is short-timeout: a hung side-door must never stall the fork path,
//! which has its own caller-side error handling for an unreachable/refused
//! side-door.
//!
//! Vendor contract pinned at tag v1.18.3 (commit
//! 127bdb30784d508cc556c71a0f32b508a3061517): `GET /session/{id}/message` and
//! `GET /session/{id}/message/{messageID}` for reads, `POST
//! /session/{id}/fork` with body `{"messageID": "..."}` to fork. `GET
//! /session/{id}/message` doubles as the health-check endpoint here (it is
//! the cheapest call that both requires the target session to exist and
//! exercises the same auth middleware as fork dispatch).

use std::time::Duration;

use serde::{Deserialize, Serialize};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
pub enum SidedoorClientError {
    #[error("side-door request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("side-door returned HTTP {status}")]
    Status { status: u16 },
    #[error("side-door response did not parse: {0}")]
    Parse(String),
}

#[derive(Debug, Clone, Serialize)]
struct ForkRequestBody<'a> {
    #[serde(rename = "messageID", skip_serializing_if = "Option::is_none")]
    message_id: Option<&'a str>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VendorSessionInfo {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VendorMessageInfo {
    pub id: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VendorMessageEnvelope {
    pub info: VendorMessageInfo,
}

pub struct OpencodeSidedoorClient {
    base_url: String,
    username: String,
    password: String,
    client: reqwest::Client,
}

impl OpencodeSidedoorClient {
    pub fn new(port: u16, password: String) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build()?;
        Ok(Self {
            base_url: format!("http://127.0.0.1:{port}"),
            username: "opencode".to_string(),
            password,
            client,
        })
    }

    /// Health check: the cheapest authenticated call that exercises the same
    /// auth middleware as a real fork dispatch. Returns `Ok(true)` on 200,
    /// `Ok(false)` on any non-2xx (including 401), `Err` when unreachable.
    pub async fn health_check(&self, session_id: &str) -> Result<bool, SidedoorClientError> {
        let url = format!(
            "{}/session/{}/message",
            self.base_url,
            urlencode(session_id)
        );
        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await?;
        Ok(response.status().is_success())
    }

    /// Same call as `health_check` but WITHOUT credentials -- used by the
    /// fail-closed readiness check to confirm the auth middleware actually
    /// rejects unauthenticated requests.
    pub async fn health_check_unauthenticated(
        &self,
        session_id: &str,
    ) -> Result<bool, SidedoorClientError> {
        let url = format!(
            "{}/session/{}/message",
            self.base_url,
            urlencode(session_id)
        );
        let response = self.client.get(&url).send().await?;
        Ok(response.status().is_success())
    }

    pub async fn get_message(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> Result<VendorMessageEnvelope, SidedoorClientError> {
        let url = format!(
            "{}/session/{}/message/{}",
            self.base_url,
            urlencode(session_id),
            urlencode(message_id)
        );
        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(SidedoorClientError::Status {
                status: status.as_u16(),
            });
        }
        response
            .json()
            .await
            .map_err(|error| SidedoorClientError::Parse(error.to_string()))
    }

    pub async fn list_messages(
        &self,
        session_id: &str,
    ) -> Result<Vec<VendorMessageEnvelope>, SidedoorClientError> {
        let url = format!(
            "{}/session/{}/message",
            self.base_url,
            urlencode(session_id)
        );
        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(SidedoorClientError::Status {
                status: status.as_u16(),
            });
        }
        response
            .json()
            .await
            .map_err(|error| SidedoorClientError::Parse(error.to_string()))
    }

    /// Dispatch the fork. `message_id: None` forks at the tip; `Some(id)`
    /// forks immediately before that (vendor-EXCLUSIVE) message. Callers in
    /// this lane must never pass an id that has not first been validated via
    /// `get_message` + `list_messages` membership (upstream does no existence
    /// check and will silently full-copy an unrecognized id).
    pub async fn fork(
        &self,
        session_id: &str,
        message_id: Option<&str>,
    ) -> Result<VendorSessionInfo, SidedoorClientError> {
        let url = format!("{}/session/{}/fork", self.base_url, urlencode(session_id));
        let response = self
            .client
            .post(&url)
            .basic_auth(&self.username, Some(&self.password))
            .json(&ForkRequestBody { message_id })
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(SidedoorClientError::Status {
                status: status.as_u16(),
            });
        }
        response
            .json()
            .await
            .map_err(|error| SidedoorClientError::Parse(error.to_string()))
    }
}

fn urlencode(value: &str) -> String {
    // Session/message ids are vendor-generated `[A-Za-z0-9_]+` identifiers in
    // practice; percent-encode conservatively anyway rather than assuming.
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_request_body_serializes_with_message_id() {
        let body = ForkRequestBody {
            message_id: Some("msg_abc123"),
        };
        let json = serde_json::to_string(&body).unwrap();
        assert_eq!(json, r#"{"messageID":"msg_abc123"}"#);
    }

    #[test]
    fn fork_request_body_omits_message_id_when_none() {
        let body = ForkRequestBody { message_id: None };
        let json = serde_json::to_string(&body).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn urlencode_leaves_typical_ids_untouched() {
        assert_eq!(urlencode("msg_abcDEF123_-.~"), "msg_abcDEF123_-.~");
    }

    #[test]
    fn urlencode_escapes_special_chars() {
        assert_eq!(urlencode("a/b"), "a%2Fb");
    }

    const FORK_REQUEST_FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/opencode-sidedoor/fork-request.json"
    ));
    const MESSAGE_LIST_FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/contracts/opencode-sidedoor/message-list-response.json"
    ));

    #[test]
    fn fork_request_matches_pinned_fixture_shape() {
        let body = ForkRequestBody {
            message_id: Some("msg_01hqrstuvwxyzabcdefghij0"),
        };
        let ours: serde_json::Value = serde_json::from_str(&serde_json::to_string(&body).unwrap()).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(FORK_REQUEST_FIXTURE).unwrap();
        assert_eq!(ours, fixture);
    }

    #[test]
    fn parses_pinned_message_list_fixture() {
        let messages: Vec<VendorMessageEnvelope> =
            serde_json::from_str(MESSAGE_LIST_FIXTURE).expect("fixture parses");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].info.id, "msg_01hqrstuvwxyzabcdefghij0");
        assert_eq!(messages[0].info.role, "user");
    }
}
