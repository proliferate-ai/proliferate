use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::anyharness_client::contract::{LocalAcceptance, LocalAcceptanceStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    pub status: DispatchStatus,
    pub accepted_by_anyharness: bool,
    pub queued_by_anyharness: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub anyharness_status_code: Option<u16>,
    pub response: Option<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchStatus {
    Accepted,
    AcceptedButQueued,
    Rejected,
}

impl DispatchResult {
    pub fn from_local(acceptance: LocalAcceptance) -> Self {
        let status = match acceptance.status {
            LocalAcceptanceStatus::Accepted => DispatchStatus::Accepted,
            LocalAcceptanceStatus::AcceptedButQueued => DispatchStatus::AcceptedButQueued,
            LocalAcceptanceStatus::Rejected => DispatchStatus::Rejected,
        };
        Self {
            status,
            accepted_by_anyharness: !matches!(status, DispatchStatus::Rejected),
            queued_by_anyharness: matches!(status, DispatchStatus::AcceptedButQueued),
            error_code: acceptance.error_code,
            error_message: acceptance.error_message,
            anyharness_status_code: Some(acceptance.status_code),
            response: acceptance.response,
        }
    }

    pub fn rejected(error_code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status: DispatchStatus::Rejected,
            accepted_by_anyharness: false,
            queued_by_anyharness: false,
            error_code: Some(error_code.into()),
            error_message: Some(message.into()),
            anyharness_status_code: None,
            response: None,
        }
    }

    pub fn accepted_but_queued(response: Value) -> Self {
        Self {
            status: DispatchStatus::AcceptedButQueued,
            accepted_by_anyharness: false,
            queued_by_anyharness: true,
            error_code: None,
            error_message: None,
            anyharness_status_code: None,
            response: Some(response),
        }
    }
}
