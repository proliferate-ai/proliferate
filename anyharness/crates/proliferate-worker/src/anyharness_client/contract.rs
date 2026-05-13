use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAcceptance {
    pub status: LocalAcceptanceStatus,
    pub status_code: u16,
    pub response: Option<Value>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalAcceptanceStatus {
    Accepted,
    AcceptedButQueued,
    Rejected,
}

impl LocalAcceptance {
    pub fn accepted(status_code: u16, response: Value) -> Self {
        Self {
            status: LocalAcceptanceStatus::Accepted,
            status_code,
            response: Some(response),
            error_code: None,
            error_message: None,
        }
    }

    pub fn queued(status_code: u16, response: Value) -> Self {
        Self {
            status: LocalAcceptanceStatus::AcceptedButQueued,
            status_code,
            response: Some(response),
            error_code: None,
            error_message: None,
        }
    }

    pub fn rejected(
        status_code: u16,
        error_code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            status: LocalAcceptanceStatus::Rejected,
            status_code,
            response: None,
            error_code: Some(error_code.into()),
            error_message: Some(message.into()),
        }
    }
}
